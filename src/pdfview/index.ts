/**
 * Entry point of the on-demand pdf-view.js bundle: renders PDF pages to images with pdf.js
 * (used for mailbox thumbnails). Registers itself on window like pdf-tools.js.
 */

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDF_VIEW_API } from "./api";

let workerStarted = false;

/**
 * pdf.js renders in a Web Worker. Browsers refuse workers from another origin (the bundle
 * comes from GitHub Pages, the page is the printer), so the caller passes a same-origin
 * blob: URL holding the worker code.
 */
function useWorker(url: string): void {
  if (workerStarted) return;
  GlobalWorkerOptions.workerPort = new Worker(url, { type: "module" });
  workerStarted = true;
}

/** Render page 1 to a PNG data URL about `width` CSS pixels wide (sharp on high-DPI screens). */
async function renderThumbnail(data: Uint8Array, width: number): Promise<string> {
  const task = getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = (width * Math.min(2, globalThis.devicePixelRatio || 1)) / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    await task.destroy();
  }
}

export const pdfView = { apiVersion: PDF_VIEW_API, buildId: __BUILD_ID__, useWorker, renderThumbnail };
export type PdfView = typeof pdfView;

(window as unknown as { PrintPortalPdfView?: PdfView }).PrintPortalPdfView = pdfView;
