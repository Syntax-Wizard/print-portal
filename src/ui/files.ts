/**
 * Client-side checks before a file is sent to the printer.
 * The printer's web upload accepts PDF and JPEG directly (verified on the device).
 */

export const MAX_FILE_MB = 100;
export const MAX_FILES = 20;

const SUPPORTED = [
  { ext: [".pdf"], mime: ["application/pdf"] },
  { ext: [".jpg", ".jpeg"], mime: ["image/jpeg"] },
];

export type FileProblem = "unsupported" | "tooLarge" | "empty";

export function checkFile(file: { name: string; type: string; size: number }): FileProblem | null {
  const name = file.name.toLowerCase();
  const supported = SUPPORTED.some((s) => s.ext.some((e) => name.endsWith(e)) || s.mime.includes(file.type));
  if (!supported) return "unsupported";
  if (file.size === 0) return "empty";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return "tooLarge";
  return null;
}

/** Value for <input accept>. */
export const ACCEPT = SUPPORTED.flatMap((s) => [...s.ext, ...s.mime]).join(",");

export function formatSize(bytes: number, lang: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
