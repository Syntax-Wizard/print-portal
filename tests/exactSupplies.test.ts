import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { MAX_SNAPSHOT_AGE_MS, applySnapshot, parseSnapshot } from "../src/printer/exactSupplies";
import { parseSupplies } from "../src/printer/parsers";
import { modelFromSysDescr, toPercent } from "../scripts/toner/snapshot";

const snapshot = parseSnapshot(JSON.parse(fixture("toner.json")))!;
const measuredAt = new Date(snapshot.measuredAt);
const soon = new Date(measuredAt.getTime() + 3 * 60 * 60 * 1000);
const live = parseSupplies(fixture("stsply.htm"));
const toner = (list: ReturnType<typeof applySnapshot>, color: string) => list.find((s) => s.kind === "toner" && s.color === color)!;

describe("parseSnapshot", () => {
  it("accepts the published format", () => {
    expect(snapshot.model).toBe("ApeosPort-V C4476");
    expect(snapshot.supplies).toHaveLength(8);
  });

  it("rejects malformed input and drops invalid rows", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ schema: 2, model: "x", measuredAt: "2026-01-01", supplies: [] })).toBeNull();
    expect(parseSnapshot({ schema: 1, model: "x", measuredAt: "not a date", supplies: [] })).toBeNull();
    const s = parseSnapshot({
      schema: 1,
      model: "x",
      measuredAt: "2026-01-01T00:00:00Z",
      supplies: [{ kind: "toner", color: "cyan", percent: 140 }, { kind: "toner", color: "pink", percent: 3 }, { kind: "drum", color: "cyan", percent: 3 }],
    });
    expect(s?.supplies).toEqual([{ kind: "drum", color: "cyan", percent: 3 }]);
  });
});

describe("applySnapshot", () => {
  it("adds measured values that fall inside the live ranges", () => {
    const merged = applySnapshot(live, "ApeosPort-V C4476", snapshot, soon);
    expect(toner(merged, "yellow").measured).toEqual({ percent: 1, at: measuredAt });
    expect(toner(merged, "black").measured?.percent).toBe(33);
    // Drums are exact on the web already and are left alone.
    expect(merged.filter((s) => s.kind === "drum").every((s) => !s.measured)).toBe(true);
  });

  it("ignores a value that disagrees with the live range (e.g. after a cartridge change)", () => {
    const replaced = live.map((s) => (s.kind === "toner" && s.color === "yellow" ? { ...s, level: { min: 76, max: 100 } } : s));
    const merged = applySnapshot(replaced, "ApeosPort-V C4476", snapshot, soon);
    expect(toner(merged, "yellow").measured).toBeUndefined();
    expect(toner(merged, "magenta").measured?.percent).toBe(1);
  });

  it("ignores stale snapshots and other printer models", () => {
    const late = new Date(measuredAt.getTime() + MAX_SNAPSHOT_AGE_MS + 1);
    expect(applySnapshot(live, "ApeosPort-V C4476", snapshot, late)).toBe(live);
    expect(applySnapshot(live, "ApeosPort-VII C5573", snapshot, soon)).toBe(live);
    expect(applySnapshot(live, "FUJI XEROX ApeosPort-V C4476", snapshot, soon)).not.toBe(live);
  });
});

describe("snapshot helpers", () => {
  it("extracts the model from sysDescr", () => {
    expect(modelFromSysDescr("FUJI XEROX ApeosPort-V C4476;ESS1.60.7,IOT 32.84.0")).toBe("ApeosPort-V C4476");
  });

  it("converts levels to percentages without reporting a false 0%", () => {
    expect(toPercent(150, 15000)).toBe(1);
    expect(toPercent(8580, 26000)).toBe(33);
    expect(toPercent(10, 15000)).toBe(1);
    expect(toPercent(0, 15000)).toBe(0);
    expect(toPercent(-3, 45000)).toBeNull();
    expect(toPercent(5, 0)).toBeNull();
  });
});
