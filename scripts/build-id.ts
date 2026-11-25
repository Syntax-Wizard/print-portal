/**
 * One identifier per build, shared by both bundles so portal.js always asks for the
 * pdf-tools.js built alongside it (and never gets an older copy from the browser cache).
 */

import { execFileSync } from "node:child_process";

export function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf-8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8" }).trim() !== "";
    return dirty ? `${sha}-dev` : sha;
  } catch {
    return "dev";
  }
}
