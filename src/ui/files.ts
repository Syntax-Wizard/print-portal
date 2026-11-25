/**
 * Client-side checks before a file is sent to the printer.
 * PDFs are sent as they are (or rewritten in the browser for page selection); any image the
 * browser can decode is converted to a one-page PDF first (src/images/).
 */

import { isImageFile } from "../images/plan";

export const MAX_FILE_MB = 100;
export const MAX_FILES = 20;

/** "imageUnreadable" is found after adding, when the browser fails to decode the image. */
export type FileProblem = "unsupported" | "tooLarge" | "empty" | "imageUnreadable";

export function checkFile(file: { name: string; type: string; size: number }): FileProblem | null {
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!pdf && !isImageFile(file)) return "unsupported";
  if (file.size === 0) return "empty";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return "tooLarge";
  return null;
}

/** Value for <input accept>. HEIC is listed explicitly: some systems do not map it to image/*. */
export const ACCEPT = ".pdf,application/pdf,image/*,.heic,.heif";

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
