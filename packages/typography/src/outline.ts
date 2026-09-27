import type { Bounds2, Curve2, Vec2 } from "@fabcad/geometry";
import type { PathCommand } from "opentype.js";

/**
 * A closed glyph contour in font units (Y up). `start` is the first point; every segment starts
 * where the previous one ended and the last segment ends exactly at `start`.
 */
export interface FontContour {
  start: readonly [number, number];
  segments: FontSegment[];
}

/** Line: [x, y]. Cubic: [x1, y1, x2, y2, x, y]. */
export type FontSegment = readonly [number, number] | readonly [number, number, number, number, number, number];

/** Points closer than this (font units) are treated as identical: 1e-6 em for a 1000 unit em. */
const SNAP = 1e-3;

const same = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) <= SNAP && Math.abs(ay - by) <= SNAP;

/**
 * Convert opentype.js path commands into closed contours:
 * - TrueType quadratics are raised to cubics exactly,
 * - zero-length segments are dropped,
 * - open contours are closed with a line, nearly closed ones are snapped,
 * - contours without area (fewer than two segments, or only two lines) are dropped.
 * The orientation of the contours is kept.
 */
export function contoursFromCommands(commands: readonly PathCommand[]): FontContour[] {
  const contours: FontContour[] = [];
  let startX = 0;
  let startY = 0;
  let x = 0;
  let y = 0;
  let segments: FontSegment[] | null = null;

  const finish = (): void => {
    if (!segments) return;
    const segs = segments;
    segments = null;
    if (segs.length === 0) return;
    if (x !== startX || y !== startY) {
      if (same(x, y, startX, startY)) {
        // Snap the end of the last segment onto the start point.
        const last = segs[segs.length - 1]!;
        segs[segs.length - 1] =
          last.length === 2 ? [startX, startY] : [last[0], last[1], last[2], last[3], startX, startY];
      } else {
        segs.push([startX, startY]);
      }
    }
    const curved = segs.some((s) => s.length === 6);
    if (segs.length < 2 || (!curved && segs.length < 3)) return;
    contours.push({ start: [startX, startY], segments: segs });
  };

  const lineTo = (nx: number, ny: number): void => {
    if (!segments) begin(x, y);
    if (same(nx, ny, x, y)) return;
    segments!.push([nx, ny]);
    x = nx;
    y = ny;
  };

  const cubicTo = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number): void => {
    if (!segments) begin(x, y);
    if (same(nx, ny, x, y) && same(x1, y1, x, y) && same(x2, y2, x, y)) return;
    segments!.push([x1, y1, x2, y2, nx, ny]);
    x = nx;
    y = ny;
  };

  const begin = (nx: number, ny: number): void => {
    finish();
    segments = [];
    startX = x = nx;
    startY = y = ny;
  };

  for (const c of commands) {
    switch (c.type) {
      case "M":
        begin(c.x ?? 0, c.y ?? 0);
        break;
      case "L":
        lineTo(c.x ?? 0, c.y ?? 0);
        break;
      case "Q": {
        const qx = c.x1 ?? 0;
        const qy = c.y1 ?? 0;
        const nx = c.x ?? 0;
        const ny = c.y ?? 0;
        cubicTo(
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          nx + (2 / 3) * (qx - nx),
          ny + (2 / 3) * (qy - ny),
          nx,
          ny,
        );
        break;
      }
      case "C":
        cubicTo(c.x1 ?? 0, c.y1 ?? 0, c.x2 ?? 0, c.y2 ?? 0, c.x ?? 0, c.y ?? 0);
        break;
      case "Z": {
        const sx = startX;
        const sy = startY;
        finish();
        // A drawing command after Z continues from the start point of the closed contour.
        x = sx;
        y = sy;
        break;
      }
    }
  }
  finish();
  return contours;
}

/** Placement of a glyph: scale (mm per font unit) in X and Y, rotation, translation. */
export interface GlyphTransform {
  scaleX: number;
  scaleY: number;
  cos: number;
  sin: number;
  origin: Vec2;
}

/**
 * Transform contours into closed Curve2 loops. Shared points are computed from identical inputs,
 * so consecutive curves join exactly and each loop ends exactly where it starts.
 */
export function placeContours(contours: readonly FontContour[], t: GlyphTransform): Curve2[][] {
  const at = (fx: number, fy: number): Vec2 => {
    const lx = fx * t.scaleX;
    const ly = fy * t.scaleY;
    return { x: t.origin.x + lx * t.cos - ly * t.sin, y: t.origin.y + lx * t.sin + ly * t.cos };
  };
  const loops: Curve2[][] = [];
  for (const contour of contours) {
    const loop: Curve2[] = [];
    let current = at(contour.start[0], contour.start[1]);
    for (const s of contour.segments) {
      if (s.length === 2) {
        const b = at(s[0], s[1]);
        if (b.x === current.x && b.y === current.y) continue;
        loop.push({ type: "line", a: current, b });
        current = b;
      } else {
        const p3 = at(s[4], s[5]);
        loop.push({ type: "bezier", p0: current, p1: at(s[0], s[1]), p2: at(s[2], s[3]), p3 });
        current = p3;
      }
    }
    if (loop.length > 0) loops.push(loop);
  }
  return loops;
}

/** Extreme values of a cubic Bézier in one coordinate. */
function cubicRange(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let lo = Math.min(p0, p3);
  let hi = Math.max(p0, p3);
  // Derivative: a t² + b t + c (up to a factor of 3).
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-14) {
    if (Math.abs(b) > 1e-14) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  for (const r of roots) {
    if (r <= 0 || r >= 1) continue;
    const m = 1 - r;
    const v = m * m * m * p0 + 3 * m * m * r * p1 + 3 * m * r * r * p2 + r * r * r * p3;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** Exact bounding box of glyph loops (lines and cubic Béziers). Null without loops. */
export function boundsOfLoops(loops: readonly (readonly Curve2[])[]): Bounds2 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (loX: number, hiX: number, loY: number, hiY: number): void => {
    if (loX < minX) minX = loX;
    if (hiX > maxX) maxX = hiX;
    if (loY < minY) minY = loY;
    if (hiY > maxY) maxY = hiY;
  };
  for (const loop of loops) {
    for (const c of loop) {
      if (c.type === "line") {
        add(Math.min(c.a.x, c.b.x), Math.max(c.a.x, c.b.x), Math.min(c.a.y, c.b.y), Math.max(c.a.y, c.b.y));
      } else if (c.type === "bezier") {
        const [loX, hiX] = cubicRange(c.p0.x, c.p1.x, c.p2.x, c.p3.x);
        const [loY, hiY] = cubicRange(c.p0.y, c.p1.y, c.p2.y, c.p3.y);
        add(loX, hiX, loY, hiY);
      }
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
