/**
 * Read exact toner and drum levels from the printer over SNMP (Printer MIB, RFC 3805).
 * Only the model name and percentages are kept: no address, serial numbers or firmware info.
 */

import snmp from "net-snmp";
import { mapSupplyColor } from "../../src/printer/mappings";
import { SNAPSHOT_SCHEMA, type SnapshotAlert, type SnapshotSupply, type SupplySnapshot } from "../../src/printer/exactSupplies";

const OID = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  suppliesTable: "1.3.6.1.2.1.43.11.1.1",
  alertTable: "1.3.6.1.2.1.43.18.1.1",
} as const;

/** prtAlertTable columns and prtAlertSeverityLevel values (RFC 3805). */
const ALERT_COL = { severity: 2, description: 8 } as const;
const ALERT_SEVERITY: Record<number, SnapshotAlert["severity"]> = { 3: "error", 4: "warning", 5: "warning" };

/** prtMarkerSuppliesTable columns. */
const COL = { type: 5, description: 6, maxCapacity: 8, level: 9 } as const;
/** prtMarkerSuppliesType values. */
const TYPE = { toner: 3, opc: 9 } as const;

type Varbind = snmp.Varbind;

function walk(session: snmp.Session, oid: string): Promise<Varbind[]> {
  return new Promise((resolve, reject) => {
    const rows: Varbind[] = [];
    session.subtree(
      oid,
      20,
      (varbinds: Varbind[]) => {
        // Must not return true: net-snmp treats that as "stop walking".
        for (const vb of varbinds) if (!snmp.isVarbindError(vb)) rows.push(vb);
      },
      (error: Error | null) => (error ? reject(error) : resolve(rows)),
    );
  });
}

function get(session: snmp.Session, oid: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    session.get([oid], (error: Error | null, varbinds?: Varbind[]) => {
      if (error || !varbinds?.[0] || snmp.isVarbindError(varbinds[0])) reject(error ?? new Error(`No value for ${oid}`));
      else resolve(varbinds[0].value);
    });
  });
}

/** The printer encodes Japanese text as Shift_JIS. */
function decodeText(value: unknown): string {
  if (Buffer.isBuffer(value)) return new TextDecoder("shift_jis").decode(value);
  return String(value ?? "");
}

/** "FUJI XEROX ApeosPort-V C4476;ESS1.60.7,..." -> "ApeosPort-V C4476" */
export function modelFromSysDescr(sysDescr: string): string {
  return sysDescr.split(";")[0]!.replace(/^\s*(FUJI\s*XEROX|FUJIFILM)\s*/i, "").trim();
}

export function toPercent(level: number, max: number): number | null {
  if (!Number.isFinite(level) || !Number.isFinite(max) || max <= 0 || level < 0) return null; // -2 unknown, -3 "some remaining"
  const pct = Math.round((level / max) * 100);
  // Never report 0% while something is left: 0 would read as "empty".
  return Math.min(100, level > 0 ? Math.max(1, pct) : 0);
}

/** Group a walked table into rows keyed by index, with cells keyed by column number. */
function toRows(base: string, varbinds: Varbind[]): Map<string, Partial<Record<number, unknown>>> {
  const table = new Map<string, Partial<Record<number, unknown>>>();
  for (const { oid, value } of varbinds) {
    const parts = oid.slice(base.length + 1).split(".");
    const column = Number(parts[0]);
    const index = parts.slice(1).join(".");
    table.set(index, { ...table.get(index), [column]: value });
  }
  return table;
}

/** "094-421 The Transfer Belt Cleaner has reached end of life. ..." -> code + message. */
export function parseAlertDescription(text: string): { code: string; message: string } | null {
  const m = /^\s*(\d{3}-\d{3})\s+(.+?)\s*$/s.exec(text);
  return m ? { code: m[1]!, message: m[2]! } : null;
}

/** Warnings and critical alerts only: informational ones such as "Low Power Mode" are dropped. */
export function alertsFromTable(rows: Iterable<Partial<Record<number, unknown>>>): SnapshotAlert[] {
  const alerts: SnapshotAlert[] = [];
  for (const row of rows) {
    const severity = ALERT_SEVERITY[Number(row[ALERT_COL.severity])];
    const parsed = parseAlertDescription(decodeText(row[ALERT_COL.description]));
    if (severity && parsed && !alerts.some((a) => a.code === parsed.code)) alerts.push({ ...parsed, severity });
  }
  return alerts;
}

export async function takeSnapshot(host: string, community = "public", timeoutMs = 5000): Promise<SupplySnapshot> {
  const session = snmp.createSession(host, community, { version: snmp.Version2c, timeout: timeoutMs, retries: 1 });
  try {
    const model = modelFromSysDescr(decodeText(await get(session, OID.sysDescr)));
    const table = toRows(OID.suppliesTable, await walk(session, OID.suppliesTable));
    const supplies: SnapshotSupply[] = [];
    for (const row of table.values()) {
      const type = Number(row[COL.type]);
      const kind = type === TYPE.toner ? "toner" : type === TYPE.opc ? "drum" : null;
      const color = mapSupplyColor(decodeText(row[COL.description]));
      const percent = toPercent(Number(row[COL.level]), Number(row[COL.maxCapacity]));
      if (kind && color && percent !== null) supplies.push({ kind, color, percent });
    }
    if (supplies.length === 0) throw new Error("No toner or drum levels found in the Printer MIB");
    // Alerts are a bonus: a printer without an alert table still gets its levels published.
    let alerts: SnapshotAlert[] = [];
    try {
      alerts = alertsFromTable(toRows(OID.alertTable, await walk(session, OID.alertTable)).values());
    } catch {
      alerts = [];
    }
    return { schema: SNAPSHOT_SCHEMA, model, measuredAt: new Date().toISOString(), supplies, alerts };
  } finally {
    session.close();
  }
}
