import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { parsePageRange } from "../src/pdf/pageRange";
import { PAPER_POINTS, chooseLayout, duplexForPrinter, placePage, sheetsNeeded } from "../src/pdf/layout";
import { PdfToolError, countPages, preparePdf } from "../src/pdf/tools";

async function makePdf(pages: Array<{ w: number; h: number; rotate?: number; blank?: boolean }>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  pages.forEach((p, i) => {
    const page = doc.addPage([p.w, p.h]);
    if (!p.blank) page.drawText(`Page ${i + 1}`, { x: 40, y: p.h - 60, size: 24 });
    if (p.rotate) page.setRotation(degrees(p.rotate));
  });
  return doc.save();
}

const A4 = { w: 595, h: 842 };

describe("parsePageRange", () => {
  it("treats empty input as all pages", () => {
    expect(parsePageRange("  ", 5)).toEqual({ ok: true, pages: null });
  });

  it("parses lists, ranges and open ranges (1-based in, 0-based out)", () => {
    expect(parsePageRange("1-3, 5, 8-", 9)).toEqual({ ok: true, pages: [0, 1, 2, 4, 7, 8] });
    expect(parsePageRange("-2", 9)).toEqual({ ok: true, pages: [0, 1] });
    expect(parsePageRange("3-1", 5)).toEqual({ ok: true, pages: [2, 1, 0] });
  });

  it("accepts full-width digits and Japanese punctuation", () => {
    expect(parsePageRange("１〜３、５", 5)).toEqual({ ok: true, pages: [0, 1, 2, 4] });
  });

  it("rejects nonsense and pages that do not exist", () => {
    expect(parsePageRange("abc", 5)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("0", 5)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("1-2-3", 5)).toEqual({ ok: false, error: "invalid" });
    expect(parsePageRange("6", 5)).toEqual({ ok: false, error: "outOfRange" });
  });
});

describe("layout", () => {
  it("puts portrait pages side by side on a landscape sheet for 2-up", () => {
    const l = chooseLayout(2, PAPER_POINTS.A4!, { width: 595, height: 842 });
    expect(l.sheet).toEqual({ width: 842, height: 595 });
    expect(l.cells).toHaveLength(2);
    expect(l.cells[0]!.x).toBeLessThan(l.cells[1]!.x);
  });

  it("stacks landscape slides on a portrait sheet for 2-up", () => {
    const l = chooseLayout(2, PAPER_POINTS.A4!, { width: 960, height: 540 });
    expect(l.sheet).toEqual({ width: 595, height: 842 });
    expect(l.cells[0]!.y).toBeGreaterThan(l.cells[1]!.y); // first page on top
  });

  it("uses a 2x2 grid in reading order for 4-up", () => {
    const l = chooseLayout(4, PAPER_POINTS.A4!, { width: 595, height: 842 });
    const [a, b, c] = l.cells;
    expect(a!.y).toBe(b!.y);
    expect(a!.x).toBeLessThan(b!.x);
    expect(c!.y).toBeLessThan(a!.y);
  });

  it("centres rotated pages inside their cell", () => {
    const cell = { x: 0, y: 0, width: 100, height: 200 };
    expect(placePage(200, 100, 0, cell)).toEqual({ x: 0, y: 75, scale: 0.5, rotate: 0 });
    // A landscape page shown rotated 90° appears portrait: fills the cell.
    expect(placePage(200, 100, 90, cell)).toEqual({ x: 0, y: 200, scale: 1, rotate: -90 });
    expect(placePage(200, 100, 270, cell)).toEqual({ x: 100, y: 0, scale: 1, rotate: 90 });
  });

  it("swaps the binding for landscape output so pages still turn like a book", () => {
    // Verified on the real printer: 2-up landscape sheets with "long edge" turned like a calendar.
    expect(duplexForPrinter("long-edge", true)).toBe("short-edge");
    expect(duplexForPrinter("short-edge", true)).toBe("long-edge");
    expect(duplexForPrinter("none", true)).toBe("none");
    expect(duplexForPrinter("long-edge", false)).toBe("long-edge");
  });

  it("counts sheets of paper", () => {
    expect(sheetsNeeded(10, 1, false, 1)).toBe(10);
    expect(sheetsNeeded(10, 2, true, 1)).toBe(3);
    expect(sheetsNeeded(9, 4, true, 2)).toBe(4);
  });
});

describe("pdf tools", () => {
  it("counts pages", async () => {
    expect(await countPages(await makePdf([A4, A4, A4]))).toBe(3);
  });

  it("keeps only the selected pages, in order", async () => {
    const src = await makePdf([{ w: 100, h: 100 }, { w: 200, h: 200 }, { w: 300, h: 300 }]);
    const out = await PDFDocument.load((await preparePdf(src, { pages: [2, 0], pagesPerSheet: 1, paper: PAPER_POINTS.A4! })).bytes);
    expect(out.getPages().map((p) => p.getWidth())).toEqual([300, 100]);
  });

  it("reports whether the output sheets are landscape", async () => {
    const portraitDoc = await makePdf([A4, A4]);
    expect((await preparePdf(portraitDoc, { pages: null, pagesPerSheet: 2, paper: PAPER_POINTS.A4! })).landscape).toBe(true);
    expect((await preparePdf(portraitDoc, { pages: null, pagesPerSheet: 4, paper: PAPER_POINTS.A4! })).landscape).toBe(false);
    expect((await preparePdf(portraitDoc, { pages: [0], pagesPerSheet: 1, paper: PAPER_POINTS.A4! })).landscape).toBe(false);
    // Landscape slides 2-up are stacked on a portrait sheet: no swap needed.
    const slides = await makePdf([{ w: 960, h: 540 }, { w: 960, h: 540 }]);
    expect((await preparePdf(slides, { pages: null, pagesPerSheet: 2, paper: PAPER_POINTS.A4! })).landscape).toBe(false);
  });

  it("puts 2 and 4 pages on each A4 sheet", async () => {
    const src = await makePdf(Array.from({ length: 5 }, () => A4));
    const two = await PDFDocument.load((await preparePdf(src, { pages: null, pagesPerSheet: 2, paper: PAPER_POINTS.A4! })).bytes);
    expect(two.getPageCount()).toBe(3);
    expect(two.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
    const four = await PDFDocument.load((await preparePdf(src, { pages: null, pagesPerSheet: 4, paper: PAPER_POINTS.A4! })).bytes);
    expect(four.getPageCount()).toBe(2);
    expect(four.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });

  it("handles rotated source pages", async () => {
    const src = await makePdf([{ w: 842, h: 595, rotate: 90 }, A4]);
    const out = await PDFDocument.load((await preparePdf(src, { pages: null, pagesPerSheet: 2, paper: PAPER_POINTS.A4! })).bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("leaves blank pages empty instead of failing", async () => {
    const src = await makePdf([A4, { ...A4, blank: true }, A4]);
    const out = await PDFDocument.load((await preparePdf(src, { pages: null, pagesPerSheet: 4, paper: PAPER_POINTS.A4! })).bytes);
    expect(out.getPageCount()).toBe(1);
  });

  it("reports unreadable files", async () => {
    await expect(countPages(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(PdfToolError);
  });
});
