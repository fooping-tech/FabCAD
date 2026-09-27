import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/index";
import {
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

describe("constraints", () => {
  it("coincident point-point", () => {
    const b = builder();
    const p = b.point(1, 2);
    const q = b.point(4, 7);
    b.constrain("coincident", p, q);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(dist(pt(r.sketch, p), pt(r.sketch, q))).toBeLessThan(1e-7);
    expect(r.degreesOfFreedom).toBe(2);
    // Minimum norm: they meet in the middle.
    expect(pt(r.sketch, p).x).toBeCloseTo(2.5, 5);
    expect(pt(r.sketch, p).y).toBeCloseTo(4.5, 5);
  });

  it("coincident point-on-line", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 20 });
    const p = b.point(40, 30);
    b.constrain("coincident", p, l);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(distToLine(r.sketch, pt(r.sketch, p), l)).toBeLessThan(1e-7);
    expect(r.degreesOfFreedom).toBe(5);
  });

  it("coincident point-on-circle and point-on-arc", () => {
    const b = builder();
    const c = b.circle({ x: 10, y: 10 }, 25);
    const p = b.point(50, 20);
    b.constrain("coincident", p, c);
    const a = b.arc({ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 100, y: 21 });
    const q = b.point(110, 25);
    b.constrain("coincident", q, a);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(dist(pt(r.sketch, p), centerOf(r.sketch, c))).toBeCloseTo(radiusOf(r.sketch, c), 6);
    expect(dist(pt(r.sketch, q), centerOf(r.sketch, a))).toBeCloseTo(radiusOf(r.sketch, a), 6);
  });

  it("horizontal and vertical, for lines and point pairs", () => {
    const b = builder();
    const h = b.line({ x: 0, y: 0 }, { x: 50, y: 6 });
    const v = b.line({ x: 0, y: 10 }, { x: 4, y: 60 });
    const p = b.point(100, 100);
    const q = b.point(130, 104);
    const s = b.point(103, 150);
    b.constrain("horizontal", h);
    b.constrain("vertical", v);
    b.constrain("horizontal", p, q);
    b.constrain("vertical", p, s);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(lineDir(r.sketch, h).y).toBeCloseTo(0, 7);
    expect(lineDir(r.sketch, v).x).toBeCloseTo(0, 7);
    expect(pt(r.sketch, p).y).toBeCloseTo(pt(r.sketch, q).y, 7);
    expect(pt(r.sketch, p).x).toBeCloseTo(pt(r.sketch, s).x, 7);
  });

  it("parallel", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const l2 = b.line({ x: 0, y: 40 }, { x: 90, y: 20 });
    b.constrain("parallel", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const u = lineDir(r.sketch, l1);
    const v = lineDir(r.sketch, l2);
    expect(u.x * v.y - u.y * v.x).toBeCloseTo(0, 7);
    expect(r.degreesOfFreedom).toBe(7);
  });

  it("parallel keeps anti-parallel lines anti-parallel", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const l2 = b.line({ x: 90, y: 20 }, { x: 0, y: 40 });
    b.constrain("parallel", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const u = lineDir(r.sketch, l1);
    const v = lineDir(r.sketch, l2);
    expect(u.x * v.y - u.y * v.x).toBeCloseTo(0, 7);
    expect(u.x * v.x + u.y * v.y).toBeCloseTo(-1, 7);
  });

  it("parallel converges even when the lines start perpendicular", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const l2 = b.line({ x: 0, y: 10 }, { x: 0, y: 80 });
    b.constrain("parallel", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const u = lineDir(r.sketch, l1);
    const v = lineDir(r.sketch, l2);
    expect(u.x * v.y - u.y * v.x).toBeCloseTo(0, 7);
  });

  it("perpendicular", () => {
    const b = builder();
    const o = b.point(0, 0);
    const l1 = b.line(o, { x: 100, y: 10 });
    const l2 = b.line(o, { x: 30, y: 70 });
    b.constrain("perpendicular", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const u = lineDir(r.sketch, l1);
    const v = lineDir(r.sketch, l2);
    expect(u.x * v.x + u.y * v.y).toBeCloseTo(0, 7);
    expect(lineLength(r.sketch, l1)).toBeGreaterThan(50);
  });

  it("tangent line-circle", () => {
    const b = builder();
    const l = b.line({ x: -50, y: 0 }, { x: 50, y: 3 });
    const c = b.circle({ x: 5, y: 27 }, 20);
    b.constrain("tangent", l, c);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(distToLine(r.sketch, centerOf(r.sketch, c), l)).toBeCloseTo(radiusOf(r.sketch, c), 6);
    // The circle stays above the line.
    expect(centerOf(r.sketch, c).y).toBeGreaterThan(10);
    expect(r.degreesOfFreedom).toBe(6);
  });

  it("tangent accepts the refs in either order", () => {
    const b = builder();
    const l = b.line({ x: -50, y: 0 }, { x: 50, y: 3 });
    const c = b.circle({ x: 5, y: -27 }, 20);
    b.constrain("tangent", c, l);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(distToLine(r.sketch, centerOf(r.sketch, c), l)).toBeCloseTo(radiusOf(r.sketch, c), 6);
    expect(centerOf(r.sketch, c).y).toBeLessThan(-10);
  });

  it("tangent arc-line sharing an end point (fillet)", () => {
    const b = builder();
    const start = b.point(50, 1);
    const l = b.line({ x: 0, y: 0 }, start);
    const a = b.arc({ x: 48, y: 22 }, start, { x: 70, y: 20 });
    b.constrain("tangent", a, l);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const c = centerOf(r.sketch, a);
    const s = pt(r.sketch, start);
    const d = lineDir(r.sketch, l);
    expect(((s.x - c.x) * d.x + (s.y - c.y) * d.y) / radiusOf(r.sketch, a)).toBeCloseTo(0, 7);
    expect(distToLine(r.sketch, c, l)).toBeCloseTo(radiusOf(r.sketch, a), 6);
    // line (4) + arc points (4 more) − arc radius rule − tangency
    expect(r.degreesOfFreedom).toBe(6);
  });

  it("tangent arc-line without a shared point", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const a = b.arc({ x: 50, y: 30 }, { x: 70, y: 20 }, { x: 30, y: 21 });
    b.constrain("tangent", l, a);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(distToLine(r.sketch, centerOf(r.sketch, a), l)).toBeCloseTo(radiusOf(r.sketch, a), 6);
  });

  it("tangent circle-circle picks outer or inner tangency from the geometry", () => {
    const b = builder();
    const c1 = b.circle({ x: 0, y: 0 }, 20);
    const c2 = b.circle({ x: 33, y: 2 }, 10);
    b.constrain("tangent", c1, c2);
    const c3 = b.circle({ x: 200, y: 0 }, 30);
    const c4 = b.circle({ x: 212, y: 3 }, 12);
    b.constrain("tangent", c3, c4);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(dist(centerOf(r.sketch, c1), centerOf(r.sketch, c2))).toBeCloseTo(
      radiusOf(r.sketch, c1) + radiusOf(r.sketch, c2),
      6,
    );
    expect(dist(centerOf(r.sketch, c3), centerOf(r.sketch, c4))).toBeCloseTo(
      radiusOf(r.sketch, c3) - radiusOf(r.sketch, c4),
      6,
    );
  });

  it("tangent arc-arc sharing an end point", () => {
    const b = builder();
    const joint = b.point(40, 0);
    const a1 = b.arc({ x: 0, y: 2 }, { x: 0, y: -40 }, joint);
    const a2 = b.arc({ x: 61, y: -3 }, joint, { x: 60, y: -20 });
    b.constrain("tangent", a1, a2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(dist(centerOf(r.sketch, a1), centerOf(r.sketch, a2))).toBeCloseTo(
      radiusOf(r.sketch, a1) + radiusOf(r.sketch, a2),
      6,
    );
    // 10 variables − 2 arc radius rules − tangency
    expect(r.degreesOfFreedom).toBe(7);
  });

  it("equal line lengths", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const l2 = b.line({ x: 0, y: 20 }, { x: 40, y: 50 });
    b.constrain("equal", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(lineLength(r.sketch, l1)).toBeCloseTo(lineLength(r.sketch, l2), 6);
  });

  it("equal radii of circles and arcs", () => {
    const b = builder();
    const c1 = b.circle({ x: 0, y: 0 }, 20);
    const c2 = b.circle({ x: 100, y: 0 }, 30);
    const a = b.arc({ x: 200, y: 0 }, { x: 240, y: 0 }, { x: 200, y: 41 });
    b.constrain("equal", c1, c2);
    b.constrain("equal", c2, a);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(radiusOf(r.sketch, c1)).toBeCloseTo(radiusOf(r.sketch, c2), 6);
    expect(radiusOf(r.sketch, a)).toBeCloseTo(radiusOf(r.sketch, c2), 6);
  });

  it("concentric", () => {
    const b = builder();
    const c = b.circle({ x: 0, y: 0 }, 20);
    const a = b.arc({ x: 5, y: 4 }, { x: 45, y: 4 }, { x: 5, y: 45 });
    b.constrain("concentric", c, a);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(dist(centerOf(r.sketch, c), centerOf(r.sketch, a))).toBeLessThan(1e-7);
  });

  it("collinear", () => {
    const b = builder();
    const l1 = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const l2 = b.line({ x: 130, y: 20 }, { x: 200, y: 10 });
    b.constrain("collinear", l1, l2);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const [p, q] = lineEnds(r.sketch, l2);
    expect(distToLine(r.sketch, p, l1)).toBeLessThan(1e-7);
    expect(distToLine(r.sketch, q, l1)).toBeLessThan(1e-7);
    expect(r.degreesOfFreedom).toBe(6);
  });

  it("midpoint", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const p = b.point(40, 20);
    b.constrain("midpoint", p, l);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const [a, e] = lineEnds(r.sketch, l);
    expect(pt(r.sketch, p).x).toBeCloseTo((a.x + e.x) / 2, 7);
    expect(pt(r.sketch, p).y).toBeCloseTo((a.y + e.y) / 2, 7);
  });

  it("fix holds points, lines and circles", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    const c = b.circle({ x: 50, y: 15 }, 20);
    const p = b.point(70, 5);
    b.constrain("fix", l);
    b.constrain("fix", c);
    b.constrain("coincident", p, l);
    b.constrain("coincident", p, c);
    const before = b.build();
    const r = solveSketch(before);
    expect(r.converged).toBe(true);
    expect(r.status).toBe("fully-constrained");
    expect(lineEnds(r.sketch, l)).toEqual(lineEnds(before, l));
    expect(r.sketch.entities[c]).toEqual(before.entities[c]);
    expect(centerOf(r.sketch, c)).toEqual({ x: 50, y: 15 });
    expect(distToLine(r.sketch, pt(r.sketch, p), l)).toBeLessThan(1e-7);
    expect(dist(pt(r.sketch, p), { x: 50, y: 15 })).toBeCloseTo(20, 6);
    expect(pt(r.sketch, p).x).toBeGreaterThan(50);
  });

  it("symmetry of points", () => {
    const b = builder();
    const axis = b.line({ x: 0, y: -50 }, { x: 0, y: 50 }, true);
    b.constrain("fix", axis);
    const p = b.point(-30, 10);
    const q = b.point(34, 14);
    b.constrain("symmetry", p, q, axis);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(pt(r.sketch, p).x).toBeCloseTo(-pt(r.sketch, q).x, 7);
    expect(pt(r.sketch, p).y).toBeCloseTo(pt(r.sketch, q).y, 7);
    expect(r.degreesOfFreedom).toBe(2);
  });

  it("symmetry of lines about a slanted axis", () => {
    const b = builder();
    const axis = b.line({ x: 0, y: 0 }, { x: 100, y: 100 }, true);
    b.constrain("fix", axis);
    const l1 = b.line({ x: 10, y: 50 }, { x: 40, y: 90 });
    // Roughly mirrored, with the end points listed in reverse order.
    const l2 = b.line({ x: 92, y: 38 }, { x: 47, y: 12 });
    b.constrain("symmetry", l1, l2, axis);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    const [a1, b1] = lineEnds(r.sketch, l1);
    const [a2, b2] = lineEnds(r.sketch, l2);
    // Mirroring about y = x swaps the coordinates.
    expect(b2.x).toBeCloseTo(a1.y, 7);
    expect(b2.y).toBeCloseTo(a1.x, 7);
    expect(a2.x).toBeCloseTo(b1.y, 7);
    expect(a2.y).toBeCloseTo(b1.x, 7);
    expect(r.degreesOfFreedom).toBe(4);
  });

  it("treats projected geometry as fixed", () => {
    const b = builder();
    const edge = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const p = b.point(30, 12);
    b.constrain("coincident", p, edge);
    const sketch = b.build();
    sketch.projections.push({
      id: "proj1",
      mode: "project",
      bodyId: "body1",
      hint: { x: 0, y: 0, z: 0 },
      entityIds: [edge],
    });
    const r = solveSketch(sketch, { drag: [{ pointId: "p1", target: { x: 5, y: 5 } }] });
    expect(r.converged).toBe(true);
    expect(lineEnds(r.sketch, edge)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(pt(r.sketch, p).y).toBeCloseTo(0, 7);
    expect(r.degreesOfFreedom).toBe(1);
  });

  it("skips constraints with dangling references", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 100, y: 10 });
    b.constrain("parallel", l, "missing");
    b.constrain("coincident", "nope", l);
    const r = solveSketch(b.build());
    expect(r.converged).toBe(true);
    expect(r.degreesOfFreedom).toBe(4);
  });
});
