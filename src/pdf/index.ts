/**
 * Entry point of the on-demand pdf-tools.js bundle. It registers itself on window so the
 * main bundle (an IIFE that cannot code-split) can pick it up after injecting the script.
 */

import { PdfToolError, countPages, preparePdf } from "./tools";

export const pdfTools = { countPages, preparePdf, PdfToolError };
export type PdfTools = typeof pdfTools;

(window as unknown as { PrintPortalPdf?: PdfTools }).PrintPortalPdf = pdfTools;
