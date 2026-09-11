/**
 * Locale constants shared between server config (`i18n/request.ts`) and
 * client code (e.g. the language switcher). Kept in its own module — server-only
 * code (`next/headers`) must never leak into a file a Client Component imports.
 */
export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}
