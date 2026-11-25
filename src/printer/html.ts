/**
 * Helpers for pulling data out of the printer's HTML pages.
 */

import { type JsValue, parseJsLiteralAt } from "./jsLiteral";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  times: "×",
  copy: "©",
  reg: "®",
  deg: "°",
  micro: "µ",
};

/** Decode the HTML entities the firmware uses inside its JS strings (e.g. `g/m&sup2;`). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Recursively decode entities in every string of a parsed literal. */
export function decodeDeep(value: JsValue): JsValue {
  if (typeof value === "string") return decodeEntities(value);
  if (Array.isArray(value)) return value.map(decodeDeep);
  return value;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read `var <name> = <literal>;` from a page. Returns `undefined` when the variable is absent.
 * Throws JsLiteralError when the variable exists but its literal is malformed.
 */
export function extractVar(html: string, name: string): JsValue | undefined {
  const re = new RegExp(`(?:^|[^\\w$.])var\\s+${escapeRegExp(name)}\\s*=\\s*`, "m");
  const match = re.exec(html);
  if (!match) return undefined;
  return decodeDeep(parseJsLiteralAt(html, match.index + match[0].length).value);
}

/**
 * Collect a variable that the page builds incrementally:
 * `var info = []; info=info.concat([...]); info=info.concat([...]);`
 */
export function extractConcatenated(html: string, name: string): JsValue[] {
  const result: JsValue[] = [];
  const initial = extractVar(html, name);
  if (Array.isArray(initial)) result.push(...initial);
  const n = escapeRegExp(name);
  const re = new RegExp(`(?:^|[^\\w$.])${n}\\s*=\\s*${n}\\.concat\\(\\s*`, "gm");
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const { value } = parseJsLiteralAt(html, m.index + m[0].length);
    const decoded = decodeDeep(value);
    if (Array.isArray(decoded)) result.push(...decoded);
    else result.push(decoded);
  }
  return result;
}

/** The text inside <TITLE>, trimmed. */
export function extractTitle(html: string): string | undefined {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1]!.trim() : undefined;
}

/** Visible body text with tags removed and whitespace collapsed into separate lines. */
export function extractBodyText(html: string): string[] {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
