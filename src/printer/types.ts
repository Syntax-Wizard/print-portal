/**
 * Language-neutral models returned by the printer adapter.
 * The UI translates every code; the adapter never returns display text except `raw` fallbacks.
 */

/** Overall severity used for colouring the UI. */
export type Severity = "ok" | "info" | "warning" | "error" | "unknown";

/** A value we could not map to a known code. The UI shows `raw` as-is. */
export interface Unmapped {
  raw: string;
}

export type DeviceState = "ready" | "printing" | "sleep" | "warmingUp" | "panelInUse" | "error" | "warning" | "offline";

export interface DeviceAlert {
  severity: Severity;
  code: string;
  /** Message text exactly as the printer reports it (in the printer's display language). */
  message: string;
  /** Who is expected to resolve it. */
  audience: "user" | "userAdvanced" | "engineer" | "admin" | "other";
  /** Set when the alert comes from a published SNMP snapshot rather than the live web page. */
  measuredAt?: Date;
}

export interface DeviceInfo {
  model: string;
  state: DeviceState | Unmapped;
  severity: Severity;
  alerts: DeviceAlert[];
}

export type TrayId = "T1" | "T2" | "T3" | "T4" | "bypass";

export type TrayState = "ok" | "empty" | "unknown" | "unavailable";

export interface Tray {
  id: TrayId | Unmapped;
  state: TrayState;
  /** Remaining paper in percent, or null when the printer cannot measure it (e.g. bypass tray). */
  levelPercent: number | null;
  size: PaperSize | Unmapped | null;
  media: MediaType | Unmapped | null;
  color: PaperColor | Unmapped | null;
  priority: number | null;
}

export interface OutputTray {
  name: string;
  state: "ok" | "full" | "lifting" | "unavailable";
}

export type SupplyKind = "toner" | "drum" | "wasteToner" | "other";
export type SupplyColor = "black" | "cyan" | "magenta" | "yellow";

export type SupplyState =
  | "ok"
  | "orderSpare"
  | "replaceSoon"
  | "replaceNow"
  | "nonGenuine"
  | "idError"
  | "settingUp"
  | "notInstalled"
  | "qualityEnd"
  | "sensorFailure"
  | "failure"
  | "checkRequired"
  /** Measured over SNMP at or below ALMOST_EMPTY_PERCENT: more urgent than the printer's own warning. */
  | "almostEmpty";

export interface Supply {
  kind: SupplyKind;
  color: SupplyColor | null;
  state: SupplyState | Unmapped;
  severity: Severity;
  /** Remaining life in percent as a range (min === max when exact), or null when not reported. */
  level: SupplyLevel | null;
  /** Name exactly as the printer reports it. */
  name: string;
  /** Exact level from a published SNMP snapshot, when it agrees with the live range. */
  measured?: { percent: number; at: Date };
}

export interface SupplyLevel {
  min: number;
  max: number;
}

export interface PrinterStatus {
  device: DeviceInfo;
  trays: Tray[];
  outputTrays: OutputTray[];
  supplies: Supply[];
  fetchedAt: Date;
}

/**
 * "processing" is not one of the printer's own states: it reports every running job as
 * 実行中, including ones whose data it is preparing while an earlier job prints. Only the
 * earliest running job is "printing"; the others are "processing" (see parseQueue).
 */
export type JobState = "waiting" | "processing" | "printing" | "paused" | "held" | "completed";
export type JobType = "print" | "copy" | "scan" | "mailboxRetrieval" | "fax" | "report" | "unknown";

export interface QueuedJob {
  id: string;
  /** Masked by the printer (`**********`) in most cases. */
  name: string;
  owner: string;
  state: JobState | Unmapped;
  type: JobType;
  completedCopies: number | null;
}

export type JobResult =
  | "unknown"
  | "completed"
  | "warning"
  | "aborted"
  | "shutdown"
  | "failed"
  | "incomingCall"
  | "remoteCheck";

export interface HistoryJob {
  name: string;
  owner: string;
  result: JobResult;
  type: JobType;
  pages: number | null;
  outputTray: string | null;
  /** Host interface, e.g. "HTTP" or "LPD". */
  hostInterface: string | null;
  /** Completion time in printer-local time (Asia/Tokyo). */
  completedAt: Date | null;
}

export interface ErrorLogEntry {
  at: Date | null;
  code: string;
}

export type PaperSize = "A3" | "B4" | "A4" | "B5" | "A5" | "letter" | "folio" | "legal" | "11x15" | "ledger";
export type MediaType = "plain" | "bond" | "recycled" | "user1" | "user2" | "user3" | "user4" | "user5";
export type PaperColor = "white";

export interface PrintOptions {
  copies: number;
  collate: "default" | "on" | "off";
  duplex: "none" | "long-edge" | "short-edge";
  color: "auto" | "color" | "bw";
  tray: "auto" | TrayId;
  paperSize: "default" | PaperSize;
  media: "default" | MediaType;
  delivery: Delivery;
  /** Pages printed on each sheet. Done in the browser for PDFs; the printer never sees it. */
  pagesPerSheet: 1 | 2 | 4;
}

export type Delivery =
  | { type: "normal" }
  | { type: "secure"; userId: string; pin: string }
  | { type: "sample"; userId: string }
  | { type: "delayed"; hour: number; minute: number };

export type SubmitErrorCode =
  | "FILE_REJECTED"
  | "OPTION_REJECTED"
  | "PRINTER_UNREACHABLE"
  | "PRINTER_ERROR"
  | "UNEXPECTED_RESPONSE"
  | "ABORTED";

export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      code: SubmitErrorCode;
      /** Field labels the printer flagged, as reported by the printer. */
      fields?: string[];
      httpStatus?: number;
    };

export function isUnmapped(value: unknown): value is Unmapped {
  return typeof value === "object" && value !== null && "raw" in value;
}
