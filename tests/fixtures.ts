import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a sanitized printer page captured from the real device. */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../mock-printer/fixtures/${name}`, import.meta.url)), "utf-8");
}
