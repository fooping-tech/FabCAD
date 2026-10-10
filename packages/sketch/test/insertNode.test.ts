import { curvePointAt, dist2, closestParam } from "@fabcad/geometry";
import { describe, expect, it } from "vitest";
import {
  SketchBuilder,
  createSketch,
  detectProfiles,
  entityToCurves,
  getPoint,
  insertNodeOnCurve,
  nodeHandlePair,
} from "../src";

function outline() {
  const b = new SketchBuilder(createSketch("outline", "Outline", { type: "origin", plane: "XY" }));
  const start = b.point(0, 0);
  const c1 = b.point(2, 7);
  const c2 = b.point(10, 7);
  const end = b.point(12, 0);
  const bezier = b.spline("control", [start, c1, c2, end]);
  const bottomRight = b.point(12, -10);
  const bottomLeft = b.point(0, -10);
  b.line(end, bottomRight);
  b.line(bottomRight, bottomLeft);
  b.line(bottomLeft, start);
  return { sketch: b.build(), bezier, start, end };
}

describe("insertNodeOnCurve", () => {
  it("splits a line into independently movable pieces sharing a single anchor", () => {
    const b = new SketchBuilder(createSketch("line", "Line", { type: "origin", plane: "XY" }));
    const a = b.point(0, 0);
    const z = b.point(10, 0);
    const original = b.line(a, z);
    const before = b.build();
    const { sketch, nodeId } = insertNodeOnCurve(before, original, { x: 4, y: 1 });
    expect(nodeId).not.toBeNull();
    expect(getPoint(sketch, nodeId!)).toEqual({ x: 4, y: 0 });
    const pieces = Object.values(sketch.entities).filter((e) => e.type === "line");
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ id: original, p1: a, p2: nodeId });
    expect(pieces[1]).toMatchObject({ p1: nodeId, p2: z });
    expect(Object.values(sketch.constraints)).toHaveLength(0);
    // The inserted node is not constrained to a straight line.
    const moved = new SketchBuilder(sketch);
    moved.movePoint(nodeId!, { x: 4, y: 5 });
    expect(entityToCurves(moved.build(), pieces[0]!)[0]).toMatchObject({ b: { x: 4, y: 5 } });
    expect(entityToCurves(moved.build(), pieces[1]!)[0]).toMatchObject({ a: { x: 4, y: 5 } });
    expect(before.entities[nodeId!]).toBeUndefined();
  });

  it("splits cubic Bézier exactly and assigns Smooth mode to the new node", () => {
    const { sketch: before, bezier } = outline();
    const source = before.entities[bezier]!;
    if (source.type !== "spline") throw Error("not a spline");
    const originalCurve = entityToCurves(before, source)[0]!;
    const picked = curvePointAt(originalCurve, 0.38);
    const { sketch, nodeId } = insertNodeOnCurve(before, bezier, picked);
    expect(nodeId).not.toBeNull();
    expect(sketch.nodeModes?.[nodeId!]).toBe("smooth");
    const updated = sketch.entities[bezier];
    expect(updated?.type).toBe("spline");
    const parts = Object.values(sketch.entities).filter((e) => e.type === "spline");
    expect(parts).toHaveLength(2);
    const first = entityToCurves(sketch, parts.find((e) => e.id === bezier)!)[0]!;
    const second = entityToCurves(sketch, parts.find((e) => e.id !== bezier)!)[0]!;
    expect(first.type).toBe("bezier");
    expect(second.type).toBe("bezier");
    expect(nodeHandlePair(sketch, nodeId!)).not.toBeNull();
    const t = closestParam(originalCurve, getPoint(sketch, nodeId!));
    // Evaluate both new cubics against the original parameterisation.
    for (const u of [0, 0.07, 0.13, 0.27, 0.38, 0.45, 0.62, 0.81, 0.94, 1]) {
      const part = u <= t ? first : second;
      const local = u <= t ? u / t : (u - t) / (1 - t);
      expect(dist2(curvePointAt(part, local), curvePointAt(originalCurve, u))).toBeLessThan(1e-5);
    }
    expect(getPoint(before, source.points[1]!)).toEqual({ x: 2, y: 7 });
  });

  it("preserves closed outer contours and holes when inserting nodes", () => {
    const { sketch: original, bezier } = outline();
    const b = new SketchBuilder(original);
    const i1 = b.point(4, -3), i2 = b.point(8, -3), i3 = b.point(8, -7), i4 = b.point(4, -7);
    b.line(i1, i4);
    b.line(i4, i3);
    b.line(i3, i2);
    b.line(i2, i1);
    const before = b.build();
    const regionsBefore = detectProfiles(before);
    expect(regionsBefore).toHaveLength(2);
    const originalCurve = entityToCurves(before, before.entities[bezier]! as Extract<typeof before.entities[string], {type:"spline"}>)[0]!;
    const withBezierNode = insertNodeOnCurve(before, bezier, curvePointAt(originalCurve, 0.5)).sketch;
    const regionsAfter = detectProfiles(withBezierNode);
    expect(regionsAfter).toHaveLength(2);
    const sumArea = (regions: typeof regionsBefore) => regions.reduce((sum, r) => sum + r.area, 0);
    expect(sumArea(regionsAfter)).toBeCloseTo(sumArea(regionsBefore), 3);
    expect(regionsAfter.some((r) => r.holePolygons.length > 0)).toBe(true);
    const holeLine = Object.values(withBezierNode.entities).find(
      (e) => e.type === "line" && e.p1 === i1 && e.p2 === i4,
    )!;
    const split = insertNodeOnCurve(withBezierNode, holeLine.id, { x: 4, y: -5 });
    expect(split.nodeId).not.toBeNull();
    expect(detectProfiles(split.sketch)).toHaveLength(2);
  });

  it("does not add nodes near existing endpoints or unsupported curves", () => {
    const { sketch, bezier, start } = outline();
    expect(insertNodeOnCurve(sketch, bezier, getPoint(sketch, start)).nodeId).toBeNull();
    expect(insertNodeOnCurve(sketch, "missing", { x: 3, y: 3 }).sketch).toBe(sketch);
    const b = new SketchBuilder(sketch);
    const circle = b.circle({ x: 99, y: 99 }, 10);
    const withCircle = b.build();
    expect(insertNodeOnCurve(withCircle, circle, { x: 109, y: 99 }).sketch).toBe(withCircle);
  });

  it("refuses constrained curves rather than silently changing constraints", () => {
    const { sketch, bezier } = outline();
    const b = new SketchBuilder(sketch);
    b.constrain("fix", bezier);
    const constrained = b.build();
    const p = curvePointAt(entityToCurves(sketch, sketch.entities[bezier]! as Extract<typeof sketch.entities[string], {type:"spline"}>)[0]!, 0.5);
    expect(insertNodeOnCurve(constrained, bezier, p)).toEqual({ sketch: constrained, nodeId: null });
  });
});
