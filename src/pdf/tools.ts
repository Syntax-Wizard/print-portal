/**
 * PDF processing with pdf-lib: page selection and several pages per sheet.
 * Loaded on demand as a separate bundle (pdf-tools.js) because pdf-lib is large.
 */

import { PDFDocument, degrees } from "pdf-lib";
import { type PagesPerSheet, type Size, chooseLayout, placePage } from "./layout";
import { prunePageResources } from "./prune";

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

/**
 * One page holding the image, scaled to fit the paper with a small margin and centred.
 * The page is landscape for landscape images, so the image is as large as possible.
 */
export async function imageToPdf(image: { bytes: Uint8Array; format: "jpeg" | "png"; width: number; height: number }, paper: Size): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const embedded = image.format === "jpeg" ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
  const long = Math.max(paper.width, paper.height);
  const short = Math.min(paper.width, paper.height);
  const landscape = image.width > image.height;
  const sheet = landscape ? { width: long, height: short } : { width: short, height: long };
  const margin = 18;
  const scale = Math.min((sheet.width - 2 * margin) / image.width, (sheet.height - 2 * margin) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const page = doc.addPage([sheet.width, sheet.height]);
  page.drawImage(embedded, { x: (sheet.width - w) / 2, y: (sheet.height - h) / 2, width: w, height: h });
  return doc.save();
}

/** Concatenate PDFs in order (each part keeps only the resources its pages use). */
export async function mergePdfs(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await load(part, true);
    const indices = src.getPageIndices();
    for (const i of indices) prunePageResources(src.getPage(i));
    for (const page of await out.copyPages(src, indices)) out.addPage(page);
  }
  return out.save();
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
  /** Extra clockwise rotation for every page (e.g. a scan fed upside down). */
  rotate?: 0 | 90 | 180 | 270;
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
  // Only carry over the images and fonts each page uses (see prune.ts): keeps a few pages
  // taken from a large document small, so they upload quickly.
  for (const i of new Set(indices)) prunePageResources(src.getPage(i));
  // Rotate before copying or laying out: both paths honour a page's /Rotate.
  if (options.rotate) {
    for (const i of new Set(indices)) {
      const page = src.getPage(i);
      page.setRotation(degrees((page.getRotation().angle + options.rotate) % 360));
    }
  }

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
