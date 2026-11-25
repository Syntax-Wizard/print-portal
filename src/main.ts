/**
 * Production entry point, loaded by the bookmarklet into the printer's own page.
 *
 * Browsers may serve an older portal.js from their cache for a few minutes after a release
 * (the bookmarklet's URL only changes hourly and GitHub Pages allows 10 minutes of caching).
 * So before taking over, ask the uncached version.json which build is current and, if it is
 * not this one, load that build instead.
 */

import css from "./ui/styles.css?inline";
import { takeover } from "./bootstrap";
import { bundleBase, rememberScriptBase } from "./pdf/loader";

type WithUpdate = Window & { __printPortalUpdating?: boolean };

const VERSION_TIMEOUT_MS = 3000;

async function latestBuildId(base: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null; // Offline or blocked: just start this build.
  } finally {
    clearTimeout(timer);
  }
}

async function start(): Promise<void> {
  const w = window as WithUpdate;
  const base = bundleBase();
  // Only one hop: the build we load does not check again, so this can never loop.
  if (base && !w.__printPortalUpdating) {
    const latest = await latestBuildId(base);
    if (latest && latest !== __BUILD_ID__) {
      w.__printPortalUpdating = true;
      const script = document.createElement("script");
      script.src = `${base}portal.js?b=${encodeURIComponent(latest)}`;
      script.onerror = () => takeover(css); // Fall back to the build we already have.
      (document.head || document.documentElement).appendChild(script);
      return;
    }
  }
  takeover(css);
}

// Must run first, while document.currentScript still points at this script.
rememberScriptBase();
void start();
