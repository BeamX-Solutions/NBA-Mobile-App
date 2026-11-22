/**
 * Cleans a chairman's signature for printing on the Certificate of Compliance.
 *
 * A scan or photo of a signature is mostly blank paper. The certificate fits
 * the whole image into the signature space, so blank paper above and below the
 * ink shrinks the signature to a fraction of the line, and thin pen strokes
 * shrink with it. Anaocha's first upload printed about 60pt wide on a 142pt
 * line. Branches should not have to crop and retouch a scan to avoid that, so
 * every upload goes through this first:
 *
 *   1. Specks and faint stray marks are removed (two 3x3 median passes).
 *   2. The image is cropped to the ink, so it spreads across the line.
 *   3. Strokes are thickened (a box blur spreads them; re-thresholding makes
 *      the spread solid) and darkened to one near-black ink.
 *   4. The paper becomes transparent, so it sits on the cream certificate
 *      without a white box.
 *
 * Pure: pixels in, pixels out, so it runs in the browser on a canvas and in
 * Node under test without either knowing about the other.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8ClampedArray;
}

/** The ink every signature is printed in: near-black navy. */
export const SIGNATURE_INK = [0x14, 0x20, 0x30] as const;

/** Darkness (0 paper .. 255 black) above which a pixel counts as ink when cropping. */
const INK_THRESHOLD = 40;
/** After thickening, darkness at or below this is paper, at or above SOLID is full ink. */
const CLEAR = 10;
const SOLID = 55;

function median3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const window = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          window[n++] = src[yy * w + xx];
        }
      }
      window.sort();
      out[y * w + x] = window[4];
    }
  }
  return out;
}

/** One box-blur pass of the given radius, horizontally then vertically. Edges read as paper. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) sum += src[y * w + x];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      const add = x + r + 1;
      const drop = x - r;
      if (add < w) sum += src[y * w + add];
      if (drop >= 0) sum -= src[y * w + drop];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      const add = y + r + 1;
      const drop = y - r;
      if (add < h) sum += tmp[add * w + x];
      if (drop >= 0) sum -= tmp[drop * w + x];
    }
  }
  return out;
}

/**
 * Returns the cleaned signature, or null when the image holds no ink at all
 * (a blank page, or a photo too faint to read), so the caller can say so
 * rather than print an empty box.
 */
export function cleanSignature(src: Raster): Raster | null {
  const { width: w, height: h, data } = src;
  if (w < 1 || h < 1 || data.length < w * h * 4) return null;

  // Darkness of each pixel as printed on white paper, transparency included.
  let dark: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    dark[i] = Math.round(255 - (a * lum + (1 - a) * 255));
  }
  dark = median3(median3(dark, w, h), w, h);

  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dark[y * w + x] > INK_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;

  const inkW = x1 - x0 + 1;
  const inkH = y1 - y0 + 1;
  // Scaled to the signature's size, so a small scan and a large photo come out alike.
  const radius = Math.max(1, Math.round(inkW / 650));
  const pad = 2 * radius + Math.max(4, Math.round(inkW * 0.012));
  const outW = inkW + 2 * pad;
  const outH = inkH + 2 * pad;

  let field: Float32Array = new Float32Array(outW * outH);
  for (let y = 0; y < inkH; y++) {
    for (let x = 0; x < inkW; x++) {
      field[(y + pad) * outW + (x + pad)] = dark[(y + y0) * w + (x + x0)];
    }
  }
  field = boxBlur(boxBlur(field, outW, outH, radius), outW, outH, radius);

  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < outW * outH; i++) {
    const v = field[i];
    out[i * 4] = SIGNATURE_INK[0];
    out[i * 4 + 1] = SIGNATURE_INK[1];
    out[i * 4 + 2] = SIGNATURE_INK[2];
    out[i * 4 + 3] = v <= CLEAR ? 0 : v >= SOLID ? 255 : Math.round(((v - CLEAR) / (SOLID - CLEAR)) * 255);
  }
  return { width: outW, height: outH, data: out };
}
