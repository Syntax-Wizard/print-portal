/**
 * Translate the printer's SNMP alert texts, which its firmware only provides in English
 * (regardless of the panel language). Only wordings seen on the real device are recognised;
 * anything else is shown as the printer wrote it.
 */

import type { SupplyColor } from "../printer/types";

export type KnownAlert =
  | { key: "tonerReplaceSoon"; color: SupplyColor; waitForInstruction: boolean }
  | { key: "partEndOfLife"; part: KnownPart };

/** Parts whose names we can translate (add more as they are seen). */
const PARTS = { "transfer belt cleaner": "transferBeltCleaner" } as const;
export type KnownPart = (typeof PARTS)[keyof typeof PARTS];

/**
 * Seen on the ApeosPort-V C4476 (2026-11-25):
 *   093-407 "The Yellow Toner [Y] Cartridge needs to be replaced soon. Order a new Yellow Toner [Y] Cartridge. Printing can continue."
 *   093-408 "... Order a new Magenta Toner [M] Cartridge but do not replace until you are instructed to. Printing can continue."
 *   094-421 "The Transfer Belt Cleaner has reached end of life. Call your System Administrator to replace ... Printing can continue."
 */
export function recognizeAlert(message: string): KnownAlert | null {
  const toner = /^The (Black|Yellow|Magenta|Cyan) Toner \[[KYMC]\] Cartridge needs to be replaced soon\b/i.exec(message);
  if (toner) {
    return { key: "tonerReplaceSoon", color: toner[1]!.toLowerCase() as SupplyColor, waitForInstruction: /do not replace until you are instructed/i.test(message) };
  }
  const part = /^The (.+?) has reached end of life\b/i.exec(message);
  const known = part ? PARTS[part[1]!.toLowerCase() as keyof typeof PARTS] : undefined;
  if (known) return { key: "partEndOfLife", part: known };
  return null;
}
