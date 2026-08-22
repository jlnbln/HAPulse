/**
 * i18n — pure translation logic. No React, no DOM.
 *
 * Dictionaries are flat maps of dotted keys to strings, so they stay readable by
 * translation platforms (Weblate, Crowdin) without a conversion step.
 *
 * Plural forms use CLDR categories as key suffixes (`key.one`, `key.other`),
 * selected by the native Intl.PluralRules — no plural rules of our own to maintain.
 */

export type Dict = Record<string, string>;

export const LOCALES = ['en', 'sv'] as const;
export type Locale = (typeof LOCALES)[number];

/** Language names shown in the language selector, each in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  sv: 'Svenska',
};

/** Replaces `{name}` with vars.name. An unprovided variable is left visible on
 *  purpose: a literal `{name}` in the UI reveals the bug, an empty string hides it. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** `Intl.PluralRules` instances are locale-only (no dict/key state), so one per
 *  locale is reused across every `translate()` call instead of being rebuilt
 *  on every render — this dashboard re-renders plural counters continuously
 *  as Home Assistant events stream in. */
const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * Resolve `key` against `dict`, falling back to `fallback`, then to the key itself.
 *
 * When `vars.count` is a number, the plural form is selected first:
 * `${key}.${category}` (e.g. `devices.count.one`), then `${key}.other`, then `key`.
 */
export function translate(
  dict: Dict,
  fallback: Dict,
  locale: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const candidates: string[] = [];

  if (typeof vars?.count === 'number') {
    const category = getPluralRules(locale).select(vars.count);
    candidates.push(`${key}.${category}`, `${key}.other`);
  }
  candidates.push(key);

  for (const candidate of candidates) {
    const hit = dict[candidate] ?? fallback[candidate];
    if (hit !== undefined) return interpolate(hit, vars);
  }
  return key;
}

/** Reduce a BCP-47 tag to its base language: `fr-CA` → `fr`. */
function baseLanguage(tag: string): string {
  return tag.split('-')[0]!.toLowerCase();
}

/**
 * Pick the locale to display, in order of precedence:
 *   1. an explicit user preference (anything other than 'auto')
 *   2. the language configured in Home Assistant
 *   3. the browser's preferred languages, in order
 *   4. 'en'
 *
 * Any candidate not in `available` is skipped rather than accepted, so an
 * unsupported Home Assistant language falls through to the browser instead of
 * dead-ending on English.
 */
export function resolveLanguage(
  pref: Locale | 'auto',
  haLanguage: string | null | undefined,
  navigatorLangs: readonly string[],
  available: readonly Locale[] = LOCALES,
): Locale {
  const supported = (tag: string | null | undefined): Locale | undefined => {
    if (!tag) return undefined;
    const base = baseLanguage(tag);
    return available.find((l) => l === base);
  };

  if (pref !== 'auto') {
    const explicit = supported(pref);
    if (explicit) return explicit;
  }

  const fromHA = supported(haLanguage);
  if (fromHA) return fromHA;

  for (const tag of navigatorLangs) {
    const fromNav = supported(tag);
    if (fromNav) return fromNav;
  }

  return 'en';
}
