/**
 * i18n setup.
 *
 * Adding a language: create locales/<code>.json with the same keys as ja.json and
 * add an entry to LANGUAGES. No other code changes are needed.
 */

import i18next, { type TFunction } from "i18next";
import { useEffect, useState } from "preact/hooks";
import ja from "./locales/ja.json";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const LANGUAGES = [
  // Each language is labelled in its own script so people can always find theirs.
  { code: "ja", label: "日本語" },
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

const STORAGE_KEY = "printPortal.language";
const DEFAULT_LANGUAGE: LanguageCode = "ja";

function isSupported(code: string): code is LanguageCode {
  return LANGUAGES.some((l) => l.code === code);
}

/** Priority: saved choice > browser languages > Japanese. */
export function detectLanguage(saved: string | null, browserLanguages: readonly string[]): LanguageCode {
  if (saved && isSupported(saved)) return saved;
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split("-")[0]!;
    if (isSupported(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const i18n = i18next.createInstance();

export function initI18n(language?: LanguageCode): Promise<TFunction> {
  const lng = language ?? detectLanguage(readSaved(), typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
  return i18n.init({
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    resources: { ja: { translation: ja }, en: { translation: en }, zh: { translation: zh } },
    interpolation: { escapeValue: false }, // Preact escapes output already.
    initAsync: false,
  });
}

export function setLanguage(code: LanguageCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private mode or storage disabled: the choice simply isn't remembered.
  }
  void i18n.changeLanguage(code);
}

function syncDocumentLanguage(code: string): void {
  if (typeof document !== "undefined") document.documentElement.lang = code;
}

i18n.on("languageChanged", syncDocumentLanguage);
i18n.on("initialized", () => syncDocumentLanguage(i18n.language));

/** Re-renders the calling component whenever the language changes. */
export function useT(): { t: TFunction; lang: LanguageCode } {
  const [lang, setLang] = useState(i18n.language as LanguageCode);
  useEffect(() => {
    const onChange = (code: string) => setLang(code as LanguageCode);
    i18n.on("languageChanged", onChange);
    return () => i18n.off("languageChanged", onChange);
  }, []);
  return { t: i18n.t.bind(i18n), lang };
}

/** Locale-aware formatting, always in the printer's time zone. */
export function formatDateTime(date: Date, lang: string, withDate = true): string {
  return new Intl.DateTimeFormat(lang, {
    timeZone: "Asia/Tokyo",
    ...(withDate ? { year: "numeric", month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "3 hours ago" / "3 時間前", picking a sensible unit. */
export function formatRelative(date: Date, lang: string, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "minute");
}

export function formatTime(date: Date, lang: string): string {
  return formatDateTime(date, lang, false);
}
