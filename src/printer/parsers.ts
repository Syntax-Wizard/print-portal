/**
 * Page-specific parsers: printer HTML -> typed, language-neutral models.
 *
 * Every parser is defensive: rows with an unexpected shape are skipped rather than
 * throwing, so a firmware quirk degrades one row instead of the whole screen.
 */

import { extractBodyText, extractConcatenated, extractTitle, extractVar } from "./html";
import type { JsValue } from "./jsLiteral";
import {
  ALERT_AUDIENCE,
  ALERT_SEVERITY,
  DRUM_STATES,
  JOB_RESULTS,
  JOB_STATES,
  JOB_TYPES,
  OUTPUT_TRAY_STATES,
  SUPPLY_SEVERITY,
  TONER_STATES,
  TRAY_STATES,
  WASTE_TONER_STATES,
  lookup,
  mapDeviceSeverity,
  mapDeviceState,
  mapMedia,
  mapPaperColor,
  mapPaperSize,
  mapSupplyColor,
  mapTrayId,
  numberOrNull,
  parsePrinterDate,
} from "./mappings";
import type {
  DeviceAlert,
  DeviceInfo,
  ErrorLogEntry,
  HistoryJob,
  OutputTray,
  QueuedJob,
  SubmitResult,
  Supply,
  SupplyKind,
  SupplyLevel,
  SupplyState,
  Tray,
} from "./types";

type Row = JsValue[];

function rows(value: JsValue | undefined): Row[] {
  return Array.isArray(value) ? value.filter((r): r is Row => Array.isArray(r)) : [];
}

function str(value: JsValue | undefined): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function strOrNull(value: JsValue | undefined): string | null {
  const s = str(value);
  return s === "" || s === "-" ? null : s;
}

// ---- stgen.htm ----

export function parseGeneral(html: string): DeviceInfo {
  const spcs = extractVar(html, "spcs");
  const spec = Array.isArray(spcs) ? spcs : [];
  // spcs = [model, addresses, fax, location, statusText, statusFlag]
  const statusText = spec[4];
  const state = mapDeviceState(statusText) ?? { raw: "" };
  const severity = mapDeviceSeverity(spec[5]);

  const alerts: DeviceAlert[] = [];
  const artinfo = extractVar(html, "artinfo");
  // artinfo = [hasAlerts(1|0), [iconIndex, code, message, audienceIndex], ...]
  if (Array.isArray(artinfo) && artinfo[0] === 1) {
    for (const row of rows(artinfo.slice(1))) {
      alerts.push({
        severity: lookup(ALERT_SEVERITY, row[0]) ?? "unknown",
        code: str(row[1]),
        message: str(row[2]),
        audience: lookup(ALERT_AUDIENCE, row[3]) ?? "other",
      });
    }
  }

  return { model: str(spec[0]), state, severity, alerts };
}

// ---- sttray.htm ----

export function parseTrays(html: string): { trays: Tray[]; outputTrays: OutputTray[] } {
  // infoIn row = [name, stateIndex, levelPercent, size, color, media, priority, ...]
  const trays: Tray[] = rows(extractVar(html, "infoIn")).map((row) => ({
    id: mapTrayId(row[0]) ?? { raw: str(row[0]) },
    state: lookup(TRAY_STATES, row[1]) ?? "unknown",
    levelPercent: numberOrNull(row[2]),
    size: mapPaperSize(row[3]),
    color: mapPaperColor(row[4]),
    media: mapMedia(row[5]),
    priority: numberOrNull(row[6]),
  }));
  // infoOut row = [name, stateIndex]
  const outputTrays: OutputTray[] = rows(extractVar(html, "infoOut")).map((row) => ({
    name: str(row[0]),
    state: lookup(OUTPUT_TRAY_STATES, row[1]) ?? "unavailable",
  }));
  return { trays, outputTrays };
}

// ---- stsply.htm ----

/** Component kinds as used in stsply.htm's `switch (info[v][2])`. */
const KIND_DRUM = 1;
const KIND_WASTE_TONER = 2;
const KIND_TONER = 3;

/**
 * The web UI reports toner in 25% steps, rounded up: compared with the exact SNMP values on the
 * real device, 33% showed as 50 and 1% as 25. A reported 25 therefore means "1 to 25%".
 * Drum values matched SNMP exactly, so they are taken as-is.
 */
const TONER_STEP = 25;

