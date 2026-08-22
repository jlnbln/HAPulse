/**
 * Settings page — theme, customization, backup, about.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import {
  Github, ExternalLink,
  ChevronDown, ChevronRight,
  Wifi, Hash, Sun, Palette, Download, Upload, Info, Languages,
  LayoutGrid, Pencil, List, ShieldCheck,
} from 'lucide-react';

import { useSettingsStore } from '../stores/settingsStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useEntityStore } from '../stores/entityStore';
import { useUIStore } from '../stores/uiStore';
import { useRooms, useCurrentUserAvatar, useCanEdit } from '../ha/hooks';
import { THEMES, THEME_NAMES, resolveMode } from '../theme/themes';
import type { ThemeName, ThemeMode } from '../theme/themes';
import { LOCALES, LOCALE_LABELS } from '@hapulse/core';
import type { Room, HassEntity, Locale } from '@hapulse/core';
import { isDefaultPersistenceAdapter } from '../persistence';

import { useT } from '../i18n/useT';
import type { TKey, TFunction } from '../i18n/useT';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { SectionLabel } from '../components/ui/SectionLabel';
import { UserAvatar } from '../components/ui/UserAvatar';
import { ThemeSwatch } from '../components/settings/ThemeSwatch';
import { RoomRow } from '../components/settings/RoomRow';
import { EntityRow } from '../components/settings/EntityRow';
import { PageHeaderActions } from '../components/ui/PageHeaderActions';

import './Page.css';
import './Settings.css';

// ---------------------------------------------------------------------------
// Validation helpers for import
// ---------------------------------------------------------------------------

const VALID_THEMES = new Set<string>([...THEME_NAMES, 'dusk', 'dawn', 'midnight', 'sage']);

function validateImport(data: unknown, t: TFunction): string | null {
  if (typeof data !== 'object' || data === null) return t('settings.backup.error.notObject');
  const d = data as Record<string, unknown>;
  if (d['theme'] !== undefined && !VALID_THEMES.has(String(d['theme']))) {
    return t('settings.backup.error.invalidTheme', { theme: String(d['theme']), validThemes: THEME_NAMES.join(', ') });
  }
  if (d['mode'] !== undefined && !['light', 'dark', 'auto'].includes(String(d['mode']))) {
    return t('settings.backup.error.invalidMode', { mode: String(d['mode']) });
  }
  if (d['accentHue'] !== undefined && typeof d['accentHue'] !== 'number') {
    return t('settings.backup.error.invalidAccentHue');
  }
  if (d['customization'] !== undefined) {
    const c = d['customization'] as Record<string, unknown>;
    if (!Array.isArray(c['roomOrder'])) return t('settings.backup.error.invalidRoomOrder');
    if (!Array.isArray(c['hiddenRooms'])) return t('settings.backup.error.invalidHiddenRooms');
    if (!Array.isArray(c['hiddenEntities'])) return t('settings.backup.error.invalidHiddenEntities');
    if (typeof c['entityOverrides'] !== 'object' || c['entityOverrides'] === null || Array.isArray(c['entityOverrides'])) {
      return t('settings.backup.error.invalidEntityOverrides');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status dot helpers
// ---------------------------------------------------------------------------

type StoreStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

function statusDotClass(status: StoreStatus): string {
  switch (status) {
    case 'connected':    return 'conn-status__dot--connected';
    case 'reconnecting': return 'conn-status__dot--reconnecting';
    case 'disconnected': return 'conn-status__dot--disconnected';
    case 'error':        return 'conn-status__dot--error';
    default:             return 'conn-status__dot--idle';
  }
}

function statusLabel(status: StoreStatus, demo: boolean, t: TFunction): string {
  if (demo) return t('settings.status.demo');
  switch (status) {
    case 'connected':    return t('settings.status.connected');
    case 'reconnecting': return t('settings.status.reconnecting');
    case 'disconnected': return t('settings.status.disconnected');
    case 'error':        return t('settings.status.error');
    default:             return t('settings.status.idle');
  }
}

// ---------------------------------------------------------------------------
// Section: Connection
// ---------------------------------------------------------------------------

function ConnectionSection() {
  const t = useT();
  const navigate = useNavigate();
  const { url, token, demo, mode, status, currentUser } = useConnectionStore(
    useShallow((s) => ({ url: s.url, token: s.token, demo: s.demo, mode: s.mode, status: s.status, currentUser: s.currentUser }))
  );
  const disconnect = useConnectionStore((s) => s.disconnect);
  const avatar = useCurrentUserAvatar();
  const { entityCount, roomCount } = useEntityStore(
    useShallow((s) => ({
      entityCount: Object.keys(s.entities).length,
      roomCount: s.rooms.length,
    }))
  );

  function handleDisconnect() {
    disconnect();
    navigate('/onboarding');
  }

  const maskedToken = token.length > 4
    ? `••••••••${token.slice(-4)}`
    : '••••';

  const isDemo = mode === 'demo' || demo;
  const displayName = currentUser
    ? (isDemo ? t('settings.connection.demoUser') : currentUser.name)
    : (isDemo ? t('settings.connection.demoHome') : 'Home Assistant');

  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.connection')}</SectionLabel>
      <Card className="conn-card">
        <div className="conn-card__profile">
          <UserAvatar
            name={avatar?.name ?? displayName}
            pictureUrl={avatar?.pictureUrl ?? null}
            initial={avatar?.initial ?? (displayName[0] ?? '?').toUpperCase()}
            interactive={false}
          />
          <div className="conn-card__profile-info">
            <span className="conn-card__profile-name">{displayName}</span>
            <div className="conn-card__profile-meta">
              {isDemo ? (
                <span className="conn-card__badge">{t('settings.connection.badge.demo')}</span>
              ) : mode === 'oauth' ? (
                <span className="conn-card__badge conn-card__badge--oauth">{t('settings.connection.badge.oauth')}</span>
              ) : (
                <span className="conn-card__badge conn-card__badge--token">{t('settings.connection.badge.token')}</span>
              )}
              {!isDemo && currentUser && (
                <span className="conn-card__role-badge">
                  {currentUser.is_owner ? t('settings.connection.role.owner') : t('settings.connection.role.user')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="conn-card__rows">
          <div className="conn-card__row">
            <span className="conn-card__row-label">
              <span className="conn-card__icon-chip" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
                <Wifi size={14} strokeWidth={1.75} />
              </span>
              {t('settings.connection.row.status')}
            </span>
            <div className="conn-status">
              <span className={`conn-status__dot ${statusDotClass(status)}`} aria-hidden="true" />
              <span style={{
                color: status === 'connected' ? 'var(--positive)'
                  : status === 'reconnecting' ? 'var(--warning)'
                  : 'var(--text-dim)',
              }}>
                {statusLabel(status, isDemo, t)}
              </span>
            </div>
          </div>

          {!isDemo && url && (
            <div className="conn-card__row">
              <span className="conn-card__row-label">
                <span className="conn-card__icon-chip" style={{ background: 'var(--bg-subtle)', color: 'var(--text-dim)' }}>
                  <Hash size={14} strokeWidth={1.75} />
                </span>
                {t('settings.connection.row.url')}
              </span>
              <span className="conn-card__url conn-card__row-value">{url}</span>
            </div>
          )}

          {!isDemo && mode !== 'oauth' && (
            <div className="conn-card__row">
              <span className="conn-card__row-label">
                <span className="conn-card__icon-chip" style={{ background: 'var(--bg-subtle)', color: 'var(--text-dim)' }}>
                  <Hash size={14} strokeWidth={1.75} />
                </span>
                {t('settings.connection.row.token')}
              </span>
              <span className="conn-card__token conn-card__row-value">{maskedToken}</span>
            </div>
          )}

          <div className="conn-card__row">
            <span className="conn-card__row-label">
              <span className="conn-card__icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <LayoutGrid size={14} strokeWidth={1.75} />
              </span>
              {t('settings.connection.row.data')}
            </span>
            <div className="conn-card__counts conn-card__row-value">
              <span>{roomCount}</span>&nbsp;{t('settings.connection.rooms')}&nbsp;·&nbsp;<span>{entityCount}</span>&nbsp;{t('settings.connection.entities')}
            </div>
          </div>

          {isDemo && (
            <div className="conn-card__row" style={{ background: 'var(--bg-subtle)' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                {t('settings.connection.demoHint')}
              </span>
            </div>
          )}
        </div>

        <div className="conn-card__actions">
          {mode === 'oauth' ? (
            <button type="button" className="btn btn--danger" onClick={handleDisconnect}>
              {t('settings.connection.signOut')}
            </button>
          ) : isDemo ? (
            <button type="button" className="btn btn--ghost" onClick={handleDisconnect}>
              {t('settings.connection.connectHA')}
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={handleDisconnect}>
              {t('settings.connection.disconnect')}
            </button>
          )}
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Appearance
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const t = useT();
  const { theme, mode, accentHue } = useSettingsStore(
    useShallow((s) => ({ theme: s.theme, mode: s.mode, accentHue: s.accentHue }))
  );
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setMode = useSettingsStore((s) => s.setMode);
  const setAccentHue = useSettingsStore((s) => s.setAccentHue);

  const resolved = resolveMode(mode);

  function getDefaultHue(t: ThemeName): number {
    const accent = THEMES[t][resolved].accent;
    const r = parseInt(accent.slice(1, 3), 16) / 255;
    const g = parseInt(accent.slice(3, 5), 16) / 255;
    const b = parseInt(accent.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return Math.round(h * 360);
  }

  const [localHue, setLocalHue] = useState<number>(accentHue ?? getDefaultHue(theme));

  function handleThemeSelect(t: ThemeName) {
    setTheme(t);
    if (accentHue === undefined) setLocalHue(getDefaultHue(t));
  }

  function handleHueChange(hue: number) {
    setLocalHue(hue);
    setAccentHue(hue);
  }

  function handleResetHue() {
    setAccentHue(undefined);
    setLocalHue(getDefaultHue(theme));
  }

  const accentPreviewColor = accentHue !== undefined
    ? `hsl(${accentHue}, 78%, ${resolved === 'dark' ? 60 : 50}%)`
    : THEMES[theme][resolved].accent;

  const MODE_OPTIONS: { id: ThemeMode; labelKey: TKey }[] = [
    { id: 'light', labelKey: 'settings.appearance.mode.light' },
    { id: 'dark', labelKey: 'settings.appearance.mode.dark' },
    { id: 'auto', labelKey: 'settings.appearance.mode.auto' },
  ];

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  // Locale entries show each language's own native name (LOCALE_LABELS is not
  // translated — "Svenska" reads the same regardless of UI language), so only
  // the 'auto' entry resolves through a translation key at render time.
  const LANGUAGE_OPTIONS: { id: Locale | 'auto'; labelKey?: TKey; label?: string }[] = [
    { id: 'auto', labelKey: 'settings.language.auto' },
    ...LOCALES.map((l) => ({ id: l, label: LOCALE_LABELS[l] })),
  ];

  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.appearance')}</SectionLabel>
      <Card className="settings-card">
        {/* Mode row */}
        <div className="settings-card__row settings-card__row--inline">
          <span className="settings-card__row-label">
            <span className="settings-card__icon-chip" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              <Sun size={14} strokeWidth={1.75} />
            </span>
            {t('settings.appearance.mode.label')}
          </span>
          <div className="mode-toggle" role="group" aria-label={t('settings.appearance.mode.groupAria')}>
            {MODE_OPTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mode-toggle__btn${mode === m.id ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Language row */}
        <div className="settings-card__row settings-card__row--inline">
          <span className="settings-card__row-label">
            <span className="settings-card__icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Languages size={14} strokeWidth={1.75} />
            </span>
            {t('settings.language.label')}
          </span>
          <div className="mode-toggle" role="group" aria-label={t('settings.language.groupAria')}>
            {LANGUAGE_OPTIONS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`mode-toggle__btn${language === l.id ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setLanguage(l.id)}
                aria-pressed={language === l.id}
              >
                {l.labelKey ? t(l.labelKey) : l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Theme picker */}
        <div className="settings-card__row">
          <div className="settings-card__row-label">
            <span className="settings-card__icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Palette size={14} strokeWidth={1.75} />
            </span>
            {t('settings.appearance.theme.label')}
          </div>
          <div className="theme-grid">
            {THEME_NAMES.map((themeName) => (
              <ThemeSwatch
                key={themeName}
                name={themeName}
                active={theme === themeName}
                previewMode={resolved}
                onClick={() => handleThemeSelect(themeName)}
              />
            ))}
          </div>
        </div>

        {/* Accent hue */}
        <div className="settings-card__row">
          <div className="accent-row">
            <div className="accent-row__label">
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="settings-card__icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Palette size={14} strokeWidth={1.75} />
                </span>
                {t('settings.appearance.accent.label')}
                <span className="accent-preview-dot" style={{ background: accentPreviewColor }} aria-hidden="true" />
              </span>
              {accentHue !== undefined && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', minHeight: 32 }}
                  onClick={handleResetHue}
                >
                  {t('settings.appearance.accent.reset')}
                </button>
              )}
            </div>
            <input
              type="range"
              className="accent-slider"
              min={0}
              max={360}
              value={localHue}
              onChange={(e) => handleHueChange(Number(e.target.value))}
              aria-label={t('settings.appearance.accent.hueAria')}
            />
          </div>
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch — used in AdminSection
// ---------------------------------------------------------------------------

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`admin-toggle${checked ? ' admin-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-toggle__thumb" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Entities content (used inside EditEntitiesModal)
// ---------------------------------------------------------------------------

function EntitiesContent() {
  const t = useT();
  const rooms = useRooms();
  const entities = useEntityStore((s) => s.entities);
  const { customization, updateCustomization } = useSettingsStore(
    useShallow((s) => ({ customization: s.customization, updateCustomization: s.updateCustomization }))
  );
  const [search, setSearch] = useState('');

  const handleRename = useCallback((entityId: string, name: string) => {
    const overrides = { ...customization.entityOverrides };
    if (name === '') {
      const existing = overrides[entityId];
      if (existing) {
        const { name: _n, ...rest } = existing;
        if (Object.keys(rest).length === 0) {
          delete overrides[entityId];
        } else {
          overrides[entityId] = rest;
        }
      }
    } else {
      overrides[entityId] = { ...overrides[entityId], name };
    }
    updateCustomization({ entityOverrides: overrides });
  }, [customization.entityOverrides, updateCustomization]);

  const handleToggleHide = useCallback((entityId: string) => {
    const hidden = customization.hiddenEntities.includes(entityId)
      ? customization.hiddenEntities.filter((id) => id !== entityId)
      : [...customization.hiddenEntities, entityId];
    updateCustomization({ hiddenEntities: hidden });
  }, [customization.hiddenEntities, updateCustomization]);

  const handleToggleFavorite = useCallback((entityId: string) => {
    const favorites = customization.favorites.includes(entityId)
      ? customization.favorites.filter((id) => id !== entityId)
      : [...customization.favorites, entityId];
    updateCustomization({ favorites });
  }, [customization.favorites, updateCustomization]);

  const q = search.toLowerCase();

  const groupsWithEntities: Array<{ label: string; entities: HassEntity[] }> = [];

  for (const room of rooms) {
    const roomEntities = room.entityIds
      .map((id) => entities[id])
      .filter((e): e is HassEntity => e != null)
      .filter((e) => {
        if (!q) return true;
        const name = (customization.entityOverrides[e.entity_id]?.name ?? e.attributes.friendly_name ?? e.entity_id).toLowerCase();
        return name.includes(q) || e.entity_id.toLowerCase().includes(q);
      });
    if (roomEntities.length > 0) {
      groupsWithEntities.push({ label: room.name, entities: roomEntities });
    }
  }

  const categorisedIds = new Set(rooms.flatMap((r) => r.entityIds));
  const uncategorised = Object.values(entities).filter((e) => {
    if (categorisedIds.has(e.entity_id)) return false;
    if (!q) return true;
    const name = (customization.entityOverrides[e.entity_id]?.name ?? e.attributes.friendly_name ?? e.entity_id).toLowerCase();
    return name.includes(q) || e.entity_id.toLowerCase().includes(q);
  });
  if (uncategorised.length > 0) {
    groupsWithEntities.push({ label: t('settings.entities.uncategorised'), entities: uncategorised });
  }

  return (
    <div className="entities-modal-content">
      <div className="entities-search">
        <input
          type="search"
          className="settings-text-input"
          placeholder={t('settings.entities.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('settings.entities.searchAria')}
        />
      </div>

      {groupsWithEntities.length === 0 && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
          {search ? t('settings.entities.emptySearch') : t('settings.entities.empty')}
        </p>
      )}

      {groupsWithEntities.map((group) => (
        <details key={group.label} className="entity-group">
          <summary className="entity-group__summary">
            <span>{group.label}</span>
            <span className="entity-group__count">{group.entities.length}</span>
            <ChevronDown size={16} strokeWidth={1.75} className="entity-group__chevron" aria-hidden="true" />
          </summary>
          <div className="entity-rows">
            {group.entities.map((entity) => {
              const overrideName = customization.entityOverrides[entity.entity_id]?.name;
              const displayName = overrideName ?? (entity.attributes.friendly_name as string | undefined) ?? entity.entity_id;
              return (
                <EntityRow
                  key={entity.entity_id}
                  entity={entity}
                  displayName={displayName}
                  isHidden={customization.hiddenEntities.includes(entity.entity_id)}
                  isFavorite={customization.favorites.includes(entity.entity_id)}
                  onRename={(name) => handleRename(entity.entity_id, name)}
                  onToggleHide={() => handleToggleHide(entity.entity_id)}
                  onToggleFavorite={() => handleToggleFavorite(entity.entity_id)}
                />
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Entities Modal
// ---------------------------------------------------------------------------

function EditEntitiesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (open) {
      setLoaded(false);
      const t = setTimeout(() => setLoaded(true), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.entities.modalTitle')}
      icon={<List size={18} strokeWidth={1.75} />}
    >
      {!loaded ? (
        <div className="entities-modal-loading">
          <div className="entities-modal-progress" />
          <span className="entities-modal-loading-label">{t('settings.entities.loading')}</span>
        </div>
      ) : (
        <EntitiesContent />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Section: Admin (admins only)
// ---------------------------------------------------------------------------

function AdminSection() {
  const t = useT();
  const canEdit = useCanEdit();
  if (!canEdit) return null;

  const editingEnabled = useSettingsStore((s) => s.customization.editingEnabled);
  const updateCustomization = useSettingsStore((s) => s.updateCustomization);
  const setEditMode = useUIStore((s) => s.setEditMode);
  const [entitiesOpen, setEntitiesOpen] = useState(false);

  function handleToggleEditing(enabled: boolean) {
    updateCustomization({ editingEnabled: enabled });
    if (!enabled) setEditMode(false);
  }

  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.admin')}</SectionLabel>
      <Card className="settings-card">
        {/* Editing toggle */}
        <div className="settings-card__row settings-card__row--inline">
          <span className="settings-card__row-label">
            <span className="settings-card__icon-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Pencil size={14} strokeWidth={1.75} />
            </span>
            {t('settings.admin.editingLabel')}
          </span>
          <ToggleSwitch
            checked={editingEnabled}
            onChange={handleToggleEditing}
            label={t('settings.admin.editingToggleAria')}
          />
        </div>

        {/* Edit entities */}
        <div className="settings-card__row settings-card__row--inline">
          <span className="settings-card__row-label">
            <span className="settings-card__icon-chip" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
              <List size={14} strokeWidth={1.75} />
            </span>
            {t('settings.admin.entitiesLabel')}
          </span>
          <button
            type="button"
            className="btn btn--ghost admin-entities-btn"
            onClick={() => setEntitiesOpen(true)}
          >
            {t('settings.admin.editEntitiesBtn')}
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>
      </Card>

      <EditEntitiesModal open={entitiesOpen} onClose={() => setEntitiesOpen(false)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Rooms (hidden when editing is disabled)
// ---------------------------------------------------------------------------

function RoomsSection() {
  const t = useT();
  const editingEnabled = useSettingsStore((s) => s.customization.editingEnabled);
  const rooms = useRooms();
  const { customization, updateCustomization } = useSettingsStore(
    useShallow((s) => ({ customization: s.customization, updateCustomization: s.updateCustomization }))
  );

  const orderedRooms: Room[] = React.useMemo(() => {
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const result: Room[] = [];
    for (const id of customization.roomOrder) {
      const r = byId.get(id);
      if (r) result.push(r);
    }
    for (const r of rooms) {
      if (!customization.roomOrder.includes(r.id)) result.push(r);
    }
    return result;
  }, [rooms, customization.roomOrder]);

  if (!editingEnabled) return null;

  function getOrderedIds(): string[] {
    return orderedRooms.map((r) => r.id);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const ids = getOrderedIds();
    const prev = ids[index - 1] as string;
    const curr = ids[index] as string;
    ids[index - 1] = curr;
    ids[index] = prev;
    updateCustomization({ roomOrder: ids });
  }

  function handleMoveDown(index: number) {
    const ids = getOrderedIds();
    if (index === ids.length - 1) return;
    const curr = ids[index] as string;
    const next = ids[index + 1] as string;
    ids[index] = next;
    ids[index + 1] = curr;
    updateCustomization({ roomOrder: ids });
  }

  function handleToggleHide(roomId: string) {
    const hidden = customization.hiddenRooms.includes(roomId)
      ? customization.hiddenRooms.filter((id) => id !== roomId)
      : [...customization.hiddenRooms, roomId];
    updateCustomization({ hiddenRooms: hidden });
  }

  if (orderedRooms.length === 0) {
    return (
      <section className="settings-page__section">
        <SectionLabel>{t('settings.section.rooms')}</SectionLabel>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-faint)' }}>
          {t('settings.rooms.empty')}
        </p>
      </section>
    );
  }

  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.rooms')}</SectionLabel>
      <Card style={{ overflow: 'hidden' }}>
        <div className="rooms-list">
          {orderedRooms.map((room, index) => (
            <RoomRow
              key={room.id}
              room={room}
              isFirst={index === 0}
              isLast={index === orderedRooms.length - 1}
              isHidden={customization.hiddenRooms.includes(room.id)}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onToggleHide={() => handleToggleHide(room.id)}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Backup
// ---------------------------------------------------------------------------

function BackupSection() {
  const t = useT();
  const { exportSettings, importSettings } = useSettingsStore(
    useShallow((s) => ({ exportSettings: s.exportSettings, importSettings: s.importSettings }))
  );
  const { connMode, connDemo, connStatus } = useConnectionStore(
    useShallow((s) => ({ connMode: s.mode, connDemo: s.demo, connStatus: s.status }))
  );

  // Open-source only: the hosted build syncs settings via Supabase instead
  // (see ha/settingsSync.ts) — never show this line there.
  const showHASyncStatus = isDefaultPersistenceAdapter();
  const haSyncConnected = (connMode === 'oauth' || connMode === 'token') && !connDemo && connStatus === 'connected';

  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hapulse-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setImportError(null);
    setImportSuccess(false);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') {
        setImportError(t('settings.backup.error.readFail'));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportError(t('settings.backup.error.invalidJson'));
        return;
      }
      const error = validateImport(parsed, t);
      if (error) {
        setImportError(error);
        return;
      }
      importSettings(text);
      setImportError(null);
      setImportSuccess(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.backup')}</SectionLabel>
      <Card className="settings-card">
        <p className="backup-hint">
          {t('settings.backup.hint')}
        </p>
        <div className="backup-row">
          <button type="button" className="btn btn--secondary" onClick={handleExport}>
            <Download size={15} strokeWidth={1.75} />
            {t('settings.backup.exportBtn')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleImportClick}>
            <Upload size={15} strokeWidth={1.75} />
            {t('settings.backup.importBtn')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="file-input-hidden"
            onChange={handleFileChange}
            aria-label={t('settings.backup.importFileAria')}
            tabIndex={-1}
          />
        </div>
        {importError && <p className="import-error" role="alert">{importError}</p>}
        {importSuccess && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--positive)', padding: '0 1.375rem 0.75rem' }} role="status">
            {t('settings.backup.importSuccess')}
          </p>
        )}
        {showHASyncStatus && (
          <p className="backup-hint" style={{ paddingTop: 0, paddingBottom: '1rem' }}>
            {haSyncConnected
              ? t('settings.backup.syncStatus.connected')
              : t('settings.backup.syncStatus.pending')}
          </p>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: About
// ---------------------------------------------------------------------------

function AboutSection() {
  const t = useT();
  return (
    <section className="settings-page__section">
      <SectionLabel>{t('settings.section.about')}</SectionLabel>
      <Card className="about-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 9,
            background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0,
          }}>
            <Info size={18} strokeWidth={1.75} />
          </span>
          <div className="about-card__title">HAPulse</div>
        </div>
        <div className="about-card__sub">{t('settings.about.version')}</div>
        <div className="about-card__sub">{t('settings.about.tagline')}</div>
        <a
          href="https://github.com/jlnbln/HAPulse"
          target="_blank"
          rel="noopener noreferrer"
          className="about-card__link"
        >
          <Github size={14} strokeWidth={1.75} />
          github.com/jlnbln/HAPulse
          <ExternalLink size={12} strokeWidth={1.75} />
        </a>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export function Settings() {
  const t = useT();
  return (
    <div className="page settings-page stagger-rise">
      <div className="page__header-row">
        <h1 className="page__title">{t('settings.title')}</h1>
        <PageHeaderActions />
      </div>
      <ConnectionSection />
      <AppearanceSection />
      <AdminSection />
      <RoomsSection />
      <BackupSection />
      <AboutSection />
    </div>
  );
}
