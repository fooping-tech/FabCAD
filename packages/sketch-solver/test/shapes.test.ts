import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/index";
import {
  angleDeg,
  builder,
  dist,
  distToLine,
  expectRectangle,
  lineLength,
  pt,
  radiusOf,
  sloppyRectangle,
} from "./helpers";
import type { Rect } from "./helpers";

function star(): { sketch: ReturnType<typeof builder>; points: string[]; lines: string[] } {
  const b = builder();
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 50 : 21;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    // Deterministic sloppiness.
    const wobble = ((i * 37) % 7) - 3;
    points.push(b.point(radius * Math.cos(a) + wobble, radius * Math.sin(a) - wobble * 0.7));
  }
  const lines = points.map((p, i) => b.line(p, points[(i + 1) % 10] as string));
  return { sketch: b, points, lines };
}

describe("shapes", () => {
  it("five-pointed star with equal edges", () => {
    const { sketch: b, points, lines } = star();
    for (let i = 1; i < 10; i++) b.constrain("equal", lines[0] as string, lines[i] as string);
    const edge = b.dimension("distance", [lines[0] as string], "40");
    // Tip angles: the two edges meeting at an outer point enclose 36 degrees.
    const values: Record<string, number> = { [edge]: 40 };
    for (const tip of [0, 2, 4, 6]) {
      const incoming = lines[(tip + 9) % 10] as string;
      const outgoing = lines[tip] as string;
      // Directions: incoming runs into the tip, outgoing leaves it.
      const d = b.dimension("angle", [incoming, outgoing], "180 - 36");
      values[d] = 180 - 36;
    }
    b.constrain("fix", points[0] as string);
    const before = b.build();
    const r = solveSketch(before, { dimensionValues: values });
    expect(r.converged).toBe(true);
    expect(r.status).toBe("under-constrained");
    for (const l of lines) expect(lineLength(r.sketch, l)).toBeCloseTo(40, 6);
    for (const tip of [0, 2, 4, 6]) {
      const measured = angleDeg(r.sketch, lines[(tip + 9) % 10] as string, lines[tip] as string);
      expect(measured).toBeCloseTo(144, 5);
    }
    // 20 variables − 9 equal − 1 length − 4 angles − 2 fix
    expect(r.degreesOfFreedom).toBe(4);
    expect(r.redundant).toEqual([]);
    // Still a star close to the sketched one.
    for (const p of points) expect(dist(pt(r.sketch, p), pt(before, p))).toBeLessThan(25);
  });

  it("slot: two lines joined by tangent arcs", () => {
    const b = builder();
    const a1 = b.point(0, 10);
    const a2 = b.point(61, 11);
    const b1 = b.point(1, -9);
    const b2 = b.point(60, -10);
    const top = b.line(a1, a2);
    const bottom = b.line(b2, b1);
    const cRight = b.point(59, 1);
    const cLeft = b.point(1, -1);
    const right = b.arc(cRight, b2, a2);
    const left = b.arc(cLeft, a1, b1);
    b.constrain("horizontal", top);
    b.constrain("tangent", top, right);
    b.constrain("tangent", bottom, right);
    b.constrain("tangent", top, left);
    b.constrain("tangent", bottom, left);
    b.constrain("equal", left, right);
    const centers = b.line(cLeft, cRight, true);
    const len = b.dimension("distance", [centers], "60");
    const rad = b.dimension("radius", [right], "12");
    b.constrain("fix", cLeft);
    const r = solveSketch(b.build(), { dimensionValues: { [len]: 60, [rad]: 12 } });
    expect(r.converged).toBe(true);
    expect(r.status).toBe("fully-constrained");
    expect(r.redundant).toEqual([]);
    expect(radiusOf(r.sketch, right)).toBeCloseTo(12, 6);
    expect(radiusOf(r.sketch, left)).toBeCloseTo(12, 6);
    expect(lineLength(r.sketch, top)).toBeCloseTo(60, 6);
    expect(lineLength(r.sketch, bottom)).toBeCloseTo(60, 6);
    for (const arc of [left, right]) {
      const e = r.sketch.entities[arc];
      if (e?.type !== "arc") throw new Error("arc expected");
      const c = pt(r.sketch, e.center);
      expect(dist(c, pt(r.sketch, e.end))).toBeCloseTo(12, 6);
      expect(distToLine(r.sketch, c, top)).toBeCloseTo(12, 6);
      expect(distToLine(r.sketch, c, bottom)).toBeCloseTo(12, 6);
    }
  });

  it("solves a sketch with more than 50 entities quickly", () => {
    const b = builder();
    const rects: Rect[] = [];
    let values: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      const rect = sloppyRectangle(b, i * 150, (i % 3) * 40);
      rects.push(rect);
      values = { ...values, ...rect.values };
      const previous = rects[i - 1];
      if (previous) {
        const gap = b.dimension("hdistance", [previous.points[1], rect.points[0]], "50");
        values[gap] = 50;
        b.constrain("horizontal", previous.points[1], rect.points[0]);
      }
    }
    b.constrain("fix", (rects[0] as Rect).points[0]);
    const sketch = b.build();
    expect(Object.keys(sketch.entities).length).toBeGreaterThan(50);

    const first = solveSketch(sketch, { dimensionValues: values });
    expect(first.converged).toBe(true);
    expect(first.status).toBe("fully-constrained");
    for (const rect of rects) expectRectangle(first.sketch, rect);

    // Drag performance: what happens on every mouse move.
    const b2 = builder();
    const free: Rect[] = [];
    let freeValues: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      const rect = sloppyRectangle(b2, i * 150, 0);
      free.push(rect);
      freeValues = { ...freeValues, ...rect.values };
      const previous = free[i - 1];
      if (previous) b2.constrain("coincident", previous.points[1], rect.points[0]);
    }
    let current = solveSketch(b2.build(), { dimensionValues: freeValues }).sketch;
    const runs = 50;
    const dragged = (free[5] as Rect).points[2];
    const startY = pt(current, dragged).y;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      const at = pt(current, dragged);
      const r = solveSketch(current, {
        dimensionValues: freeValues,
        drag: [{ pointId: dragged, target: { x: at.x + 3, y: at.y + 2 } }],
      });
      expect(r.converged).toBe(true);
      current = r.sketch;
    }
    const perSolve = (performance.now() - t0) / runs;
    for (const rect of free) expectRectangle(current, rect);
    expect(pt(current, dragged).y).toBeCloseTo(startY + runs * 2, 4);
    console.log(`drag solve of ${Object.keys(current.entities).length} entities: ${perSolve.toFixed(2)} ms`);
    expect(perSolve).toBeLessThan(25);
  });
});
