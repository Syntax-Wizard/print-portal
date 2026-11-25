/**
 * Glue between the print list and the on-demand PDF tools: decide whether a file needs to be
 * rewritten before printing (page selection, several pages per sheet) and build that file.
 * Files that need no change are sent byte-for-byte as the user chose them.
 */

import { PAPER_POINTS, type Size, duplexForPrinter } from "../pdf/layout";
import { loadPdfTools } from "../pdf/loader";
import { type PageRangeResult, parsePageRange } from "../pdf/pageRange";
import type { PrintOptions } from "../printer/types";

export type PdfIssue = "encrypted" | "unreadable" | "toolsUnavailable" | "toolsOutdated";

export interface PdfInfo {
  file: File;
  /** Number of pages, once known. */
  pageCount: number | null;
  /** What the user typed, e.g. "1-3, 5". Empty means all pages. */
  pageRange: string;
  pdfIssue?: PdfIssue;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** True when the bytes start with the PDF signature "%PDF-". */
export function isPdfBytes(bytes: unknown): bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5) return false;
  return String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

export function issueFromError(err: unknown): PdfIssue {
  const e = err as { name?: string; code?: string };
  if (e?.name === "PdfToolsOutdatedError") return "toolsOutdated";
  if (e?.name === "PdfToolError" && (e.code === "encrypted" || e.code === "unreadable")) return e.code;
  return "toolsUnavailable";
}

/** Validate the page selection; null when there is nothing to check yet. */
export function checkRange(info: PdfInfo): PageRangeResult | null {
  if (!isPdf(info.file) || info.pageCount === null || info.pageRange.trim() === "") return null;
  return parsePageRange(info.pageRange, info.pageCount);
}

/** Pages that will be printed from this file (1 for images). */
export function selectedPageCount(info: PdfInfo): number | null {
  if (!isPdf(info.file)) return 1;
  if (info.pageCount === null) return null;
  const range = checkRange(info);
  if (!range) return info.pageCount;
  return range.ok ? (range.pages?.length ?? info.pageCount) : null;
}

export function needsProcessing(info: PdfInfo, options: PrintOptions): boolean {
  // Protected or unreadable PDFs are printed as they are (the list says so). If only the tools
  // failed to load, keep trying: printing the whole file 1-up would ignore the user's settings.
  if (!isPdf(info.file) || info.pdfIssue === "encrypted" || info.pdfIssue === "unreadable") return false;
  return info.pageRange.trim() !== "" || options.pagesPerSheet > 1;
}

export function paperFor(options: PrintOptions): Size {
  return (options.paperSize !== "default" && PAPER_POINTS[options.paperSize]) || PAPER_POINTS.A4!;
}

/** Count pages in the background so the list can show them. */
export async function countPdfPages(file: File): Promise<number> {
  const tools = await loadPdfTools();
  return tools.countPages(new Uint8Array(await file.arrayBuffer()));
}

export interface PrintFile {
  file: File;
  /** Options to send with it: the binding may be adjusted for landscape output. */
  options: PrintOptions;
}

/** The file to upload (the original, or a rewritten PDF when the options call for it) and its options. */
export async function buildPrintFile(info: PdfInfo, options: PrintOptions): Promise<PrintFile> {
  if (!needsProcessing(info, options)) return { file: info.file, options };
  const range = checkRange(info);
  if (range && !range.ok) throw new Error(`Invalid page range: ${range.error}`);
  const tools = await loadPdfTools();
  const prepared = await tools.preparePdf(new Uint8Array(await info.file.arrayBuffer()), {
    pages: range?.ok ? range.pages : null,
    pagesPerSheet: options.pagesPerSheet,
    paper: paperFor(options),
  });
  // Never send something that is not a PDF (e.g. if the tools bundle misbehaves).
  if (!isPdfBytes(prepared?.bytes)) throw new Error("PDF tools returned something that is not a PDF");
  return {
    file: new File([prepared.bytes as BlobPart], info.file.name, { type: "application/pdf" }),
    options: { ...options, duplex: duplexForPrinter(options.duplex, prepared.landscape) },
  };
}
