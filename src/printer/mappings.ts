/**
 * Tables that turn printer-reported values into language-neutral codes.
 *
 * Most values arrive as indices (stable across firmware languages). A few arrive as
 * display text; those are matched against both the Japanese and the English firmware wording.
 * Anything unknown is passed through as `{ raw }` so the UI can still show it.
 */

import type {
  DeviceState,
  JobResult,
  JobState,
  JobType,
  MediaType,
  PaperColor,
  PaperSize,
  Severity,
  SupplyColor,
  SupplyState,
  TrayId,
  TrayState,
  Unmapped,
} from "./types";

export function lookup<T extends string>(table: readonly T[], index: unknown): T | undefined {
  return typeof index === "number" && Number.isInteger(index) ? table[index] : undefined;
}

// ---- Indexed tables (order mirrors the firmware's own label arrays) ----

/** jblist.htm `stats` */
export const JOB_STATES: readonly JobState[] = ["waiting", "printing", "paused", "held", "completed"];

/** jblist.htm / jbhist.htm `types` */
export const JOB_TYPES: readonly JobType[] = ["unknown", "print", "copy", "scan", "mailboxRetrieval", "fax", "report"];

/** jbhist.htm `stsAry` */
export const JOB_RESULTS: readonly JobResult[] = [
  "unknown",
  "completed",
  "warning",
  "warning",
  "aborted",
  "aborted",
  "aborted",
  "shutdown",
  "failed",
  "incomingCall",
  "remoteCheck",
];

/** sttray.htm `stsIn` */
export const TRAY_STATES: readonly TrayState[] = ["ok", "empty", "unknown", "unavailable"];

/** sttray.htm `stsOut` */
export const OUTPUT_TRAY_STATES = ["ok", "full", "lifting", "unavailable"] as const;

/** stsply.htm `stsTnr` */
export const TONER_STATES: readonly SupplyState[] = [
  "ok",
  "nonGenuine",
  "replaceSoon",
  "replaceNow",
  "settingUp",
  "notInstalled",
  "failure",
  "orderSpare",
  "checkRequired",
];

/** stsply.htm `stsDrm` */
export const DRUM_STATES: readonly SupplyState[] = [
  "ok",
  "idError",
  "nonGenuine",
  "orderSpare",
  "replaceNow",
  "notInstalled",
  "notInstalled",
  "qualityEnd",
  "failure",
  "replaceSoon",
];

/** stsply.htm `stsTnrBtl` */
export const WASTE_TONER_STATES: readonly SupplyState[] = ["ok", "orderSpare", "replaceNow", "sensorFailure", "notInstalled"];

/**
 * Severity per supply state. The firmware marks "order a spare" as OK; we surface it as a
 * warning because the whole point of the new UI is to notice low toner early.
 */
export const SUPPLY_SEVERITY: Record<SupplyState, Severity> = {
  ok: "ok",
  orderSpare: "warning",
  replaceSoon: "warning",
  settingUp: "info",
  checkRequired: "warning",
  qualityEnd: "warning",
  replaceNow: "error",
  nonGenuine: "error",
  idError: "error",
  notInstalled: "error",
  sensorFailure: "error",
  failure: "error",
};

/** stgen.htm `artIcon` index: check / optional / required. */
export const ALERT_SEVERITY: readonly Severity[] = ["info", "warning", "error"];

/** stgen.htm `ArtSkill` */
export const ALERT_AUDIENCE = ["user", "userAdvanced", "engineer", "admin", "other"] as const;

// ---- Form-field codes used by /UPLPRT.cmd ----

export const PAPER_SIZE_FIELD: Record<PaperSize, string> = {
  A3: "A3",
  B4: "B4",
  A4: "A4",
  B5: "B5",
  A5: "A5",
  letter: "LT",
  folio: "FL",
  legal: "LG",
  "11x15": "I15",
  ledger: "LD",
};

export const MEDIA_FIELD: Record<MediaType, string> = {
  plain: "NR",
  bond: "HQ",
  recycled: "RC",
  user1: "U1",
  user2: "U2",
  user3: "U3",
  user4: "U4",
  user5: "U5",
};

export const TRAY_FIELD: Record<TrayId, string> = {
  T1: "T1",
  T2: "T2",
  T3: "T3",
  T4: "T4",
  bypass: "SMH",
};

