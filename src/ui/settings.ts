/**
 * Per-browser preferences kept in localStorage. Nothing here ever leaves the browser,
 * and secrets (the Secure Print passcode) are never stored.
 */

import { DEFAULT_OPTIONS } from "../printer/options";
import type { PrintOptions } from "../printer/types";

const KEYS = {
  options: "printPortal.options",
  rememberOptions: "printPortal.rememberOptions",
  theme: "printPortal.theme",
  owner: "printPortal.owner",
} as const;

export type Theme = "system" | "light" | "dark";

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: preferences just aren't remembered.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable.
  }
}

/** Whether the user explicitly asked to keep their print settings for future visits. Defaults to false. */
export function loadRememberOptions(): boolean {
  return read<boolean>(KEYS.rememberOptions) === true;
}

export function saveRememberOptions(remember: boolean): void {
  write(KEYS.rememberOptions, remember);
  if (!remember) remove(KEYS.options);
}

/**
 * Last used options, restored only when the user opted in to remembering them.
 * Special job types (secure, sample, delayed) are deliberately never restored.
 */
export function loadOptions(): PrintOptions {
  if (!loadRememberOptions()) return DEFAULT_OPTIONS;
  const saved = read<Partial<PrintOptions>>(KEYS.options);
  if (!saved || typeof saved !== "object") return DEFAULT_OPTIONS;
  const merged: PrintOptions = { ...DEFAULT_OPTIONS };
  for (const key of ["copies", "collate", "duplex", "color", "tray", "paperSize", "media", "pagesPerSheet"] as const) {
    if (saved[key] !== undefined && typeof saved[key] === typeof DEFAULT_OPTIONS[key]) {
      (merged as unknown as Record<string, unknown>)[key] = saved[key];
    }
  }
  return merged;
}

export function saveOptions(options: PrintOptions): void {
  const { delivery: _delivery, ...rest } = options;
  write(KEYS.options, rest);
}

export function loadTheme(): Theme {
  const t = read<Theme>(KEYS.theme);
  return t === "light" || t === "dark" ? t : "system";
}

export function saveTheme(theme: Theme): void {
  write(KEYS.theme, theme);
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", Boolean(dark));
}

/** The owner string the printer records for jobs from this computer (usually its IP address). */
export function loadOwner(): string | null {
  const o = read<string>(KEYS.owner);
  return typeof o === "string" && o !== "" ? o : null;
}

export function saveOwner(owner: string): void {
  write(KEYS.owner, owner);
}

const MY_MAILBOX_KEY = "printPortal.myMailbox";

/** The user's own mailbox number (never its password). */
export function loadMyMailbox(): number | null {
  const n = read<number>(MY_MAILBOX_KEY);
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

export function saveMyMailbox(box: number | null): void {
  if (box === null) {
    try {
      localStorage.removeItem(MY_MAILBOX_KEY);
    } catch {
      // Storage unavailable.
    }
    return;
  }
  write(MY_MAILBOX_KEY, box);
}
