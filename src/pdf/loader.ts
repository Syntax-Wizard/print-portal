/**
 * Load the PDF tools bundle on first use.
 *
 * Production: inject <script src="<base>/pdf-tools.js">, where <base> is wherever portal.js
 * came from (recorded at startup). Development: src/dev.tsx imports the tools directly.
 */

import { PDF_TOOLS_API } from "./api";
import type { PdfTools } from "./index";

type WithTools = Window & { PrintPortalPdf?: PdfTools; __printPortalBase?: string };

let pending: Promise<PdfTools> | null = null;

/** Remember where portal.js was loaded from. Must run while the script is executing. */
export function rememberScriptBase(): void {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) (window as WithTools).__printPortalBase = new URL(".", src).href;
}

/** Raised when the loaded pdf-tools.js belongs to a different release than this portal.js. */
export class PdfToolsOutdatedError extends Error {
  constructor() {
    super("pdf-tools.js does not match this version of the portal");
    this.name = "PdfToolsOutdatedError";
  }
}

function checked(tools: PdfTools): PdfTools {
  if (tools.apiVersion !== PDF_TOOLS_API) throw new PdfToolsOutdatedError();
  return tools;
}

/** Base URL that portal.js (and therefore every lazily loaded bundle) is served from. */
export function bundleBase(): string | undefined {
  return (window as WithTools).__printPortalBase;
}

/** URL of another file from this build, cache-busted with the build id. */
export function bundleUrl(file: string): string {
  const base = bundleBase();
  if (!base) throw new Error(`Location of ${file} unknown`);
  return `${base}${file}?b=${encodeURIComponent(__BUILD_ID__)}`;
}

/** Load a script from this build once; resolves when it has run. */
export function injectScript(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let src: string;
    try {
      src = bundleUrl(file);
    } catch (err) {
      return reject(err);
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${file}`));
    document.head.appendChild(script);
  });
}

export function loadPdfTools(): Promise<PdfTools> {
  const w = window as WithTools;
  if (w.PrintPortalPdf) {
    try {
      return Promise.resolve(checked(w.PrintPortalPdf));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  if (pending) return pending;
  pending = new Promise<PdfTools>((resolve, reject) => {
    const base = w.__printPortalBase;
    if (!base) return reject(new Error("PDF tools location unknown"));
    const script = document.createElement("script");
    // The build id ties this request to the pdf-tools.js built with this portal.js.
    script.src = `${base}pdf-tools.js?b=${encodeURIComponent(__BUILD_ID__)}`;
    script.onload = () => {
      if (!w.PrintPortalPdf) return reject(new Error("PDF tools did not register"));
      try {
        resolve(checked(w.PrintPortalPdf));
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error("Could not load PDF tools"));
    document.head.appendChild(script);
  }).catch((err) => {
    pending = null; // Allow a retry later.
    throw err;
  });
  return pending;
}
