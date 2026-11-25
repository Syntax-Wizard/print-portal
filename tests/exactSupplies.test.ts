import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import { ALMOST_EMPTY_PERCENT, MAX_SNAPSHOT_AGE_MS, applySnapshot, applySnapshotAlerts, parseSnapshot } from "../src/printer/exactSupplies";
import { parseSupplies } from "../src/printer/parsers";
import { alertsFromTable, modelFromSysDescr, parseAlertDescription, toPercent } from "../scripts/toner/snapshot";

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

  it("turns toner at or below the threshold red, more urgent than the printer's own warning", () => {
    const merged = applySnapshot(live, "ApeosPort-V C4476", snapshot, soon);
    // Yellow and magenta measured 1%: the printer only says "have a spare ready".
    expect(toner(merged, "yellow")).toMatchObject({ state: "almostEmpty", severity: "error" });
    expect(toner(merged, "magenta")).toMatchObject({ state: "almostEmpty", severity: "error" });
    // Black 33% keeps the printer's warning; cyan 27% stays OK.
    expect(toner(merged, "black")).toMatchObject({ state: "orderSpare", severity: "warning" });
    expect(toner(merged, "cyan")).toMatchObject({ state: "ok", severity: "ok" });
  });

  it("uses a 5% threshold, inclusive", () => {
    expect(ALMOST_EMPTY_PERCENT).toBe(5);
    const at = (percent: number) => {
      const snap = { ...snapshot, supplies: [{ kind: "toner" as const, color: "yellow" as const, percent }] };
      return toner(applySnapshot(live, "ApeosPort-V C4476", snap, soon), "yellow");
    };
    expect(at(5).state).toBe("almostEmpty");
    expect(at(6).state).toBe("orderSpare");
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

describe("SNMP alerts", () => {
  it("parses alert descriptions", () => {
    expect(parseAlertDescription("094-421 The Transfer Belt Cleaner has reached end of life.")).toEqual({
      code: "094-421",
      message: "The Transfer Belt Cleaner has reached end of life.",
    });
    expect(parseAlertDescription("no code here")).toBeNull();
  });

  it("keeps warnings and critical alerts, drops informational ones and duplicates", () => {
    const rows = [
      { 2: 5, 8: Buffer.from("094-421 Transfer belt cleaner end of life.") },
      { 2: 1, 8: Buffer.from("016-424 The machine is in Low Power Mode.") },
      { 2: 3, 8: Buffer.from("077-101 Paper jam.") },
      { 2: 5, 8: Buffer.from("094-421 Transfer belt cleaner end of life.") },
    ];
    expect(alertsFromTable(rows).map((a) => [a.code, a.severity])).toEqual([
      ["094-421", "warning"],
      ["077-101", "error"],
    ]);
  });

  it("adds only alerts the web page does not already show", () => {
    const web = [{ severity: "warning" as const, code: "093-407", message: "web text", audience: "user" as const }];
    const merged = applySnapshotAlerts(web, "ApeosPort-V C4476", snapshot, soon);
    expect(merged.map((a) => a.code)).toEqual(["093-407", "094-421"]);
    expect(merged[0]!.message).toBe("web text");
    expect(merged[1]!.measuredAt).toEqual(measuredAt);
  });

  it("ignores alerts from stale snapshots", () => {
    const late = new Date(measuredAt.getTime() + MAX_SNAPSHOT_AGE_MS + 1);
    expect(applySnapshotAlerts([], "ApeosPort-V C4476", snapshot, late)).toEqual([]);
  });
});
