import { describe, expect, it } from "vitest";
import { LANGUAGES, detectLanguage } from "../src/i18n";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";
import zh from "../src/i18n/locales/zh.json";

const locales: Record<string, unknown> = { ja, en, zh };

/** Dotted key paths, with i18next plural suffixes folded into one key ("pages_one" → "pages"). */
function keys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`, ...value.flatMap((v, i) => keys(v, `${prefix}[${i}]`))];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix.replace(/_(zero|one|two|few|many|other)$/, "")];
}

const sorted = (list: string[]) => [...new Set(list)].sort();

/** {{placeholders}} used by each key, plural forms merged. */
function placeholders(value: unknown, prefix = "", out = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (typeof value === "string") {
    const key = prefix.replace(/_(zero|one|two|few|many|other)$/, "");
    const set = out.get(key) ?? new Set<string>();
    for (const m of value.matchAll(/\{\{(\w+)\}\}/g)) set.add(m[1]!);
    out.set(key, set);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) placeholders(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

describe("translations", () => {
  it("has a file for every listed language", () => {
    for (const { code } of LANGUAGES) expect(locales[code], code).toBeDefined();
  });

  for (const code of Object.keys(locales).filter((c) => c !== "ja")) {
    it(`${code} has the same keys as ja`, () => {
      expect(sorted(keys(locales[code]))).toEqual(sorted(keys(ja)));
    });

    it(`${code} uses the same placeholders as ja`, () => {
      const want = placeholders(ja);
      const got = placeholders(locales[code]);
      for (const [key, names] of want) expect([...(got.get(key) ?? [])].sort(), key).toEqual([...names].sort());
    });
  }
});

describe("detectLanguage", () => {
  it("picks Chinese for Chinese browsers", () => {
    expect(detectLanguage(null, ["zh-CN", "en"])).toBe("zh");
    expect(detectLanguage(null, ["zh-TW"])).toBe("zh");
  });

  it("keeps a saved choice over the browser language", () => {
    expect(detectLanguage("ja", ["zh-CN"])).toBe("ja");
    expect(detectLanguage("zh", ["ja-JP"])).toBe("zh");
  });
});
