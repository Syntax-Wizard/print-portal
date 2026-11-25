import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../src/printer/options";
import { isPdfBytes, issueFromError, needsProcessing } from "../src/ui/pdfJobs";
import { PdfToolsOutdatedError, loadPdfTools } from "../src/pdf/loader";
import { PDF_TOOLS_API } from "../src/pdf/api";

const pdfFile = new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" });

describe("pdf job guards", () => {
  it("recognises real PDF bytes only", () => {
    expect(isPdfBytes(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("undefined"))).toBe(false);
    expect(isPdfBytes(undefined)).toBe(false);
  });

  it("prints protected PDFs as they are, but never ignores settings because the tools failed", () => {
    const base = { file: pdfFile, pageCount: 4, pageRange: "" };
    const twoUp = { ...DEFAULT_OPTIONS, pagesPerSheet: 2 as const };
    expect(needsProcessing({ ...base, pdfIssue: "encrypted" }, twoUp)).toBe(false);
    expect(needsProcessing({ ...base, pdfIssue: "toolsOutdated" }, twoUp)).toBe(true);
    expect(needsProcessing(base, DEFAULT_OPTIONS)).toBe(false);
    expect(needsProcessing({ ...base, pageRange: "4" }, DEFAULT_OPTIONS)).toBe(true);
  });

  it("names an outdated tools bundle", () => {
    expect(issueFromError(new PdfToolsOutdatedError())).toBe("toolsOutdated");
    expect(issueFromError(new Error("network"))).toBe("toolsUnavailable");
  });
});

describe("loadPdfTools", () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => delete g.window);

  it("refuses a pdf-tools bundle from another release", async () => {
    g.window = { PrintPortalPdf: { apiVersion: PDF_TOOLS_API - 1 } };
    await expect(loadPdfTools()).rejects.toBeInstanceOf(PdfToolsOutdatedError);
  });

  it("accepts the matching bundle", async () => {
    const tools = { apiVersion: PDF_TOOLS_API };
    g.window = { PrintPortalPdf: tools };
    await expect(loadPdfTools()).resolves.toBe(tools);
  });
});
