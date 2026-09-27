import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/index";
import {
  angleDeg,
  builder,
  centerOf,
  dist,
  distToLine,
  lineDir,
  lineEnds,
  lineLength,
  pt,
  radiusOf,
} from "./helpers";

describe("dimensions", () => {
  it("distance: line length", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 30, y: 40 });
    const d = b.dimension("distance", [l], "80");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 80 } });
    expect(r.converged).toBe(true);
    expect(lineLength(r.sketch, l)).toBeCloseTo(80, 6);
    // Direction is kept.
    expect(lineDir(r.sketch, l).x).toBeCloseTo(0.6, 6);
    expect(r.degreesOfFreedom).toBe(3);
  });

  it("distance: point-point", () => {
    const b = builder();
    const p = b.point(0, 0);
    const q = b.point(10, 0);
    const d = b.dimension("distance", [p, q], "25");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 25 } });
    expect(r.converged).toBe(true);
    expect(dist(pt(r.sketch, p), pt(r.sketch, q))).toBeCloseTo(25, 6);
  });

  it("distance: zero point-point distance makes the points coincide", () => {
    const b = builder();
    const p = b.point(0, 0);
    const q = b.point(10, 3);
    const d = b.dimension("distance", [p, q], "0");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 0 } });
    expect(r.converged).toBe(true);
    expect(dist(pt(r.sketch, p), pt(r.sketch, q))).toBeLessThan(1e-7);
  });

  it("distance: point-line keeps the point on its side", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    b.constrain("fix", l);
    const above = b.point(30, 12);
    const below = b.point(60, -7);
    const d1 = b.dimension("distance", [above, l], "40");
    const d2 = b.dimension("distance", [below, l], "40");
    const r = solveSketch(b.build(), { dimensionValues: { [d1]: 40, [d2]: 40 } });
    expect(r.converged).toBe(true);
    expect(pt(r.sketch, above).y).toBeCloseTo(40, 6);
    expect(pt(r.sketch, below).y).toBeCloseTo(-40, 6);
    expect(pt(r.sketch, above).x).toBeCloseTo(30, 6);
  });

  it("distance: offset between parallel lines", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 5 });
    const l2 = b.line({ x: 0, y: 30 }, { x: 100, y: 28 });
    b.constrain("parallel", l1, l2);
    const d = b.dimension("distance", [l1, l2], "50");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 50 } });
    expect(r.converged).toBe(true);
    const [p, q] = lineEnds(r.sketch, l2);
    expect(distToLine(r.sketch, p, l1)).toBeCloseTo(50, 6);
    expect(distToLine(r.sketch, q, l1)).toBeCloseTo(50, 6);
    expect(p.y).toBeGreaterThan(0);
  });

  it("hdistance and vdistance keep the orientation of the geometry", () => {
    const b = builder();
    const p = b.point(0, 0);
    const q = b.point(-20, -15);
    const h = b.dimension("hdistance", [p, q], "100");
    const v = b.dimension("vdistance", [p, q], "60");
    const r = solveSketch(b.build(), { dimensionValues: { [h]: 100, [v]: 60 } });
    expect(r.converged).toBe(true);
    expect(pt(r.sketch, q).x - pt(r.sketch, p).x).toBeCloseTo(-100, 6);
    expect(pt(r.sketch, q).y - pt(r.sketch, p).y).toBeCloseTo(-60, 6);
    expect(r.degreesOfFreedom).toBe(2);
  });

  it("hdistance and vdistance on a line", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 30, y: 40 });
    const h = b.dimension("hdistance", [l], "50");
    const v = b.dimension("vdistance", [l], "10");
    const r = solveSketch(b.build(), { dimensionValues: { [h]: 50, [v]: 10 } });
    expect(r.converged).toBe(true);
    const [a, e] = lineEnds(r.sketch, l);
    expect(e.x - a.x).toBeCloseTo(50, 6);
    expect(e.y - a.y).toBeCloseTo(10, 6);
  });

  for (const value of [0, 30, 90, 135, 180, 270, 330]) {
    it(`angle of ${value} degrees`, () => {
      const b = builder();
      const o = b.point(0, 0);
      const l1 = b.line(o, { x: 100, y: 0 });
      const l2 = b.line(o, { x: 60, y: 25 });
      b.constrain("fix", l1);
      const d = b.dimension("angle", [l1, l2], String(value));
      const r = solveSketch(b.build(), { dimensionValues: { [d]: value } });
      expect(r.converged).toBe(true);
      const measured = angleDeg(r.sketch, l1, l2);
      expect(Math.min(Math.abs(measured - value), 360 - Math.abs(measured - value))).toBeLessThan(
        1e-6,
      );
      // Rotating stretches the line a little, but it must stay recognisable.
      expect(lineLength(r.sketch, l2)).toBeGreaterThan(60);
      expect(lineLength(r.sketch, l2)).toBeLessThan(90);
      expect(r.degreesOfFreedom).toBe(1);
    });
  }

  it("angle between free lines that do not touch", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const l2 = b.line({ x: 20, y: 40 }, { x: 10, y: 120 });
    const d = b.dimension("angle", [l1, l2], "45");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 45 } });
    expect(r.converged).toBe(true);
    expect(angleDeg(r.sketch, l1, l2)).toBeCloseTo(45, 6);
    expect(r.degreesOfFreedom).toBe(7);
  });

  it("radius and diameter of circles", () => {
    const b = builder();
    const c1 = b.circle({ x: 0, y: 0 }, 20);
    const c2 = b.circle({ x: 100, y: 0 }, 20);
    const d1 = b.dimension("radius", [c1], "35");
    const d2 = b.dimension("diameter", [c2], "35");
    const r = solveSketch(b.build(), { dimensionValues: { [d1]: 35, [d2]: 35 } });
    expect(r.converged).toBe(true);
    expect(radiusOf(r.sketch, c1)).toBeCloseTo(35, 7);
    expect(radiusOf(r.sketch, c2)).toBeCloseTo(17.5, 7);
    expect(centerOf(r.sketch, c2)).toEqual({ x: 100, y: 0 });
    expect(r.degreesOfFreedom).toBe(4);
  });

  it("radius of an arc keeps start and end on the same circle", () => {
    const b = builder();
    const a = b.arc({ x: 0, y: 0 }, { x: 20, y: 1 }, { x: -2, y: 26 });
    const d = b.dimension("radius", [a], "40");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 40 } });
    expect(r.converged).toBe(true);
    const e = r.sketch.entities[a];
    if (e?.type !== "arc") throw new Error("arc expected");
    const c = pt(r.sketch, e.center);
    expect(dist(c, pt(r.sketch, e.start))).toBeCloseTo(40, 6);
    expect(dist(c, pt(r.sketch, e.end))).toBeCloseTo(40, 6);
    // 6 variables − radius rule − dimension
    expect(r.degreesOfFreedom).toBe(4);
  });

  it("an arc without dimensions still gets a single radius", () => {
    const b = builder();
    const a = b.arc({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 30 });
    const d = b.dimension("diameter", [a], "60");
    const free = solveSketch(b.build());
    expect(free.converged).toBe(true);
    expect(dist(centerOf(free.sketch, a), pt(free.sketch, "p3"))).toBeCloseTo(
      radiusOf(free.sketch, a),
      6,
    );
    expect(free.degreesOfFreedom).toBe(5);
    const sized = solveSketch(b.build(), { dimensionValues: { [d]: 60 } });
    expect(radiusOf(sized.sketch, a)).toBeCloseTo(30, 6);
  });
});
