/**
 * settingsSync — make self-hosted (open-source) dashboard settings durable
 * and cross-device by mirroring `settingsStore` into Home Assistant's own
 * `frontend/user_data` storage (stored server-side per HA user).
 *
 * WHY: the open-source build previously kept `hapulse:settings` only in
 * browser localStorage. Safari (and some hardened browsers) evict
 * script-writable storage after ~7 days of inactivity, silently wiping a
 * user's entire layout. Home Assistant itself gives us a free, per-user,
 * server-side home for this — `frontend/set_user_data` /
 * `frontend/get_user_data` / `frontend/subscribe_user_data` (verified against
 * HA core's `homeassistant/components/frontend/storage.py`).
 *
 * This module is a HA-access module (like `service.ts`), so it may import
 * `getLiveConnection`/`useConnectionStore` from `stores/connectionStore`
 * directly — components must not.
 *
 * SCOPE: open-source only. When a non-default (hosted/Supabase) persistence
 * adapter is installed, or the app is in demo mode, every entry point here
 * no-ops so the hosted build's own (Supabase-based) sync is unaffected and
 * stays the sole source of truth there.
 *
 * localStorage remains the fast local cache (first paint, pre-connection,
 * onboarding). Home Assistant becomes the source of truth once connected:
 * on connect we adopt whatever HA has, or seed HA from local settings if HA
 * has nothing yet (e.g. the first run after upgrading to this version).
 *
 * LOOP PREVENTION: writing our own snapshot to HA echoes back through
 * `subscribeUserData` (HA has no way to suppress your own subscription).
 * Applying a remote snapshot in turn touches `settingsStore`, which our own
 * change-listener would otherwise treat as "the user changed something" and
 * push straight back out. Two independent guards close this loop:
 *   1. `_applyingRemote` — set for the synchronous duration of applying an
 *      incoming snapshot; the settingsStore subscription checks this flag
 *      first and skips scheduling a push while it's set.
 *   2. `_lastSnapshotJson` — the serialized snapshot last known to match what
 *      HA holds (set on adopt, on seed, on every successful push, and on
 *      every applied remote update). Both the incoming-update handler and the
 *      outgoing push compare against it and skip when nothing actually
 *      changed — this is what makes the write-then-echo round trip a no-op
 *      even in the (unlikely) case the two land in different tasks and (1)
 *      has already been cleared.
 */

import { getLiveConnection, useConnectionStore } from '../stores/connectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isDefaultPersistenceAdapter } from '../persistence';
import { THEME_NAMES } from '../theme/themes';

const SETTINGS_KEY = 'hapulse:settings';
const DEBOUNCE_MS = 750;

// ---------------------------------------------------------------------------
// Module-scope sync state
// ---------------------------------------------------------------------------

let _started = false;
let _applyingRemote = false;
/** Serialized snapshot last known to match what HA holds for SETTINGS_KEY. */
let _lastSnapshotJson: string | null = null;
let _unsubStore: (() => void) | null = null;
let _unsubRemote: (() => void) | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

/** The flat settings snapshot — same shape `settingsStore.exportSettings()` produces. */
function currentSnapshot(): Record<string, unknown> {
  return JSON.parse(useSettingsStore.getState().exportSettings()) as Record<string, unknown>;
}

/**
 * Loose structural validation for a snapshot arriving from HA (another
 * device, possibly an older/newer HAPulse version). Mirrors the checks
 * `Settings.tsx`'s manual-import validator performs — reject anything whose
 * shape is clearly wrong rather than trying to fully re-validate every
 * `customization` field (that's `importSettings`'s job, which already
 * defaults/merges unknown or missing keys against `DEFAULT_CUSTOMIZATION`).
 */
const SNAPSHOT_KEYS = [
  'theme',
  'mode',
  'accentHue',
  'customization',
  'userName',
  'appName',
  'appIcon',
  'appIconHidden',
  'sidebarCollapsed',
  'language',
] as const;

function isValidSnapshot(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  // Require at least one recognized key. Without this, ANY object — `{}`, or a
  // payload whose shape we didn't anticipate — would pass the field checks
  // below (they only reject *present* keys of the wrong type) and get handed to
  // importSettings, which would reset the user's config to defaults. That is
  // precisely the settings-loss failure this module exists to prevent, so fail
  // closed and keep the local settings instead.
  if (!SNAPSHOT_KEYS.some((k) => d[k] !== undefined)) return false;
  if (d['theme'] !== undefined && typeof d['theme'] !== 'string') return false;
  if (d['theme'] !== undefined && !(THEME_NAMES as readonly string[]).includes(d['theme'] as string)) {
    // Allow legacy pre-v0.5 theme strings too — importSettings migrates them.
    if (!['dusk', 'dawn', 'midnight', 'sage'].includes(d['theme'] as string)) return false;
  }
  if (d['mode'] !== undefined && !['light', 'dark', 'auto'].includes(String(d['mode']))) return false;
  if (d['accentHue'] !== undefined && typeof d['accentHue'] !== 'number') return false;
  if (
    d['customization'] !== undefined &&
    (typeof d['customization'] !== 'object' || d['customization'] === null || Array.isArray(d['customization']))
  ) {
    return false;
  }
  return true;
}

