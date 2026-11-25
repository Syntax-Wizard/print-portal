/**
 * Group printer error codes ("chain-link" codes such as 071-105) into categories the UI can
 * translate. The chain (first three digits) identifies the area of the machine, following
 * Fuji Xerox service conventions. Codes outside the table fall back to "other".
 */

const CHAINS = ["005", "010", "016", "033", "071", "072", "073", "074", "075", "077"] as const;

export type ErrorCategory = (typeof CHAINS)[number] | "09x" | "other";

export function errorCategory(code: string): ErrorCategory {
  const chain = /^(\d{3})-\d{3}$/.exec(code.trim())?.[1];
  if (!chain) return "other";
  if ((CHAINS as readonly string[]).includes(chain)) return chain as ErrorCategory;
  if (/^09[1-4]$/.test(chain)) return "09x";
  return "other";
}
