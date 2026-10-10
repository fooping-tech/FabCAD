import { describe, expect, it } from "vitest";
import {
  SketchBuilder,
  createSketch,
  expandNodeDrag,
  getPoint,
  nodeHandlePair,
  setNodeMode,
} from "../src";

function example() {
  const b = new SketchBuilder(createSketch("nodes", "Nodes", { type: "origin", plane: "XY" }));
  const start = b.point(-10, 0);
  const c0 = b.point(-7, 1);
  const incoming = b.point(-3, 2);
  const anchor = b.point(0, 0);
  const outgoing = b.point(3, 4);
  const c3 = b.point(7, 5);
  const end = b.point(10, 0);
  b.spline("control", [start, c0, incoming, anchor]);
  b.spline("control", [anchor, outgoing, c3, end]);
  return { sketch: b.build(), start, incoming, anchor, outgoing, end };
}

const targetOf = (targets: { pointId: string; target: { x: number; y: number } }[], id: string) =>
  targets.find((t) => t.pointId === id)?.target;

describe("Bézier outline node modes", () => {
  it("recognizes only two adjoining cubic spans as a smoothable anchor", () => {
    const { sketch, anchor, incoming, outgoing, start } = example();
    expect(nodeHandlePair(sketch, anchor)).toEqual({ incoming, outgoing });
    expect(nodeHandlePair(sketch, start)).toBeNull();
    const b = new SketchBuilder(sketch);
    b.line(start, anchor);
    expect(nodeHandlePair(b.build(), anchor)).toBeNull();
  });

  it("converts a corner to smooth while retaining both handle lengths", () => {
    const { sketch, anchor, incoming, outgoing } = example();
    const beforeIn = getPoint(sketch, incoming);
    const beforeOut = getPoint(sketch, outgoing);
    const smooth = setNodeMode(sketch, anchor, "smooth");
    expect(sketch.nodeModes).toBeUndefined();
    expect(smooth.nodeModes?.[anchor]).toBe("smooth");
    const i = getPoint(smooth, incoming);
    const o = getPoint(smooth, outgoing);
    expect(Math.hypot(i.x, i.y)).toBeCloseTo(Math.hypot(beforeIn.x, beforeIn.y), 6);
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(Math.hypot(beforeOut.x, beforeOut.y), 6);
    expect(i.x * o.y - i.y * o.x).toBeCloseTo(0, 8);
    expect(i.x * o.x + i.y * o.y).toBeLessThan(0);
  });

  it("makes symmetric handles equal-length and remains serializable", () => {
    const { sketch, anchor, incoming, outgoing } = example();
    const result = setNodeMode(sketch, anchor, "symmetric");
    const i = getPoint(result, incoming), o = getPoint(result, outgoing);
    expect(Math.hypot(i.x, i.y)).toBeCloseTo(Math.hypot(o.x, o.y), 8);
    expect(i.x + o.x).toBeCloseTo(0, 8);
    expect(i.y + o.y).toBeCloseTo(0, 8);
    expect((JSON.parse(JSON.stringify(result)) as typeof sketch).nodeModes?.[anchor]).toBe("symmetric");
    expect(setNodeMode(result, anchor, "corner").nodeModes?.[anchor]).toBeUndefined();
  });

  it("moves the other handle only when smooth or symmetric, with correct lengths", () => {
    const { sketch, anchor, incoming, outgoing } = example();
    const outLength = Math.hypot(3, 4);
    const desired = { x: -8, y: 0 };
    const direct = [{ pointId: incoming, target: desired }];
    expect(targetOf(expandNodeDrag(sketch, direct), outgoing)).toBeUndefined();
    const smooth = expandNodeDrag(setNodeMode(sketch, anchor, "smooth"), direct);
    expect(targetOf(smooth, outgoing)?.x).toBeCloseTo(5, 8);
    expect(targetOf(smooth, outgoing)?.y).toBeCloseTo(0, 8);
    expect(outLength).toBe(5);
    const symmetric = expandNodeDrag(setNodeMode(sketch, anchor, "symmetric"), direct);
    expect(targetOf(symmetric, outgoing)?.x).toBeCloseTo(8, 8);
    expect(targetOf(symmetric, outgoing)?.y).toBeCloseTo(0, 8);
  });

  it("carries both handles when moving an anchor, including corner nodes", () => {
    const { sketch, anchor, incoming, outgoing } = example();
    const targets = expandNodeDrag(sketch, [{ pointId: anchor, target: { x: 2, y: -1 } }]);
    expect(targetOf(targets, incoming)).toEqual({ x: -1, y: 1 });
    expect(targetOf(targets, outgoing)).toEqual({ x: 5, y: 3 });
    const symmetric = setNodeMode(sketch, anchor, "symmetric");
    const p = getPoint(symmetric, incoming);
    const q = getPoint(symmetric, outgoing);
    const moved = expandNodeDrag(symmetric, [{ pointId: anchor, target: { x: 2, y: -1 } }]);
    expect(targetOf(moved, incoming)).toEqual({ x: p.x + 2, y: p.y - 1 });
    expect(targetOf(moved, outgoing)).toEqual({ x: q.x + 2, y: q.y - 1 });
  });

  it("drops node mode metadata when the anchor is removed", () => {
    const { sketch, anchor } = example();
    const symmetric = setNodeMode(sketch, anchor, "symmetric");
    const b = new SketchBuilder(symmetric);
    b.remove([anchor]);
    expect(b.build().nodeModes?.[anchor]).toBeUndefined();
  });

  it("does not change a sketch when smooth is unsupported", () => {
    const { sketch, start } = example();
    expect(setNodeMode(sketch, start, "smooth")).toBe(sketch);
  });
});
