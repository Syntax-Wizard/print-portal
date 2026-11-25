/**
 * Measure exact toner levels over SNMP and publish them to the `toner-data` branch, which the
 * web UI reads from raw.githubusercontent.com. Meant to run every hour on a lab member's Mac
 * (see install-agent.sh); it does nothing when the printer is not reachable.
 *
 * Usage: npx tsx scripts/toner/publish.ts --printer <host> [--force] [--dry-run]
 *
 * Publishes only when a value changed or the last publish is older than 12 hours, and always
 * force-pushes a single commit so the branch never grows.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupplySnapshot } from "../../src/printer/exactSupplies";
import { takeSnapshot } from "./snapshot";

const BRANCH = "toner-data";
const FILE = "toner.json";
const REFRESH_MS = 12 * 60 * 60 * 1000;
const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const stateFile = join(homedir(), "Library", "Application Support", "print-portal", "last-toner.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function loadLast(): SupplySnapshot | null {
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8")) as SupplySnapshot;
  } catch {
    return null;
  }
}

function sameLevels(a: SupplySnapshot, b: SupplySnapshot): boolean {
  const key = (s: SupplySnapshot) => JSON.stringify([s.model, [...s.supplies].sort((x, y) => `${x.kind}${x.color}`.localeCompare(`${y.kind}${y.color}`))]);
  return key(a) === key(b);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function publish(snapshot: SupplySnapshot): void {
  const remote = git(repoDir, "remote", "get-url", "origin");
  const name = git(repoDir, "config", "user.name");
  const email = git(repoDir, "config", "user.email");
  const dir = mkdtempSync(join(tmpdir(), "print-portal-toner-"));
  try {
    writeFileSync(join(dir, FILE), JSON.stringify(snapshot, null, 2) + "\n");
    git(dir, "init", "-q", "-b", BRANCH);
    git(dir, "add", FILE);
    git(dir, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", `Toner levels measured ${snapshot.measuredAt}`);
    git(dir, "push", "-q", "--force", remote, `HEAD:refs/heads/${BRANCH}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const host = arg("printer") ?? process.env.PRINTER_HOST;
  if (!host) throw new Error("Pass --printer <host> or set PRINTER_HOST");

  let snapshot: SupplySnapshot;
  try {
    snapshot = await takeSnapshot(host);
  } catch (err) {
    // Normal when this computer is away from the lab network.
    log(`Printer not reachable, nothing to do (${(err as Error).message})`);
    return;
  }
  const summary = snapshot.supplies.filter((s) => s.kind === "toner").map((s) => `${s.color} ${s.percent}%`).join(", ");

  const last = loadLast();
  const fresh = last && Date.now() - Date.parse(last.measuredAt) < REFRESH_MS;
  if (!flag("force") && last && fresh && sameLevels(last, snapshot)) {
    log(`Unchanged (${summary}), not publishing`);
    return;
  }
  if (flag("dry-run")) {
    log(`Would publish: ${JSON.stringify(snapshot)}`);
    return;
  }
  publish(snapshot);
  mkdirSync(join(stateFile, ".."), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(snapshot, null, 2));
  log(`Published (${summary})`);
}

main().catch((err) => {
  log(`Failed: ${(err as Error).stack ?? err}`);
  process.exitCode = 1;
});
