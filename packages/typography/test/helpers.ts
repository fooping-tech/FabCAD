import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { type Curve2, type Vec2, flattenCurve, signedArea } from "@fabcad/geometry";
import { type Typography, createTypography } from "../src/index";

const require = createRequire(import.meta.url);

export const FONT_DIR = fileURLToPath(new URL("../../../apps/fabcad/public/fonts/", import.meta.url));

const toArrayBuffer = (b: Buffer): ArrayBuffer => {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
};

export const readFontFile = (file: string): ArrayBuffer => toArrayBuffer(readFileSync(FONT_DIR + file));

export const readHarfBuzzWasm = (): ArrayBuffer =>
  toArrayBuffer(readFileSync(require.resolve("harfbuzzjs/dist/harfbuzz.wasm")));

export interface TestTypography extends Typography {
  /** Files requested through loadFontFile, in order. */
  requests: string[];
}

export function makeTypography(options: { harfbuzz?: boolean } = {}): TestTypography {
  const requests: string[] = [];
  const typography = createTypography({
    loadFontFile: async (file) => {
      requests.push(file);
      return readFontFile(file);
    },
    ...(options.harfbuzz === false ? {} : { loadHarfBuzzWasm: async () => readHarfBuzzWasm() }),
  });
  return Object.assign(typography, { requests });
}

export function loopPolygon(loop: readonly Curve2[], tolerance = 0.002): Vec2[] {
  const pts: Vec2[] = [];
  for (const c of loop) {
    const seg = flattenCurve(c, tolerance);
    for (let i = 0; i < seg.length - 1; i++) pts.push(seg[i]!);
  }
  return pts;
}

/** Stored end points (curveEnd() of a line interpolates and may differ in the last bit). */
export const startOf = (c: Curve2): Vec2 => (c.type === "line" ? c.a : c.type === "bezier" ? c.p0 : { x: NaN, y: NaN });
export const endOf = (c: Curve2): Vec2 => (c.type === "line" ? c.b : c.type === "bezier" ? c.p3 : { x: NaN, y: NaN });

export const loopArea = (loop: readonly Curve2[]): number => signedArea(loopPolygon(loop));

/** Problems that would make a loop unusable as a CAD profile. */
export function loopProblems(loop: readonly Curve2[]): string[] {
  const problems: string[] = [];
  if (loop.length === 0) return ["empty loop"];
  loop.forEach((c, i) => {
    const next = loop[(i + 1) % loop.length]!;
    const end = endOf(c);
    const start = startOf(next);
    if (end.x !== start.x || end.y !== start.y) problems.push(`gap after curve ${i}`);
    if (c.type === "line") {
      if (c.a.x === c.b.x && c.a.y === c.b.y) problems.push(`zero-length line ${i}`);
    } else if (c.type === "bezier") {
      const pts = [c.p0, c.p1, c.p2, c.p3];
      if (pts.every((p) => p.x === c.p0.x && p.y === c.p0.y)) problems.push(`zero-length bezier ${i}`);
      if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) problems.push(`NaN in ${i}`);
    } else {
      problems.push(`unexpected curve type ${c.type}`);
    }
  });
  return problems;
}
