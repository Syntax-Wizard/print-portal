/**
 * Browser side of image printing: decode any image the browser can read, apply its EXIF
 * orientation, downscale to print resolution and encode it for embedding in a PDF.
 */

import { type ImagePlan, isJpeg, isPhotoType, jpegOrientation, planImage } from "./plan";

export class ImageReadError extends Error {
  constructor() {
    super("This image cannot be read by the browser");
    this.name = "ImageReadError";
  }
}

export interface PreparedImage {
  bytes: Uint8Array;
  format: "jpeg" | "png";
  width: number;
  height: number;
}

/** Decode with EXIF orientation applied (the default in current browsers, made explicit). */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    throw new ImageReadError();
  }
}

/** Check that the browser can read the image, without keeping the decoded pixels. */
export async function canReadImage(file: Blob): Promise<boolean> {
  try {
    (await decode(file)).close();
    return true;
  } catch {
    return false;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageReadError())), type, quality));
}

/** A PNG over this size is almost certainly a photo; re-encode it as JPEG instead. */
const MAX_PNG_BYTES = 8 * 1024 * 1024;

export async function prepareImage(file: File, paperLongSidePt: number): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = isJpeg(file);
  const orientation = jpeg ? jpegOrientation(bytes) : 1;
  const bitmap = await decode(file);
  try {
    // The bitmap is as displayed: createImageBitmap applied the EXIF orientation.
    const plan: ImagePlan = planImage({ jpeg, photo: isPhotoType(file), width: bitmap.width, height: bitmap.height, orientation, paperLongSidePt });
    if (plan.keepOriginal) return { bytes, format: "jpeg", width: bitmap.width, height: bitmap.height };

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // Transparent areas print as white paper.
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

    let format = plan.format;
    let blob = await toBlob(canvas, format === "jpeg" ? "image/jpeg" : "image/png", 0.92);
    if (format === "png" && blob.size > MAX_PNG_BYTES) {
      format = "jpeg";
      blob = await toBlob(canvas, "image/jpeg", 0.92);
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format, width: plan.width, height: plan.height };
  } finally {
    bitmap.close();
  }
}
