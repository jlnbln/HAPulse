/**
 * I18nProvider — resolves the display locale and exposes its dictionary.
 *
 * English stays the fallback dictionary: a key missing from a translation shows
 * the English string rather than a raw key.
 */

import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveLanguage, type Dict, type Locale } from '@hapulse/core';
import { useSettingsStore } from '../stores/settingsStore';
import { useConnectionStore } from '../stores/connectionStore';
import { getLanguage } from '../ha/config';
import en from './locales/en.json';

export interface I18nValue {
  locale: Locale;
  dict: Dict;
  fallback: Dict;
}

export const I18nContext = createContext<I18nValue>({
  locale: 'en',
  dict: en,
  fallback: en,
});

/** Dictionaries by locale. */
const DICTS: Record<Locale, Dict> = { en };

export function I18nProvider({ children }: { children: ReactNode }) {
  const pref = useSettingsStore((s) => s.language);
  const connectionStatus = useConnectionStore((s) => s.status);
  const [haLanguage, setHaLanguage] = useState<string | null>(null);

  // The HA-configured language only matters in 'auto' mode; fetching it is a
  // best-effort round-trip that must never block or break rendering.
  //
  // Also re-run when the connection status changes: on a brand-new sign-in
  // (no persisted credentials), this provider mounts before the connection
  // exists, so the first attempt finds `ha/config.ts` returning null. Without
  // this dependency nothing would retry once the connection actually comes
  // up, and HA's configured language would only take effect after a reload.
  useEffect(() => {
    if (pref !== 'auto') return;
    let cancelled = false;
    void (async () => {
      try {
        const lang = await getLanguage();
        if (!cancelled) setHaLanguage(lang);
      } catch {
        // Language is a comfort, not a dependency: swallow and keep resolving
        // from the browser / default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pref, connectionStatus]);

  const value = useMemo<I18nValue>(() => {
    const locale = resolveLanguage(pref, haLanguage, navigator.languages ?? []);
    return { locale, dict: DICTS[locale] ?? en, fallback: en };
  }, [pref, haLanguage]);

  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
