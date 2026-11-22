import { cleanSignature } from "./signature-image";

/**
 * Longest side, in pixels, the signature is processed at. A phone photo can be
 * 4000px across; the certificate prints the signature at most 142pt wide, so
 * anything past this only slows the clean-up down.
 */
const MAX_SIDE = 1600;

/**
 * Decodes an uploaded signature in the browser, cleans it (see
 * signature-image.ts) and returns it as a transparent PNG, or null when the
 * image holds no visible ink.
 *
 * createImageBitmap applies the photo's EXIF orientation, so a phone picture
 * taken sideways comes out the right way up.
 */
export async function cleanSignatureFile(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext("2d");
    if (sourceContext === null) throw new Error("This browser cannot process images.");
    sourceContext.drawImage(bitmap, 0, 0, width, height);

    const cleaned = cleanSignature(sourceContext.getImageData(0, 0, width, height));
    if (cleaned === null) return null;

    const target = document.createElement("canvas");
    target.width = cleaned.width;
    target.height = cleaned.height;
    const targetContext = target.getContext("2d");
    if (targetContext === null) throw new Error("This browser cannot process images.");
    targetContext.putImageData(new ImageData(new Uint8ClampedArray(cleaned.data), cleaned.width, cleaned.height), 0, 0);

    return await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/png"));
  } finally {
    bitmap.close();
  }
}