// ---- Text tables (Japanese and English firmware wording) ----

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function mapText<T extends string>(rules: ReadonlyArray<[RegExp, T]>, text: unknown): T | Unmapped | null {
  if (typeof text !== "string" || text === "" || text === "-") return null;
  const n = normalize(text);
  for (const [re, code] of rules) if (re.test(n)) return code;
  return { raw: text };
}

const DEVICE_STATE_RULES: ReadonlyArray<[RegExp, DeviceState]> = [
  [/節電|低電力|スリープ|power ?sav|sleep|low power/, "sleep"],
  [/ウォームアップ|warm/, "warmingUp"],
  [/プリント中|印刷中|printing/, "printing"],
  [/プリントできます|印刷できます|準備完了|ready|idle/, "ready"],
];

export function mapDeviceState(text: unknown): DeviceState | Unmapped | null {
  return mapText(DEVICE_STATE_RULES, text);
}

/** stgen.htm `spcs` status kind flag: 'i' info, 'w' warning, 'f' fault. */
export function mapDeviceSeverity(flag: unknown): Severity {
  if (flag === "i") return "ok";
  if (flag === "w") return "warning";
  if (flag === "f") return "error";
  return typeof flag === "string" && flag !== "" ? "error" : "unknown";
}

const PAPER_SIZE_RULES: ReadonlyArray<[RegExp, PaperSize]> = [
  [/^a3/, "A3"],
  [/^b4/, "B4"],
  [/^a4/, "A4"],
  [/^b5/, "B5"],
  [/^a5/, "A5"],
  [/^8\.5 ?x ?11|letter/, "letter"],
  [/^8\.5 ?x ?13|folio/, "folio"],
  [/^8\.5 ?x ?14|legal/, "legal"],
  [/^11 ?x ?15/, "11x15"],
  [/^11 ?x ?17|ledger|tabloid/, "ledger"],
];

export function mapPaperSize(text: unknown): PaperSize | Unmapped | null {
  return mapText(PAPER_SIZE_RULES, text);
}

const MEDIA_RULES: ReadonlyArray<[RegExp, MediaType]> = [
  [/普通紙|^plain/, "plain"],
  [/上質紙|^bond/, "bond"],
  [/再生紙|^recycled/, "recycled"],
  [/(ユーザー用紙|^custom ?paper ?|^user ?paper ?)1/, "user1"],
  [/(ユーザー用紙|^custom ?paper ?|^user ?paper ?)2/, "user2"],
  [/(ユーザー用紙|^custom ?paper ?|^user ?paper ?)3/, "user3"],
  [/(ユーザー用紙|^custom ?paper ?|^user ?paper ?)4/, "user4"],
  [/(ユーザー用紙|^custom ?paper ?|^user ?paper ?)5/, "user5"],
];

export function mapMedia(text: unknown): MediaType | Unmapped | null {
  return mapText(MEDIA_RULES, text);
}

export function mapPaperColor(text: unknown): PaperColor | Unmapped | null {
  return mapText<PaperColor>([[/^白$|^white$/, "white"]], text);
}

/** "トレイ1" / "Tray 1" -> T1, "トレイ5(手差し)" / "Tray 5 (Bypass)" -> bypass. */
export function mapTrayId(text: unknown): TrayId | Unmapped | null {
  if (typeof text !== "string" || text === "") return null;
  const n = normalize(text);
  if (/手差し|bypass|manual/.test(n)) return "bypass";
  const digit = /(\d)/.exec(n)?.[1];
  if (digit === "1" || digit === "2" || digit === "3" || digit === "4") return `T${digit}` as TrayId;
  if (digit === "5") return "bypass";
  return { raw: text };
}

/** Detect the colour of a toner/drum from names like "ブラックトナー(K)" or "Black Drum Cartridge". */
export function mapSupplyColor(name: string): SupplyColor | null {
  const n = normalize(name);
  if (/\(k\)|ブラック|black/.test(n)) return "black";
  if (/\(c\)|シアン|cyan/.test(n)) return "cyan";
  if (/\(m\)|マゼンタ|magenta/.test(n)) return "magenta";
  if (/\(y\)|イエロー|yellow/.test(n)) return "yellow";
  return null;
}

/** Map "-" and empty values to null, keep numbers. */
export function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** Parse the printer's "YYYY/MM/DD HH:MM" timestamps as Asia/Tokyo time. */
export function parsePrinterDate(text: unknown): Date | null {
  if (typeof text !== "string") return null;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const pad = (v: string) => v.padStart(2, "0");
  const date = new Date(`${y}-${pad(mo!)}-${pad(d!)}T${pad(h)}:${pad(mi)}:${pad(s)}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