export function supplyLevel(kind: SupplyKind, value: JsValue | undefined): SupplyLevel | null {
  const n = numberOrNull(value);
  if (n === null || n < 0 || n > 100) return null;
  if (kind === "toner" && n > 0 && n % TONER_STEP === 0) return { min: n - TONER_STEP + 1, max: n };
  return { min: n, max: n };
}

function supply(kind: SupplyKind, name: string, stateIndex: JsValue | undefined, table: readonly SupplyState[], level: JsValue | undefined): Supply {
  const state = lookup(table, stateIndex);
  return {
    kind,
    color: kind === "toner" || kind === "drum" ? mapSupplyColor(name) : null,
    state: state ?? { raw: str(stateIndex) },
    severity: state ? SUPPLY_SEVERITY[state] : "unknown",
    level: supplyLevel(kind, level),
    name,
  };
}

export function parseSupplies(html: string): Supply[] {
  const out: Supply[] = [];
  // Group: [category, [[name, stateIndex, levelPercent, date], ...], kind]
  // Single: [name, stateIndex, kind, date]
  for (const entry of rows(extractConcatenated(html, "info"))) {
    const kind = entry[2];
    if (kind === KIND_TONER || kind === KIND_DRUM) {
      const isToner = kind === KIND_TONER;
      for (const item of rows(entry[1])) {
        out.push(supply(isToner ? "toner" : "drum", str(item[0]), item[1], isToner ? TONER_STATES : DRUM_STATES, item[2]));
      }
    } else if (kind === KIND_WASTE_TONER) {
      out.push(supply("wasteToner", str(entry[0]), entry[1], WASTE_TONER_STATES, undefined));
    } else {
      // Other components (fuser, staples, ...) are not present on this model; keep them generic.
      out.push({ kind: "other", color: null, state: { raw: str(entry[1]) }, severity: "unknown", level: null, name: str(entry[0]) });
    }
  }
  return out;
}

// ---- jblist.htm ----

export function parseQueue(html: string): QueuedJob[] {
  // info row = [jobId, name, owner, stateIndex, typeIndex, completedCopies]
  return rows(extractVar(html, "info")).map((row) => ({
    id: str(row[0]),
    name: str(row[1]),
    owner: str(row[2]),
    state: lookup(JOB_STATES, row[3]) ?? { raw: str(row[3]) },
    type: lookup(JOB_TYPES, row[4]) ?? "unknown",
    completedCopies: numberOrNull(row[5]),
  }));
}

// ---- jbhist.htm ----

export function parseHistory(html: string): HistoryJob[] {
  // jHst row = [name, owner, resultIndex, typeIndex, pages, outputTray, hostInterface, completedAt]
  return rows(extractVar(html, "jHst")).map((row) => ({
    name: str(row[0]),
    owner: str(row[1]),
    result: lookup(JOB_RESULTS, row[2]) ?? "unknown",
    type: lookup(JOB_TYPES, row[3]) ?? "unknown",
    pages: numberOrNull(row[4]),
    outputTray: strOrNull(row[5]),
    hostInterface: strOrNull(row[6]),
    completedAt: parsePrinterDate(row[7]),
  }));
}

// ---- sperr.htm ----

export function parseErrorLog(html: string): ErrorLogEntry[] {
  // errLog row = [time, code]
  return rows(extractVar(html, "errLog")).map((row) => ({ at: parsePrinterDate(row[0]), code: str(row[1]) }));
}

// ---- /UPLPRT.cmd response ----

export function parseUploadResponse(httpStatus: number, html: string): SubmitResult {
  const title = (extractTitle(html) ?? "").toUpperCase();
  if (title.includes("ACCEPTED")) return { ok: true };
  if (title.includes("ERROR")) {
    // The body lists the labels of the rejected fields after a fixed two-line preamble, e.g.
    // ["リクエストは実行できませんでした。", "次の項目の設定値を確認してください。", "ファイル"].
    const lines = extractBodyText(html);
    const fields = lines.slice(2);
    const fileRejected = fields.some((f) => /ファイル|file/i.test(f));
    return { ok: false, code: fileRejected ? "FILE_REJECTED" : fields.length ? "OPTION_REJECTED" : "PRINTER_ERROR", fields, httpStatus };
  }
  return { ok: false, code: "UNEXPECTED_RESPONSE", httpStatus };
}

/** True when a page looks like it came from this printer family's web UI. */
export function isPrinterPage(html: string): boolean {
  return /Internet Services/i.test(extractTitle(html) ?? "") || /var\s+jtPath\s*=/.test(html);
}
