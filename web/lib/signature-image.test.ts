import assert from "node:assert/strict";
import test from "node:test";
import { cleanSignature, SIGNATURE_INK, type Raster } from "./signature-image.ts";

/** White paper with dark pixels wherever ink(x, y) is true. */
function scan(width: number, height: number, ink: (x: number, y: number) => boolean, shade = 60): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = ink(x, y) ? shade : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function alphaAt(r: Raster, x: number, y: number): number {
  return r.data[(y * r.width + x) * 4 + 3];
}

// A 2px-thick horizontal stroke from x 100..499 at y 300..301, on a 600 x 800 page: mostly blank paper,
// like a real scan.
const stroke = (x: number, y: number) => x >= 100 && x < 500 && (y === 300 || y === 301);

test("crops the blank paper away, so the signature spreads across the line", () => {
  const out = cleanSignature(scan(600, 800, stroke))!;
  // The ink is 400 wide and 2 tall; only a small pad is kept around it.
  assert.ok(out.width >= 400 && out.width < 440, `width ${out.width}`);
  assert.ok(out.height < 40, `height ${out.height}`);
});

test("thickens the strokes and prints them in solid ink", () => {
  const out = cleanSignature(scan(600, 800, stroke, 120))!;
  const middle = Math.floor(out.width / 2);
  let solidRows = 0;
  let inkedRows = 0;
  for (let y = 0; y < out.height; y++) {
    if (alphaAt(out, middle, y) === 255) solidRows++;
    if (alphaAt(out, middle, y) > 0) inkedRows++;
  }
  // A mid-grey 2px stroke comes out at least as solid as it went in, and spread wider.
  assert.ok(solidRows >= 2, `the stroke should print solid, got ${solidRows} solid rows`);
  assert.ok(inkedRows > 2, `the stroke should be thickened, got ${inkedRows} inked rows`);
  const i = (Math.floor(out.height / 2) * out.width + middle) * 4;
  assert.deepEqual([...out.data.slice(i, i + 3)], [...SIGNATURE_INK]);
});

test("makes the paper transparent", () => {
  const out = cleanSignature(scan(600, 800, stroke))!;
  assert.equal(alphaAt(out, 0, 0), 0);
  assert.equal(alphaAt(out, out.width - 1, out.height - 1), 0);
});

test("ignores isolated specks, so they neither print nor widen the crop", () => {
  const withSpeck = (x: number, y: number) => stroke(x, y) || (x === 20 && y === 20);
  const out = cleanSignature(scan(600, 800, withSpeck))!;
  assert.ok(out.width < 440, `a one-pixel speck widened the crop to ${out.width}`);
});

test("returns null for a blank page instead of an empty signature", () => {
  assert.equal(cleanSignature(scan(300, 200, () => false)), null);
  assert.equal(cleanSignature({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), null);
});

test("reads transparent pixels as paper, so an already-transparent PNG works", () => {
  const base = scan(600, 800, stroke);
  // Make the paper transparent black: without honouring alpha it would read as solid ink.
  for (let i = 0; i < base.width * base.height; i++) {
    if (base.data[i * 4] === 255) {
      base.data[i * 4] = base.data[i * 4 + 1] = base.data[i * 4 + 2] = 0;
      base.data[i * 4 + 3] = 0;
    }
  }
  const out = cleanSignature(base)!;
  assert.ok(out.width < 440, `transparent paper was read as ink: width ${out.width}`);
});
