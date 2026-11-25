import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { isImageFile, isPhotoType, jpegOrientation, maxPixels, pdfName, planImage } from "../src/images/plan";
import { imageToPdf } from "../src/pdf/tools";
import { PAPER_POINTS } from "../src/pdf/layout";

/** Minimal valid RGB PNG of the given size (white pixels). */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0; // filter byte
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** SOI + APP1 Exif with an Orientation tag + SOS: enough for jpegOrientation(). */
function jpegWithOrientation(value: number, littleEndian = true): Uint8Array {
  const tiff = Buffer.alloc(26);
  if (littleEndian) {
    tiff.write("II", 0);
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); // one entry
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12); // SHORT
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(value, 18);
  } else {
    tiff.write("MM", 0);
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(value, 18);
  }
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app1Body.length + 2);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1Body, Buffer.from([0xff, 0xda, 0x00, 0x02])]));
}

describe("image helpers", () => {
  it("recognises images by type or extension", () => {
    expect(isImageFile({ name: "shot.png", type: "" })).toBe(true);
    expect(isImageFile({ name: "IMG_0001.HEIC", type: "" })).toBe(true);
    expect(isImageFile({ name: "x.bin", type: "image/webp" })).toBe(true);
    expect(isImageFile({ name: "paper.docx", type: "application/msword" })).toBe(false);
    expect(isPhotoType({ name: "a.png", type: "image/png" })).toBe(false);
    expect(isPhotoType({ name: "a.heic", type: "" })).toBe(true);
  });

  it("reads EXIF orientation in both byte orders and defaults to 1", () => {
    expect(jpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(8, false))).toBe(8);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });

  it("keeps upright JPEGs as they are and downscales huge images to about 300 dpi", () => {
    const a4 = 842;
    expect(maxPixels(a4)).toBe(3508);
    expect(planImage({ jpeg: true, photo: true, width: 3000, height: 2000, orientation: 1, paperLongSidePt: a4 })).toEqual({ keepOriginal: true, format: "jpeg", width: 3000, height: 2000 });
    // Rotated by EXIF: must be redrawn upright.
    expect(planImage({ jpeg: true, photo: true, width: 2000, height: 3000, orientation: 6, paperLongSidePt: a4 }).keepOriginal).toBe(false);
    // 48 MP photo: scaled so the long side is 3508 px.
    expect(planImage({ jpeg: true, photo: true, width: 8064, height: 6048, orientation: 1, paperLongSidePt: a4 })).toEqual({ keepOriginal: false, format: "jpeg", width: 3508, height: 2631 });
    // Screenshots stay PNG.
    expect(planImage({ jpeg: false, photo: false, width: 2880, height: 1800, orientation: 1, paperLongSidePt: a4 }).format).toBe("png");
  });

  it("names the converted file .pdf", () => {
    expect(pdfName("IMG_0001.HEIC")).toBe("IMG_0001.pdf");
    expect(pdfName("screenshot.png")).toBe("screenshot.pdf");
  });
});

describe("imageToPdf", () => {
  it("puts a landscape image on a landscape page, fitted inside the margins", async () => {
    const out = await PDFDocument.load(await imageToPdf({ bytes: png(400, 200), format: "png", width: 400, height: 200 }, PAPER_POINTS.A4!));
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  });

  it("puts a portrait image on a portrait page", async () => {
    const out = await PDFDocument.load(await imageToPdf({ bytes: png(200, 400), format: "png", width: 200, height: 400 }, PAPER_POINTS.A4!));
    expect(out.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });
});
