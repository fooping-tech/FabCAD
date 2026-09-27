import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/index";
import { builder, dist, expectRectangle, lineLength, pt, sloppyRectangle } from "./helpers";

describe("dragging", () => {
  it("translates a dimensioned rectangle with the dragged corner", () => {
    const rect = sloppyRectangle();
    const solved = solveSketch(rect.sketch, { dimensionValues: rect.values });
    const target = { x: 250, y: 190 };
    const r = solveSketch(solved.sketch, {
      dimensionValues: rect.values,
      drag: [{ pointId: rect.points[2], target }],
    });
    expect(r.converged).toBe(true);
    expect(r.status).toBe("under-constrained");
    expect(r.degreesOfFreedom).toBe(2);
    expectRectangle(r.sketch, rect);
    expect(pt(r.sketch, rect.points[2]).x).toBeCloseTo(target.x, 6);
    expect(pt(r.sketch, rect.points[2]).y).toBeCloseTo(target.y, 6);
    expect(pt(r.sketch, rect.points[0]).x).toBeCloseTo(target.x - 100, 3);
    expect(pt(r.sketch, rect.points[0]).y).toBeCloseTo(target.y - 80, 3);
  });

  it("solves and drags an unsolved sketch in one call", () => {
    const rect = sloppyRectangle();
    const r = solveSketch(rect.sketch, {
      dimensionValues: rect.values,
      drag: [{ pointId: rect.points[0], target: { x: -40, y: 12 } }],
    });
    expect(r.converged).toBe(true);
    expectRectangle(r.sketch, rect);
    expect(pt(r.sketch, rect.points[0]).x).toBeCloseTo(-40, 3);
    expect(pt(r.sketch, rect.points[0]).y).toBeCloseTo(12, 3);
  });

  it("leaves a fully fixed sketch unchanged", () => {
    const b = builder();
    const rect = sloppyRectangle(b);
    b.constrain("fix", rect.points[0]);
    const solved = solveSketch(b.build(), { dimensionValues: rect.values });
    const r = solveSketch(solved.sketch, {
      dimensionValues: rect.values,
      drag: [{ pointId: rect.points[2], target: { x: 400, y: -300 } }],
    });
    expect(r.status).toBe("fully-constrained");
    expectRectangle(r.sketch, rect);
    for (const id of rect.points) {
      expect(dist(pt(r.sketch, id), pt(solved.sketch, id))).toBeLessThan(1e-6);
    }
  });

  it("does not move a fixed point", () => {
    const b = builder();
    const p = b.point(10, 20);
    const l = b.line(p, { x: 60, y: 20 });
    b.constrain("fix", p);
    const r = solveSketch(b.build(), { drag: [{ pointId: p, target: { x: 500, y: 500 } }] });
    expect(r.converged).toBe(true);
    expect(pt(r.sketch, p)).toEqual({ x: 10, y: 20 });
    expect(lineLength(r.sketch, l)).toBeCloseTo(50, 9);
  });

  it("pulls the dragged point back onto the constraints", () => {
    const b = builder();
    const o = b.point(0, 0);
    const tip = b.point(50, 0);
    const l = b.line(o, tip);
    b.constrain("fix", o);
    const d = b.dimension("distance", [l], "50");
    const r = solveSketch(b.build(), {
      dimensionValues: { [d]: 50 },
      drag: [{ pointId: tip, target: { x: 60, y: 80 } }],
    });
    expect(r.converged).toBe(true);
    expect(lineLength(r.sketch, l)).toBeCloseTo(50, 6);
    expect(pt(r.sketch, o)).toEqual({ x: 0, y: 0 });
    // The tip ends up on the circle, in the direction of the cursor.
    expect(pt(r.sketch, tip).x).toBeCloseTo(30, 4);
    expect(pt(r.sketch, tip).y).toBeCloseTo(40, 4);
  });

  it("drags a free point exactly to the target", () => {
    const b = builder();
    const p = b.point(1, 1);
    const r = solveSketch(b.build(), { drag: [{ pointId: p, target: { x: 7, y: -3 } }] });
    expect(r.converged).toBe(true);
    expect(pt(r.sketch, p)).toEqual({ x: 7, y: -3 });
  });

  it("keeps orientation when the drag crosses over another point", () => {
    const rect = sloppyRectangle();
    const solved = solveSketch(rect.sketch, { dimensionValues: rect.values });
    // Drag the right-hand corner far to the left of the left-hand corner.
    const r = solveSketch(solved.sketch, {
      dimensionValues: rect.values,
      drag: [{ pointId: rect.points[1], target: { x: -500, y: 0 } }],
    });
    expect(r.converged).toBe(true);
    expectRectangle(r.sketch, rect);
    expect(pt(r.sketch, rect.points[1]).x).toBeCloseTo(-500, 6);
  });

  it("ignores drags of unknown points and never drags an over-constrained sketch", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 55, y: 0 });
    const d1 = b.dimension("distance", [l], "50");
    const d2 = b.dimension("distance", [l], "60");
    const values = { [d1]: 50, [d2]: 60 };
    const plain = solveSketch(b.build(), { dimensionValues: values });
    const r = solveSketch(b.build(), {
      dimensionValues: values,
      drag: [
        { pointId: "p1", target: { x: 100, y: 100 } },
        { pointId: "nope", target: { x: 0, y: 0 } },
      ],
    });
    expect(r.status).toBe("over-constrained");
    expect(r.converged).toBe(false);
    expect(r.sketch).toEqual(plain.sketch);
  });
});
