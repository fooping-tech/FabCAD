import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/index";
import { builder, expectRectangle, lineLength, sloppyRectangle } from "./helpers";

describe("diagnostics", () => {
  it("reports conflicting dimensions as over-constrained", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 55, y: 0 });
    const d1 = b.dimension("distance", [l], "50");
    const d2 = b.dimension("distance", [l], "60");
    const r = solveSketch(b.build(), { dimensionValues: { [d1]: 50, [d2]: 60 } });
    expect(r.converged).toBe(false);
    expect(r.status).toBe("over-constrained");
    expect(r.conflicting.sort()).toEqual([d1, d2].sort());
    expect(r.residual).toBeGreaterThan(1);
    // Best attempt: a compromise between the two.
    expect(lineLength(r.sketch, l)).toBeCloseTo(55, 3);
  });

  it("reports only the constraints involved in a conflict", () => {
    const b = builder();
    const r0 = sloppyRectangle(b);
    b.constrain("fix", r0.points[0]);
    const extra = b.dimension("distance", [r0.lines[2]], "130");
    const other = b.line({ x: 300, y: 0 }, { x: 350, y: 5 });
    const h = b.constrain("horizontal", other);
    const r = solveSketch(b.build(), { dimensionValues: { ...r0.values, [extra]: 130 } });
    expect(r.status).toBe("over-constrained");
    expect(r.converged).toBe(false);
    expect(r.conflicting).toContain(extra);
    expect(r.conflicting).not.toContain(h);
    expect(r.conflicting.length).toBeGreaterThan(1);
  });

  it("fixed points that are asked to move are over-constrained", () => {
    const b = builder();
    const l = b.line({ x: 0, y: 0 }, { x: 55, y: 0 });
    b.constrain("fix", l);
    const d = b.dimension("distance", [l], "80");
    const r = solveSketch(b.build(), { dimensionValues: { [d]: 80 } });
    expect(r.status).toBe("over-constrained");
    expect(r.conflicting).toContain(d);
  });

  it("accepts redundant but consistent constraints", () => {
    const b = builder();
    const rect = sloppyRectangle(b);
    const parallel = b.constrain("parallel", rect.lines[0], rect.lines[2]);
    const perpendicular = b.constrain("perpendicular", rect.lines[0], rect.lines[1]);
    const top = b.dimension("distance", [rect.lines[2]], "100");
    const r = solveSketch(b.build(), { dimensionValues: { ...rect.values, [top]: 100 } });
    expect(r.converged).toBe(true);
    expect(r.status).toBe("under-constrained");
    expect(r.degreesOfFreedom).toBe(2);
    expect(r.conflicting).toEqual([]);
    expect(r.redundant.sort()).toEqual([parallel, perpendicular, top].sort());
    expectRectangle(r.sketch, rect);
  });

  it("redundant constraints on a fully constrained sketch", () => {
    const b = builder();
    const rect = sloppyRectangle(b);
    b.constrain("fix", rect.points[0]);
    const equal = b.constrain("equal", rect.lines[0], rect.lines[2]);
    const r = solveSketch(b.build(), { dimensionValues: rect.values });
    expect(r.converged).toBe(true);
    expect(r.status).toBe("fully-constrained");
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.redundant).toEqual([equal]);
  });

  it("honours maxIterations and tolerance", () => {
    const rect = sloppyRectangle();
    const short = solveSketch(rect.sketch, { dimensionValues: rect.values, maxIterations: 0 });
    expect(short.converged).toBe(false);
    expect(short.iterations).toBe(0);
    const loose = solveSketch(rect.sketch, { dimensionValues: rect.values, tolerance: 100 });
    expect(loose.converged).toBe(true);
    expect(loose.iterations).toBe(0);
  });
});
