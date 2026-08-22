import { useContext, useMemo } from 'react';
import { translate, type Locale } from '@hapulse/core';
import { I18nContext } from './I18nProvider';
import type en from './locales/en.json';

/** Plural keys are addressed by their base name, whose `.one` / `.other` variants
 *  are what actually live in the JSON. */
type PluralBase<K extends string> = K extends `${infer B}.one` | `${infer B}.other` ? B : never;

/** Every key present in en.json (plus plural base names). A typo or a dead key
 *  fails `npm run typecheck`. */
export type TKey = keyof typeof en | PluralBase<keyof typeof en & string>;

export function useT() {
  const { dict, fallback, locale } = useContext(I18nContext);
  return useMemo(
    () =>
      (key: TKey, vars?: Record<string, string | number>): string =>
        translate(dict, fallback, locale, key, vars),
    [dict, fallback, locale],
  );
}

/** Canonical type for the `t` function returned by `useT()`, for call sites
 *  (helpers, components) that need to accept it as a parameter. */
export type TFunction = ReturnType<typeof useT>;

/** The resolved locale, for Intl.DateTimeFormat / NumberFormat call sites.
 *  Hook: call it in a component body only — utility functions take `locale`
 *  as a parameter instead. */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
