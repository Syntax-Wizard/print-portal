import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/printer/options";
import { loadOptions, resetSessionOptions, saveOptions, saveRememberOptions } from "../src/ui/settings";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("print settings", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    resetSessionOptions();
  });

  const changed = { ...DEFAULT_OPTIONS, duplex: "none" as const, copies: 3 };

  it("keeps the settings for the rest of the visit even when not remembered", () => {
    saveOptions(changed, false);
    expect(loadOptions()).toEqual(changed);
    resetSessionOptions(); // a reload
    expect(loadOptions()).toEqual(DEFAULT_OPTIONS);
  });

  it("remembers settings for later visits when opted in, except copies", () => {
    saveRememberOptions(true);
    saveOptions(changed, true);
    resetSessionOptions();
    expect(loadOptions()).toEqual({ ...changed, copies: 1 });
  });
});
