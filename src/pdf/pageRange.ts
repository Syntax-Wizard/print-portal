/**
 * Page selections such as "1-3, 5, 8-" (1-based, as people write them).
 * Full-width digits and dashes (common with Japanese input) are accepted.
 */

export type PageRangeError = "invalid" | "outOfRange";

export type PageRangeResult = { ok: true; pages: number[] | null } | { ok: false; error: PageRangeError };

/** Normalise full-width characters and the various dashes people type. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー〜~]/g, "-")
    .replace(/[、，]/g, ",")
    .trim();
}

/**
 * Parse a selection against a document of `pageCount` pages.
 * Returns 0-based page indices in the order written, or `null` for "all pages" (empty input).
 * Duplicates are kept: "1,1" prints page 1 twice, like most print dialogs.
 */
export function parsePageRange(text: string, pageCount: number): PageRangeResult {
  const input = normalise(text);
  if (input === "") return { ok: true, pages: null };
  const pages: number[] = [];
  for (const raw of input.split(",")) {
    const part = raw.replace(/\s+/g, "");
    if (part === "") continue;
    const m = /^(\d+)?(-)?(\d+)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return { ok: false, error: "invalid" };
    const isRange = m[2] === "-";
    const from = m[1] ? Number(m[1]) : 1;
    const to = isRange ? (m[3] ? Number(m[3]) : pageCount) : from;
    if (!isRange && m[3]) return { ok: false, error: "invalid" };
    if (from < 1 || to < 1) return { ok: false, error: "invalid" };
    if (from > pageCount || to > pageCount) return { ok: false, error: "outOfRange" };
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) pages.push(p - 1);
  }
  return pages.length ? { ok: true, pages } : { ok: false, error: "invalid" };
}
