import type { Vec2 } from "@fabcad/geometry";
import { SketchBuilder, getPoint } from "@fabcad/sketch/src/edit";
import { type Sketch, createSketch } from "@fabcad/sketch/src/model";
import { expect } from "vitest";

export const emptySketch = (): Sketch =>
  createSketch("sketch1", "Sketch 1", { type: "origin", plane: "XY" });

export const builder = (): SketchBuilder => new SketchBuilder(emptySketch());

export const pt = (sketch: Sketch, id: string): Vec2 => getPoint(sketch, id);

export function lineEnds(sketch: Sketch, id: string): [Vec2, Vec2] {
  const e = sketch.entities[id];
  if (e?.type !== "line") throw new Error(`not a line: ${id}`);
  return [getPoint(sketch, e.p1), getPoint(sketch, e.p2)];
}

export function lineLength(sketch: Sketch, id: string): number {
  const [a, b] = lineEnds(sketch, id);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lineDir(sketch: Sketch, id: string): Vec2 {
  const [a, b] = lineEnds(sketch, id);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Counter-clockwise angle from line `a` to line `b` in degrees, in [0, 360). */
export function angleDeg(sketch: Sketch, a: string, b: string): number {
  const u = lineDir(sketch, a);
  const v = lineDir(sketch, b);
  const deg = (Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function distToLine(sketch: Sketch, p: Vec2, line: string): number {
  const [a, b] = lineEnds(sketch, line);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.hypot(dx, dy);
}

export function radiusOf(sketch: Sketch, id: string): number {
  const e = sketch.entities[id];
  if (e?.type === "circle") return e.radius;
  if (e?.type === "arc") {
    const c = getPoint(sketch, e.center);
    const s = getPoint(sketch, e.start);
    return Math.hypot(s.x - c.x, s.y - c.y);
  }
  throw new Error(`not round: ${id}`);
}

export function centerOf(sketch: Sketch, id: string): Vec2 {
  const e = sketch.entities[id];
  if (e?.type === "circle" || e?.type === "arc") return getPoint(sketch, e.center);
  throw new Error(`not round: ${id}`);
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface Rect {
  sketch: Sketch;
  points: [string, string, string, string];
  /** bottom, right, top, left */
  lines: [string, string, string, string];
  dims: { width: string; height: string };
  values: Record<string, number>;
}

/** Sloppy rectangle with H/V constraints and 100 × 80 dimensions. */
export function sloppyRectangle(b: SketchBuilder = builder(), ox = 0, oy = 0): Rect {
  const p1 = b.point(ox + 1, oy - 2);
  const p2 = b.point(ox + 93, oy + 4);
  const p3 = b.point(ox + 97, oy + 71);
  const p4 = b.point(ox - 3, oy + 75);
  const bottom = b.line(p1, p2);
  const right = b.line(p2, p3);
  const top = b.line(p3, p4);
  const left = b.line(p4, p1);
  b.constrain("horizontal", bottom);
  b.constrain("vertical", right);
  b.constrain("horizontal", top);
  b.constrain("vertical", left);
  const width = b.dimension("hdistance", [p1, p2], "100");
  const height = b.dimension("vdistance", [right], "80");
  return {
    sketch: b.current,
    points: [p1, p2, p3, p4],
    lines: [bottom, right, top, left],
    dims: { width, height },
    values: { [width]: 100, [height]: 80 },
  };
}

export function expectRectangle(sketch: Sketch, r: Rect, w = 100, h = 80, digits = 6): void {
  const [a, b, c, d] = r.points.map((id) => pt(sketch, id)) as [Vec2, Vec2, Vec2, Vec2];
  expect(b.x - a.x).toBeCloseTo(w, digits);
  expect(c.x - d.x).toBeCloseTo(w, digits);
  expect(c.y - b.y).toBeCloseTo(h, digits);
  expect(d.y - a.y).toBeCloseTo(h, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(c.y).toBeCloseTo(d.y, digits);
  expect(b.x).toBeCloseTo(c.x, digits);
  expect(a.x).toBeCloseTo(d.x, digits);
}
