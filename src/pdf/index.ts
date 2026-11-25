/**
 * Entry point of the on-demand pdf-tools.js bundle. It registers itself on window so the
 * main bundle (an IIFE that cannot code-split) can pick it up after injecting the script.
 */

import { PDF_TOOLS_API } from "./api";
import { PdfToolError, countPages, preparePdf } from "./tools";

export const pdfTools = { apiVersion: PDF_TOOLS_API, buildId: __BUILD_ID__, countPages, preparePdf, PdfToolError };
export type PdfTools = typeof pdfTools;

(window as unknown as { PrintPortalPdf?: PdfTools }).PrintPortalPdf = pdfTools;
