/**
 * Translation between the semantic PrintOptions used by the UI and the form fields
 * expected by the printer's /UPLPRT.cmd endpoint (as sent by the printer's own print page).
 */

import { MEDIA_FIELD, PAPER_SIZE_FIELD, TRAY_FIELD } from "./mappings";
import type { PrintOptions } from "./types";

/** Lab defaults: 2-sided (long edge), automatic colour, A4, 1 copy. */
export const DEFAULT_OPTIONS: PrintOptions = {
  copies: 1,
  collate: "default",
  duplex: "long-edge",
  color: "auto",
  tray: "auto",
  paperSize: "A4",
  media: "default",
  delivery: { type: "normal" },
  pagesPerSheet: 1,
};

/** The firmware's own form sends this placeholder when no secure-print PIN is entered. */
const PIN_PLACEHOLDER = "************";

export const LIMITS = {
  copiesMin: 1,
  copiesMax: 999,
  userIdMaxLength: 24,
  pinMaxLength: 12,
} as const;

export type OptionsValidationError =
  | "copiesOutOfRange"
  | "userIdRequired"
  | "userIdTooLong"
  | "pinInvalid"
  | "timeInvalid";

export function validateOptions(o: PrintOptions): OptionsValidationError[] {
  const errors: OptionsValidationError[] = [];
  if (!Number.isInteger(o.copies) || o.copies < LIMITS.copiesMin || o.copies > LIMITS.copiesMax) {
    errors.push("copiesOutOfRange");
  }
  const d = o.delivery;
  if (d.type === "secure" || d.type === "sample") {
    if (d.userId.trim() === "") errors.push("userIdRequired");
    if (d.userId.length > LIMITS.userIdMaxLength) errors.push("userIdTooLong");
  }
  if (d.type === "secure" && !/^\d{1,12}$/.test(d.pin)) errors.push("pinInvalid");
  if (d.type === "delayed") {
    const okHour = Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23;
    const okMinute = Number.isInteger(d.minute) && d.minute >= 0 && d.minute <= 59;
    if (!okHour || !okMinute) errors.push("timeInvalid");
  }
  return errors;
}

/** Build the ordered form fields (excluding FILE) exactly as the firmware's own page does. */
export function toFormFields(o: PrintOptions): Array<[string, string]> {
  const d = o.delivery;
  const fields: Array<[string, string]> = [
    ["CPN", String(o.copies)],
    ["COLT", { default: "NO", on: "ON", off: "OFF" }[o.collate]],
    ["DUP", { none: "NO", "long-edge": "DP", "short-edge": "TB" }[o.duplex]],
    ["CLR", { auto: "AUTO", color: "CLR", bw: "BW" }[o.color]],
    ["IT", o.tray === "auto" ? "AUTO" : TRAY_FIELD[o.tray]],
    ["SIZ", o.paperSize === "default" ? "NUL" : PAPER_SIZE_FIELD[o.paperSize]],
    ["MED", o.media === "default" ? "NUL" : MEDIA_FIELD[o.media]],
    ["DEL", { normal: "IMP", sample: "PRP", delayed: "DLY", secure: "SECP" }[d.type]],
    ["PPUSR", d.type === "sample" ? d.userId : ""],
    ["HOUR", d.type === "delayed" ? String(d.hour) : ""],
    ["MIN", d.type === "delayed" ? String(d.minute) : ""],
    ["SPUSR", d.type === "secure" ? d.userId : ""],
    ["SPID", d.type === "secure" ? d.pin : PIN_PLACEHOLDER],
    ["RSPID", d.type === "secure" ? d.pin : PIN_PLACEHOLDER],
    ["ESPID", d.type === "secure" ? "on" : "off"],
  ];
  return fields;
}
