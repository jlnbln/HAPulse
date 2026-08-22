/**
 * HAPulse dashboard — entry point.
 *
 * Order of operations:
 * 1. Apply saved theme + tab title immediately (before React hydrates) — prevents flash.
 * 2. Render <DashboardApp /> which handles connection init, theme/title subscription,
 *    and system-mode watching via a one-time useEffect.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

// Global styles (fonts, reset, theme tokens, grain overlay)
import './styles/global.css';

import { applyTheme, THEME_NAMES } from './theme/themes';
import type { ThemeName, ThemeMode } from './theme/themes';
import { DashboardApp } from './app/DashboardApp';

// Map any legacy persisted theme value to the current { theme, mode } model.
function legacyTheme(value: string | undefined): { theme: ThemeName; mode: ThemeMode } {
  if (value && (THEME_NAMES as readonly string[]).includes(value)) {
    return { theme: value as ThemeName, mode: 'light' };
  }
  switch (value) {
    case 'dusk': return { theme: 'sunset', mode: 'dark' };
    case 'dawn': return { theme: 'sunset', mode: 'light' };
    case 'midnight': return { theme: 'ocean', mode: 'dark' };
    case 'sage': return { theme: 'forest', mode: 'light' };
    default: return { theme: 'aurora', mode: 'light' };
  }
}

// ---------------------------------------------------------------------------
// 1. Apply theme + mode + tab title before first paint — read directly from
//    localStorage (the Zustand persist store hasn't hydrated yet at this point)
// ---------------------------------------------------------------------------
(function initTheme() {
  let theme: ThemeName = 'aurora';
  let mode: ThemeMode = 'light';
  let accentHue: number | undefined;
  let appName: string | undefined;
  try {
    const raw = localStorage.getItem('hapulse:settings');
    if (raw) {
      const settings = JSON.parse(raw) as {
        state?: { theme?: string; mode?: ThemeMode; accentHue?: number; appName?: string };
      };
      const legacy = legacyTheme(settings?.state?.theme);
      theme = legacy.theme;
      mode =
        settings?.state?.mode === 'light' || settings?.state?.mode === 'dark' || settings?.state?.mode === 'auto'
          ? settings.state.mode
          : legacy.mode;
      accentHue = settings?.state?.accentHue;
      appName = settings?.state?.appName;
    }
  } catch {
    // fall through to defaults
  }
  // Always apply — sets data-theme/data-mode and tokens even on first run.
  applyTheme(theme, mode, accentHue);
  document.title = appName || 'HAPulse';
})();

// ---------------------------------------------------------------------------
// 2. Render — DashboardApp handles subscribe/watchSystemMode/init internally
// ---------------------------------------------------------------------------
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('[HAPulse] No #root element found in index.html');

createRoot(rootEl).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
