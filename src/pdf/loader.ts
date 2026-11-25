/**
 * Load the PDF tools bundle on first use.
 *
 * Production: inject <script src="<base>/pdf-tools.js">, where <base> is wherever portal.js
 * came from (recorded at startup). Development: src/dev.tsx imports the tools directly.
 */

import type { PdfTools } from "./index";

type WithTools = Window & { PrintPortalPdf?: PdfTools; __printPortalBase?: string };

let pending: Promise<PdfTools> | null = null;

/** Remember where portal.js was loaded from. Must run while the script is executing. */
export function rememberScriptBase(): void {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (src) (window as WithTools).__printPortalBase = new URL(".", src).href;
}

export function loadPdfTools(): Promise<PdfTools> {
  const w = window as WithTools;
  if (w.PrintPortalPdf) return Promise.resolve(w.PrintPortalPdf);
  if (pending) return pending;
  pending = new Promise<PdfTools>((resolve, reject) => {
    const base = w.__printPortalBase;
    if (!base) return reject(new Error("PDF tools location unknown"));
    const script = document.createElement("script");
    script.src = `${base}pdf-tools.js?v=${encodeURIComponent(__PORTAL_VERSION__)}`;
    script.onload = () => (w.PrintPortalPdf ? resolve(w.PrintPortalPdf) : reject(new Error("PDF tools did not register")));
    script.onerror = () => reject(new Error("Could not load PDF tools"));
    document.head.appendChild(script);
  }).catch((err) => {
    pending = null; // Allow a retry later.
    throw err;
  });
  return pending;
}