/** Apply a validated remote snapshot to settingsStore without echoing it back out. */
function applyRemoteSnapshot(value: Record<string, unknown>): void {
  _applyingRemote = true;
  try {
    useSettingsStore.getState().importSettings(JSON.stringify(value));
    _lastSnapshotJson = JSON.stringify(value);
  } finally {
    _applyingRemote = false;
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function shouldSync(): boolean {
  if (!isDefaultPersistenceAdapter()) return false; // hosted build owns sync via Supabase
  const { demo, mode } = useConnectionStore.getState();
  if (demo || mode === 'demo') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Push (local → HA), debounced
// ---------------------------------------------------------------------------

async function pushSnapshot(): Promise<void> {
  const conn = getLiveConnection();
  if (!conn || !shouldSync()) return;

  const snapshot = currentSnapshot();
  const json = JSON.stringify(snapshot);
  if (json === _lastSnapshotJson) return; // nothing actually changed since HA last saw it

  // Optimistically record before the write settles — a subscribe_user_data
  // echo of this exact write must be recognized as "no change" the moment it
  // arrives, not after the setUserData promise resolves.
  _lastSnapshotJson = json;

  try {
    await conn.setUserData(SETTINGS_KEY, snapshot);
  } catch (err) {
    console.warn('[HAPulse] settingsSync: failed to write settings to Home Assistant:', err);
  }
}

function schedulePush(): void {
  if (_debounceTimer != null) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    void pushSnapshot();
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Adopt / seed on connect
// ---------------------------------------------------------------------------

async function adoptOrSeed(): Promise<void> {
  const conn = getLiveConnection();
  if (!conn || !shouldSync()) return;

  try {
    const remote = await conn.getUserData<Record<string, unknown>>(SETTINGS_KEY);

    if (remote != null && isValidSnapshot(remote)) {
      // HA already has a snapshot (from this device before, or another
      // device) — it's the source of truth once connected.
      applyRemoteSnapshot(remote);
      return;
    }

    // HA has nothing yet — seed it from whatever this device currently has
    // (including a first-run-after-upgrade push of the existing local config).
    const local = currentSnapshot();
    _lastSnapshotJson = JSON.stringify(local);
    await conn.setUserData(SETTINGS_KEY, local);
  } catch (err) {
    console.warn('[HAPulse] settingsSync: adopt/seed failed, continuing on local storage only:', err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start HA-backed settings sync for the open-source build. Safe to call
 * whenever a live connection becomes ready (fresh connect, OAuth callback, or
 * boot-time session resume) — no-ops when a hosted persistence adapter is
 * installed, in demo mode, or if there's no live connection yet. Idempotent:
 * calling again while already running is a no-op (call `stopHASettingsSync`
 * first if you need to restart against a new connection).
 */
export function startHASettingsSync(): void {
  if (_started) return;
  if (!shouldSync()) return;

  const conn = getLiveConnection();
  if (!conn) return;

  _started = true;

  // 1. Adopt HA's snapshot, or seed HA from local settings if it has none.
  void adoptOrSeed();

  // 2. Live updates from other devices.
  _unsubRemote = conn.subscribeUserData<Record<string, unknown>>(SETTINGS_KEY, (value) => {
    if (value == null) return;
    const json = JSON.stringify(value);
    if (json === _lastSnapshotJson) return; // our own write echoing back, or unchanged
    if (!isValidSnapshot(value)) {
      console.warn('[HAPulse] settingsSync: ignoring malformed remote settings snapshot');
      return;
    }
    applyRemoteSnapshot(value);
  });

  // 3. Push local changes (debounced), skipping changes caused by (2).
  _unsubStore = useSettingsStore.subscribe((state, prevState) => {
    if (_applyingRemote) return;
    if (
      state.theme !== prevState.theme ||
      state.mode !== prevState.mode ||
      state.accentHue !== prevState.accentHue ||
      state.userName !== prevState.userName ||
      state.appName !== prevState.appName ||
      state.appIcon !== prevState.appIcon ||
      state.appIconHidden !== prevState.appIconHidden ||
      state.sidebarCollapsed !== prevState.sidebarCollapsed ||
      state.customization !== prevState.customization ||
      state.language !== prevState.language
    ) {
      schedulePush();
    }
  });
}

/**
 * Stop HA-backed settings sync — unsubscribes from both the store and HA's
 * live updates, and cancels any pending debounced push. Call on disconnect
 * (and before reconnecting, since a new connection needs a fresh
 * `startHASettingsSync`).
 */
export function stopHASettingsSync(): void {
  _started = false;
  _applyingRemote = false;
  _lastSnapshotJson = null;

  _unsubStore?.();
  _unsubStore = null;

  _unsubRemote?.();
  _unsubRemote = null;

  if (_debounceTimer != null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
}
