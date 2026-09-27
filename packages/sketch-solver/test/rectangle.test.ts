import { describe, expect, it } from "vitest";
import { NumericSketchSolver, createDefaultSolver, solveSketch } from "../src/index";
import { builder, expectRectangle, pt, sloppyRectangle } from "./helpers";

describe("dimensioned rectangle", () => {
  it("converges to 100 x 80 and leaves the translation free", () => {
    const r = sloppyRectangle();
    const result = solveSketch(r.sketch, { dimensionValues: r.values });
    expect(result.converged).toBe(true);
    expectRectangle(result.sketch, r);
    expect(result.status).toBe("under-constrained");
    expect(result.degreesOfFreedom).toBe(2);
    expect(result.conflicting).toEqual([]);
    expect(result.redundant).toEqual([]);
    expect(result.residual).toBeLessThan(1e-7);
    expect(result.iterations).toBeGreaterThan(0);
  });

  it("moves the geometry as little as possible", () => {
    const r = sloppyRectangle();
    const result = solveSketch(r.sketch, { dimensionValues: r.values });
    for (const id of r.points) {
      const before = pt(r.sketch, id);
      const after = pt(result.sketch, id);
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(10);
    }
  });

  it("is fully constrained once a corner is fixed", () => {
    const b = builder();
    const r = sloppyRectangle(b);
    b.constrain("fix", r.points[0]);
    const result = solveSketch(b.build(), { dimensionValues: r.values });
    expect(result.converged).toBe(true);
    expect(result.status).toBe("fully-constrained");
    expect(result.degreesOfFreedom).toBe(0);
    expectRectangle(result.sketch, r);
    expect(pt(result.sketch, r.points[0])).toEqual({ x: 1, y: -2 });
  });

  it("works with distance dimensions on the lines", () => {
    const b = builder();
    const r = sloppyRectangle(b);
    b.removeDimension(r.dims.width);
    b.removeDimension(r.dims.height);
    const w = b.dimension("distance", [r.lines[0]], "120");
    const h = b.dimension("distance", [r.points[1], r.points[2]], "45");
    const result = solveSketch(b.build(), { dimensionValues: { [w]: 120, [h]: 45 } });
    expect(result.converged).toBe(true);
    expectRectangle(result.sketch, r, 120, 45);
    expect(result.degreesOfFreedom).toBe(2);
  });

  it("does not mutate the input sketch", () => {
    const r = sloppyRectangle();
    const snapshot = structuredClone(r.sketch);
    const result = solveSketch(r.sketch, {
      dimensionValues: r.values,
      drag: [{ pointId: r.points[2], target: { x: 300, y: 300 } }],
    });
    expect(r.sketch).toEqual(snapshot);
    expect(result.sketch).not.toBe(r.sketch);
    expect(result.sketch.entities).not.toBe(r.sketch.entities);
    expect(result.sketch.entities[r.points[0]]).not.toBe(r.sketch.entities[r.points[0]]);
  });

  it("ignores dimensions without a value and driven dimensions", () => {
    const b = builder();
    const r = sloppyRectangle(b);
    b.dimension("distance", [r.lines[0]], "55", { driving: false });
    const driven = Object.keys(b.current.dimensions).at(-1) as string;
    const result = solveSketch(b.build(), {
      dimensionValues: { [r.dims.width]: 100, [driven]: 55 },
    });
    expect(result.converged).toBe(true);
    const [p1, p2, p3] = r.points.map((id) => pt(result.sketch, id));
    expect(p2!.x - p1!.x).toBeCloseTo(100, 6);
    // Height was not given a value: 8 variables − 4 H/V − 1 width.
    expect(result.degreesOfFreedom).toBe(3);
    expect(p3!.y - p2!.y).toBeGreaterThan(50);
  });

  it("handles empty sketches and free points", () => {
    const solver = createDefaultSolver();
    expect(solver).toBeInstanceOf(NumericSketchSolver);
    expect(solver.name).toBeTruthy();
    const empty = solver.solve(builder().build());
    expect(empty.converged).toBe(true);
    expect(empty.status).toBe("fully-constrained");
    expect(empty.degreesOfFreedom).toBe(0);

    const b = builder();
    b.point(3, 4);
    b.circle({ x: 0, y: 0 }, 5);
    const free = solver.solve(b.build());
    expect(free.status).toBe("under-constrained");
    expect(free.degreesOfFreedom).toBe(5);
  });
});
