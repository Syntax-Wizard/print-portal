/**
 * A tiny, safe parser for the JavaScript literals that the printer embeds in its pages,
 * e.g. `var infoIn=[['Tray 1',0,100,'A4']];`.
 *
 * It understands only what the firmware emits: arrays, strings, numbers, booleans and null.
 * Nothing is ever evaluated, so a malformed or malicious page cannot run code.
 */

export type JsValue = string | number | boolean | null | JsValue[];

export class JsLiteralError extends Error {
  constructor(message: string, readonly position: number) {
    super(`${message} at position ${position}`);
    this.name = "JsLiteralError";
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

class Parser {
  pos: number;

  constructor(
    private readonly src: string,
    start: number,
  ) {
    this.pos = start;
  }

  parseValue(): JsValue {
    this.skipWhitespace();
    const ch = this.src[this.pos];
    if (ch === "[") return this.parseArray();
    if (ch === "'" || ch === '"') return this.parseString(ch);
    if (ch === "-" || ch === "+" || ch === "." || (ch !== undefined && ch >= "0" && ch <= "9")) {
      return this.parseNumber();
    }
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.src.startsWith(word, this.pos)) {
        this.pos += word.length;
        return value;
      }
    }
    throw new JsLiteralError(`Unexpected character ${JSON.stringify(ch ?? "EOF")}`, this.pos);
  }

  private parseArray(): JsValue[] {
    const items: JsValue[] = [];
    this.pos++; // '['
    this.skipWhitespace();
    if (this.src[this.pos] === "]") {
      this.pos++;
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === ",") {
        this.pos++;
        this.skipWhitespace();
        // Tolerate a trailing comma, which old firmware sometimes emits.
        if (this.src[this.pos] === "]") {
          this.pos++;
          return items;
        }
        continue;
      }
      if (ch === "]") {
        this.pos++;
        return items;
      }
      throw new JsLiteralError(`Expected ',' or ']' but found ${JSON.stringify(ch ?? "EOF")}`, this.pos);
    }
  }

  private parseString(quote: string): string {
    let out = "";
    this.pos++; // opening quote
    for (;;) {
      const ch = this.src[this.pos];
      if (ch === undefined) throw new JsLiteralError("Unterminated string", this.pos);
      if (ch === quote) {
        this.pos++;
        return out;
      }
      if (ch === "\\") {
        const next = this.src[this.pos + 1];
        if (next === undefined) throw new JsLiteralError("Unterminated escape", this.pos);
        if (next === "x" || next === "u") {
          const len = next === "x" ? 2 : 4;
          const hex = this.src.slice(this.pos + 2, this.pos + 2 + len);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) {
            throw new JsLiteralError("Invalid escape sequence", this.pos);
          }
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 2 + len;
          continue;
        }
        out += SIMPLE_ESCAPES[next] ?? next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos++;
    }
  }

  private parseNumber(): number {
    const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.src.slice(this.pos, this.pos + 64));
    if (!match) throw new JsLiteralError("Invalid number", this.pos);
    this.pos += match[0].length;
    return Number(match[0]);
  }

  skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }
}

/** Parse a complete literal string such as `[1,'a',[2]]`. Trailing content is not allowed. */
export function parseJsLiteral(src: string): JsValue {
  const parser = new Parser(src, 0);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (parser.pos !== src.length) {
    throw new JsLiteralError("Unexpected trailing content", parser.pos);
  }
  return value;
}

/** Parse one literal that starts at `start` inside a larger source. Returns the value and the end index. */
export function parseJsLiteralAt(src: string, start: number): { value: JsValue; end: number } {
  const parser = new Parser(src, start);
  const value = parser.parseValue();
  return { value, end: parser.pos };
}
