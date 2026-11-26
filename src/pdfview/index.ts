/**
 * Entry point of the on-demand pdf-view.js bundle: renders PDF pages to images with pdf.js
 * (used for mailbox thumbnails). Registers itself on window like pdf-tools.js.
 */

import { GlobalWorkerOptions, getDocument, version as pdfjsVersion } from "pdfjs-dist";
import { PDF_VIEW_API } from "./api";

let workerStarted = false;
let wasmUrl: string | undefined;

/**
 * Where pdf.js finds its WebAssembly decoders (must be an absolute URL, ending with "/").
 * Without them pdf.js silently skips CCITT and JBIG2 images, which is how the printer stores
 * black & white scans: thumbnails came out blank. Verified on a real scan (0% -> 6.5% dark).
 */
function setWasmUrl(url: string): void {
  wasmUrl = url;
}

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
  const task = getDocument({ data, wasmUrl });
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

/** A loaded document for the portal's own page viewer (print preview). */
export interface ViewerDocument {
  pageCount: number;
  /** Page size in PDF points, rotation applied. */
  pageSize(pageNumber: number): Promise<{ width: number; height: number }>;
  /**
   * Draw a page into `canvas`, `cssWidth` CSS pixels wide (sharp on high-DPI screens, capped
   * to keep memory sane). A newer call for the same canvas cancels an unfinished older one.
   */
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<void>;
  destroy(): Promise<void>;
}

/** Largest canvas side in device pixels: beyond this, zooming in only costs memory. */
const MAX_CANVAS_PX = 4096;

async function openDocument(data: Uint8Array): Promise<ViewerDocument> {
  const task = getDocument({ data, wasmUrl });
  const doc = await task.promise;
  const running = new WeakMap<HTMLCanvasElement, { cancel(): void }>();
  return {
    pageCount: doc.numPages,
    async pageSize(n) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      return { width: v.width, height: v.height };
    },
    async renderPage(n, canvas, cssWidth) {
      running.get(canvas)?.cancel();
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const scale = Math.min((cssWidth * dpr) / base.width, MAX_CANVAS_PX / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      // Draw off-screen, then copy: the visible canvas never shows a half-drawn or blank page.
      const scratch = document.createElement("canvas");
      scratch.width = Math.ceil(viewport.width);
      scratch.height = Math.ceil(viewport.height);
      const job = page.render({ canvas: scratch, viewport });
      running.set(canvas, job);
      try {
        await job.promise;
      } catch (err) {
        if ((err as Error)?.name === "RenderingCancelledException") return;
        throw err;
      }
      if (running.get(canvas) !== job) return;
      running.delete(canvas);
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.getContext("2d")!.drawImage(scratch, 0, 0);
    },
    destroy: () => task.destroy(),
  };
}

export const pdfView = { apiVersion: PDF_VIEW_API, buildId: __BUILD_ID__, pdfjsVersion, useWorker, setWasmUrl, renderThumbnail, openDocument };
export type PdfView = typeof pdfView;

(window as unknown as { PrintPortalPdfView?: PdfView }).PrintPortalPdfView = pdfView;
