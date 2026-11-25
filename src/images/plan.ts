/**
 * Decisions for turning an image into a printable PDF page. Pure functions (no DOM) so they
 * can be unit tested; the browser work happens in convert.ts.
 */

/** Image types worth recognising by name when the browser reports no MIME type. */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tiff?)$/i;

export function isImageFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

export function isJpeg(file: { name: string; type: string }): boolean {
  return file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
}

/** Photos compress far better as JPEG; screenshots and graphics stay sharp as PNG. */
export function isPhotoType(file: { name: string; type: string }): boolean {
  return /^image\/(jpeg|webp|avif|heic|heif)$/.test(file.type) || /\.(jpe?g|webp|avif|heic|heif)$/i.test(file.name);
}

/**
 * EXIF orientation (1-8) of a JPEG, or 1 when absent. Phones store photos sideways and set
 * this tag; embedding the raw JPEG in a PDF ignores it and prints the photo rotated.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if ((marker & 0xff00) !== 0xff00 || length < 2) return 1;
    // APP1 "Exif\0\0"
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker === 0xffda) return 1; // Start of scan: no more metadata.
    offset += 2 + length;
  }
  return 1;
}

export interface ImagePlan {
  /** Embed the original JPEG bytes as they are (no quality loss). */
  keepOriginal: boolean;
  /** Format to encode to when not keeping the original. */
  format: "jpeg" | "png";
  /** Pixel size after orientation and downscaling. */
  width: number;
  height: number;
}

/** About 300 dpi on the paper's long side: plenty for print, much smaller uploads. */
export function maxPixels(paperLongSidePt: number): number {
  return Math.round((paperLongSidePt / 72) * 300);
}

/**
 * Decide how to convert an image whose decoded (displayed) size is `width` x `height`.
 * Sizes come from the browser's decoder, which already applied the EXIF orientation; if an old
 * browser did not, the photo prints unrotated but never stretched.
 */
export function planImage(input: { jpeg: boolean; photo: boolean; width: number; height: number; orientation: number; paperLongSidePt: number }): ImagePlan {
  const limit = maxPixels(input.paperLongSidePt);
  const scale = Math.min(1, limit / Math.max(input.width, input.height));
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));
  const keepOriginal = input.jpeg && input.orientation === 1 && scale === 1;
  return { keepOriginal, format: input.photo ? "jpeg" : "png", width, height };
}

/** A file name for the converted PDF ("photo.HEIC" -> "photo.pdf"). */
export function pdfName(name: string): string {
  return `${name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image"}.pdf`;
}
