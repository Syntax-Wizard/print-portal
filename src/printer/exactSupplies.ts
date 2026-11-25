/**
 * Exact toner levels measured over SNMP by a lab member's computer and published as a small
 * JSON file (see scripts/toner/). The browser cannot speak SNMP, so the web UI reads this
 * snapshot and merges it with the printer's live but coarse (25% step) web values.
 *
 * A measured value is only shown when it is consistent with the live range; otherwise the
 * cartridge was probably replaced or the snapshot is stale, and the UI falls back to the range.
 */

import type { Supply, SupplyColor } from "./types";

export const SNAPSHOT_SCHEMA = 1;

/** Snapshots older than this are ignored. */
export const MAX_SNAPSHOT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Allowed disagreement between the snapshot and the live range, for rounding differences. */
const TOLERANCE_PERCENT = 1;

export interface SnapshotSupply {
  kind: "toner" | "drum";
  color: SupplyColor;
  percent: number;
}

export interface SupplySnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  model: string;
  /** ISO 8601 time of the SNMP measurement. */
  measuredAt: string;
  supplies: SnapshotSupply[];
}

const COLORS: readonly SupplyColor[] = ["black", "cyan", "magenta", "yellow"];

/** Validate untrusted JSON. Returns null for anything that is not a well-formed snapshot. */
export function parseSnapshot(value: unknown): SupplySnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.schema !== SNAPSHOT_SCHEMA || typeof v.model !== "string" || typeof v.measuredAt !== "string") return null;
  if (Number.isNaN(Date.parse(v.measuredAt)) || !Array.isArray(v.supplies)) return null;
  const supplies: SnapshotSupply[] = [];
  for (const item of v.supplies) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const okKind = s.kind === "toner" || s.kind === "drum";
    const okColor = typeof s.color === "string" && (COLORS as readonly string[]).includes(s.color);
    const okPercent = typeof s.percent === "number" && Number.isFinite(s.percent) && s.percent >= 0 && s.percent <= 100;
    if (okKind && okColor && okPercent) supplies.push({ kind: s.kind as SnapshotSupply["kind"], color: s.color as SupplyColor, percent: s.percent as number });
  }
  return { schema: SNAPSHOT_SCHEMA, model: v.model, measuredAt: v.measuredAt, supplies };
}

function sameModel(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/fuji ?xerox|fujifilm/g, "").replace(/[^a-z0-9]/g, "");
  return n(a) !== "" && n(a) === n(b);
}

/**
 * Attach measured values to toners whose live range agrees with the snapshot.
 * Supplies are returned unchanged when the snapshot is missing, too old, or for another model.
 */
export function applySnapshot(supplies: Supply[], model: string, snapshot: SupplySnapshot | null, now: Date = new Date()): Supply[] {
  if (!snapshot || !sameModel(snapshot.model, model)) return supplies;
  const measuredAt = new Date(snapshot.measuredAt);
  const age = now.getTime() - measuredAt.getTime();
  if (age > MAX_SNAPSHOT_AGE_MS || age < -60 * 60 * 1000) return supplies;

  return supplies.map((s) => {
    if (s.kind !== "toner" || !s.color || !s.level) return s;
    const measured = snapshot.supplies.find((m) => m.kind === "toner" && m.color === s.color);
    if (!measured) return s;
    const consistent = measured.percent >= s.level.min - TOLERANCE_PERCENT && measured.percent <= s.level.max + TOLERANCE_PERCENT;
    return consistent ? { ...s, measured: { percent: measured.percent, at: measuredAt } } : s;
  });
}
