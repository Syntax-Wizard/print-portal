/**
 * Load pdf-view.js (pdf.js) on first use and start its worker.
 *
 * Production: the bundle and dist/pdf.worker.js come from wherever portal.js came from. The
 * worker code is fetched and started from a blob: URL, because browsers do not allow
 * cross-origin workers. Development: src/dev.tsx registers the bundle and worker directly.
 */

import { bundleBase, bundleUrl, injectScript } from "../pdf/loader";
import { PDF_VIEW_API } from "./api";
import type { PdfView } from "./index";

type WithView = Window & { PrintPortalPdfView?: PdfView; __printPortalPdfWorkerReady?: boolean };

export class PdfViewOutdatedError extends Error {
  constructor() {
    super("pdf-view.js does not match this version of the portal");
    this.name = "PdfViewOutdatedError";
  }
}

let pending: Promise<PdfView> | null = null;

async function load(): Promise<PdfView> {
  const w = window as WithView;
  if (!w.PrintPortalPdfView) await injectScript("pdf-view.js");
  const view = w.PrintPortalPdfView;
  if (!view) throw new Error("pdf-view.js did not register");
  if (view.apiVersion !== PDF_VIEW_API) throw new PdfViewOutdatedError();
  if (!w.__printPortalPdfWorkerReady) {
    const res = await fetch(bundleUrl("pdf.worker.js"));
    if (!res.ok) throw new Error("Could not load the PDF worker");
    const blob = new Blob([await res.text()], { type: "text/javascript" });
    view.useWorker(URL.createObjectURL(blob));
    // Decoders live next to the bundle, in a folder named after the pdf.js version (see build-site.ts).
    view.setWasmUrl(`${bundleBase()}pdfjs-wasm-${view.pdfjsVersion}/`);
    w.__printPortalPdfWorkerReady = true;
  }
  return view;
}

export function loadPdfView(): Promise<PdfView> {
  pending ??= load().catch((err) => {
    pending = null; // Allow a retry later.
    throw err;
  });
  return pending;
}
