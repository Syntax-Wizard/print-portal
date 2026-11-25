/**
 * PDF processing with pdf-lib: page selection and several pages per sheet.
 * Loaded on demand as a separate bundle (pdf-tools.js) because pdf-lib is large.
 */

import { PDFDocument, degrees } from "pdf-lib";
import { type PagesPerSheet, type Size, chooseLayout, placePage } from "./layout";

export class PdfToolError extends Error {
  constructor(readonly code: "encrypted" | "unreadable") {
    super(code);
    this.name = "PdfToolError";
  }
}

async function load(data: ArrayBuffer | Uint8Array, forEditing: boolean): Promise<PDFDocument> {
  try {
    // Counting pages works on encrypted files too; editing them would produce broken output.
    return await PDFDocument.load(data, { ignoreEncryption: !forEditing, updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) throw new PdfToolError("encrypted");
    throw new PdfToolError("unreadable");
  }
}

export async function countPages(data: ArrayBuffer | Uint8Array): Promise<number> {
  return (await load(data, false)).getPageCount();
}

export interface PrepareOptions {
  /** 0-based page indices to print, in order; null for all pages. */
  pages: number[] | null;
  pagesPerSheet: PagesPerSheet;
  /** Paper size in points, used for several pages per sheet. */
  paper: Size;
}

export interface PreparedPdf {
  bytes: Uint8Array;
  /**
   * True when the output sheets are landscape (2 portrait pages side by side). The printer
   * rotates them onto the paper, which swaps what "long edge" and "short edge" binding mean
   * for the reader; see duplexForPrinter().
   */
  landscape: boolean;
}

/** Build the PDF that will actually be sent to the printer. */
export async function preparePdf(data: ArrayBuffer | Uint8Array, options: PrepareOptions): Promise<PreparedPdf> {
  const src = await load(data, true);
  const indices = options.pages ?? src.getPageIndices();
  const out = await PDFDocument.create();

  if (options.pagesPerSheet === 1) {
    const copied = await out.copyPages(src, indices);
    for (const page of copied) out.addPage(page);
    return { bytes: await out.save(), landscape: false };
  }

  const srcPages = indices.map((i) => src.getPage(i));
  // Pages with no content stream (intentionally blank pages) cannot be embedded: leave their cell
  // empty. pdf-lib only fails at save() time, so check up front.
  const embedded = await Promise.all(srcPages.map((page) => (page.node.Contents() ? out.embedPage(page) : Promise.resolve(null))));
  const first = srcPages[0]!;
  const firstAngle = first.getRotation().angle;
  const firstShown = firstAngle % 180 === 0 ? first.getSize() : { width: first.getHeight(), height: first.getWidth() };
  const layout = chooseLayout(options.pagesPerSheet, options.paper, firstShown);

  for (let i = 0; i < embedded.length; i += options.pagesPerSheet) {
    const sheet = out.addPage([layout.sheet.width, layout.sheet.height]);
    embedded.slice(i, i + options.pagesPerSheet).forEach((page, k) => {
      if (!page) return;
      const p = placePage(page.width, page.height, srcPages[i + k]!.getRotation().angle, layout.cells[k]!);
      sheet.drawPage(page, { x: p.x, y: p.y, xScale: p.scale, yScale: p.scale, rotate: degrees(p.rotate) });
    });
  }
  return { bytes: await out.save(), landscape: layout.sheet.width > layout.sheet.height };
}
