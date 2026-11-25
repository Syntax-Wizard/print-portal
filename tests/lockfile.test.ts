import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * npm on macOS sometimes writes optional, other-platform packages as entries with no version
 * (seen with pdfjs-dist -> @napi-rs/canvas). `npm ci` on the Linux CI runner then fails with
 * "Invalid Version", which broke a deploy. Catch it before pushing.
 * Fix: regenerate the lockfile with `rm package-lock.json && npm install --package-lock-only`.
 */
describe("package-lock.json", () => {
  it("has a version for every installed package", () => {
    const lock = JSON.parse(readFileSync(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf-8")) as {
      packages: Record<string, { version?: string; link?: boolean }>;
    };
    const broken = Object.entries(lock.packages)
      .filter(([path, entry]) => path.startsWith("node_modules/") && !entry.link && !entry.version)
      .map(([path]) => path);
    expect(broken).toEqual([]);
  });
});
