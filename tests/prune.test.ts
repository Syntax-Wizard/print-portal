import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { prunePageResources } from "../src/pdf/prune";
import { preparePdf } from "../src/pdf/tools";
import { PAPER_POINTS } from "../src/pdf/layout";

/** A document whose pages all inherit one Resources dict listing every image (as some generators do). */
async function sharedResourceDoc(pages: number, imageBytes = 50_000): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const xobjects = doc.context.obj({});
  for (let i = 0; i < pages; i++) {
    const raw = new Uint8Array(imageBytes).map((_, k) => (k * 31 + i * 17) % 251);
    const ref = doc.context.register(doc.context.stream(raw, { Type: "XObject", Subtype: "Image", Width: 100, Height: imageBytes / 300, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
    xobjects.set(PDFName.of(`Im${i}`), ref);
    const page = doc.addPage([595, 842]);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 300, 100, 300), drawObject(`Im${i}`), popGraphicsState());
    page.node.delete(PDFName.of("Resources"));
  }
  doc.catalog.Pages().set(PDFName.of("Resources"), doc.context.obj({ XObject: xobjects }));
  return doc.save();
}

function xobjectNames(doc: PDFDocument, pageIndex: number): string[] {
  const res = doc.getPage(pageIndex).node.Resources()!;
  const x = doc.context.lookup(res.get(PDFName.of("XObject")));
  return x instanceof PDFDict ? x.keys().map((k) => k.asString()) : [];
}

describe("prunePageResources", () => {
  it("keeps only the images a page draws", async () => {
    const doc = await PDFDocument.load(await sharedResourceDoc(5));
    expect(xobjectNames(doc, 2)).toHaveLength(5);
    expect(prunePageResources(doc.getPage(2))).toBe(true);
    expect(xobjectNames(doc, 2)).toEqual(["/Im2"]);
  });

  it("makes a single page of a large shared-resource document small", async () => {
    const big = await sharedResourceDoc(20);
    const out = await preparePdf(big, { pages: [7], pagesPerSheet: 1, paper: PAPER_POINTS.A4! });
    expect(out.bytes.length).toBeLessThan(big.length / 10);
    const re = await PDFDocument.load(out.bytes);
    expect(xobjectNames(re, 0)).toEqual(["/Im7"]);
  });

  it("keeps fonts used by text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const unused = await doc.embedFont(StandardFonts.Courier);
    const page = doc.addPage();
    page.drawText("Hello", { font, size: 20 });
    // Register the unused font on the page too, as shared dictionaries do.
    page.node.setFontDictionary(PDFName.of("Unused"), unused.ref);
    const loaded = await PDFDocument.load(await doc.save());
    prunePageResources(loaded.getPage(0));
    const fonts = loaded.context.lookup(loaded.getPage(0).node.Resources()!.get(PDFName.of("Font"))) as PDFDict;
    expect(fonts.keys().map((k) => k.asString())).toHaveLength(1);
    expect(fonts.keys()[0]!.asString()).not.toBe("/Unused");
  });

  it("keeps resources used inside a form that borrows the page's resources", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const img = doc.context.register(doc.context.stream(new Uint8Array(30), { Type: "XObject", Subtype: "Image", Width: 1, Height: 10, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
    // A form without its own /Resources that draws /ImInner from the page's resources.
    const form = doc.context.register(doc.context.stream("q /ImInner Do Q", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] }));
    page.node.setXObject(PDFName.of("Fm1"), form);
    page.node.setXObject(PDFName.of("ImInner"), img);
    page.node.setXObject(PDFName.of("ImUnused"), img);
    page.pushOperators(drawObject("Fm1"));
    const loaded = await PDFDocument.load(await doc.save());
    prunePageResources(loaded.getPage(0));
    expect(xobjectNames(loaded, 0).sort()).toEqual(["/Fm1", "/ImInner"]);
  });

  it("leaves a page alone when its content cannot be decoded", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const weird = doc.context.register(doc.context.stream("garbage", { Filter: "NoSuchDecode" }));
    page.node.set(PDFName.of("Contents"), weird as PDFRef);
    page.node.setXObject(PDFName.of("ImA"), doc.context.register(doc.context.stream(new Uint8Array(3), { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8 })));
    const loaded = await PDFDocument.load(await doc.save());
    expect(prunePageResources(loaded.getPage(0))).toBe(false);
    expect(xobjectNames(loaded, 0)).toEqual(["/ImA"]);
  });
});
