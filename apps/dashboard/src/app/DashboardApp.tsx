/**
 * DashboardApp — mountable React component wrapping the full HAPulse dashboard.
 *
 * Encapsulates all runtime initialisation that main.tsx previously did at
 * module scope (settings→theme subscription, watchSystemMode, connectionStore
 * init), so a host app (e.g. a Next.js SaaS wrapper) can simply render
 * <DashboardApp /> without duplicating boot logic.
 *
 * The host is responsible for:
 *   - Importing the global stylesheet  (import '@hapulse/dashboard/styles.css')
 *   - Deciding whether to wrap in React.StrictMode
 */

import { useEffect, useState, type ReactNode } from 'react';
import { applyTheme, watchSystemMode } from '../theme/themes';
import { useSettingsStore } from '../stores/settingsStore';
import { useConnectionStore, hasResumableConnection } from '../stores/connectionStore';
import { AppRouter } from './Router';
import { UserMenuContext } from './userMenuContext';
import { setAppBasename } from './basename';
import { DashboardBootLoading } from '../components/ui/DashboardBootLoading';
import { I18nProvider } from '../i18n/I18nProvider';

// Guard against React 19 StrictMode's double-invocation running init twice.
let _initialised = false;

export interface DashboardAppProps {
  basename?: string | undefined;
  /**
   * Optional dropdown menu attached to the user avatar. The SaaS host injects an
   * account/sign-out menu here; the open-source build leaves it undefined so the
   * avatar keeps its navigate-to-settings behavior. Surfaced to UserAvatar via
   * context so it works on every breakpoint (desktop header + mobile page header).
   */
  accountMenu?: ReactNode;
  /**
   * Mount straight into demo mode (used by the public /demo page). Demo state is
   * ephemeral (not persisted) so it doesn't leak into a real session. When false
   * (default), the app auto-reconnects from persisted credentials as usual.
   */
  demo?: boolean;
}

export function DashboardApp({ basename, accountMenu, demo = false }: DashboardAppProps) {
  // Boot gate: while an auto-reconnect from persisted credentials is in flight,
  // show the branded loading animation instead of letting the route guard flash
  // the login screen (OAuth) or an empty shell (token). Computed once at mount —
  // the demo entry never waits, and a brand-new user with no creds goes straight
  // to onboarding.
  const [waitingForBoot] = useState(() => !demo && hasResumableConnection());
  const booted = useConnectionStore((s) => s.booted);

  useEffect(() => {
    // Record the basename so the HA OAuth redirect URL is correct (e.g. the
    // hosted app is mounted at /app, so the callback must return to
    // /app/onboarding). Runs before init(), even under the StrictMode guard.
    setAppBasename(basename);

    if (_initialised) return;
    _initialised = true;

    // Apply the current theme immediately so a host without the pre-paint IIFE
    // still gets correct theming on first render.
    const s = useSettingsStore.getState();
    applyTheme(s.theme, s.mode, s.accentHue);
    document.title = s.appName || 'HAPulse';

    // Keep the DOM in sync with future settings changes.
    useSettingsStore.subscribe((state) => {
      applyTheme(state.theme, state.mode, state.accentHue);
      document.title = state.appName || 'HAPulse';
    });

    // Keep the DOM in sync with OS color-scheme changes (auto mode).
    watchSystemMode(() => {
      const state = useSettingsStore.getState();
      return { theme: state.theme, mode: state.mode, accentHue: state.accentHue };
    });

    if (demo) {
      // Public demo: enter demo mode ephemerally (no persisted connection).
      useConnectionStore.getState().startDemo(false);
    } else {
      // Kick off auto-reconnect from persisted credentials (async, non-blocking).
      useConnectionStore.getState().init();
    }
  }, [demo, basename]);

  return (
    <I18nProvider>
      {waitingForBoot && !booted ? (
        <DashboardBootLoading />
      ) : (
        <UserMenuContext.Provider value={accountMenu}>
          <AppRouter basename={basename} />
        </UserMenuContext.Provider>
      )}
    </I18nProvider>
  );
}
