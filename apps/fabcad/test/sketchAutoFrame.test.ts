import { SketchBuilder, createSketch, setNodeMode } from "@fabcad/sketch";
import { describe, expect, it } from "vitest";
import { shouldAutoFrameSketchEdit } from "../src/viewport/sketchAutoFrame";

function outline() {
  const b = new SketchBuilder(createSketch("letter", "Letter", { type: "origin", plane: "XY" }));
  const p0 = b.point(-12, 0);
  const h0 = b.point(-9, 4);
  const h1 = b.point(-3, 4);
  const anchor = b.point(0, 0);
  const h2 = b.point(3, -4);
  const h3 = b.point(9, -4);
  const p3 = b.point(12, 0);
  b.spline("control", [p0, h0, h1, anchor]);
  b.spline("control", [anchor, h2, h3, p3]);
  return { sketch: b.build(), anchor };
}

describe("sketch auto-frame", () => {
  it("preserves camera position when switching Corner / Smooth / Symmetric on an outline", () => {
    const { sketch, anchor } = outline();
    const smooth = setNodeMode(sketch, anchor, "smooth");
    const symmetric = setNodeMode(smooth, anchor, "symmetric");
    const corner = setNodeMode(symmetric, anchor, "corner");

    expect(smooth).not.toBe(sketch);
    expect(symmetric).not.toBe(smooth);
    expect(corner).not.toBe(symmetric);
    for (const [before, after] of [[sketch, smooth], [smooth, symmetric], [symmetric, corner]] as const) {
      expect(shouldAutoFrameSketchEdit(before, after, false)).toBe(false);
      expect(shouldAutoFrameSketchEdit(after, before, false)).toBe(false);
    }
  });

  it("keeps zoom unchanged on an ordinary anchor or handle drag", () => {
    const { sketch, anchor } = outline();
    const b = new SketchBuilder(sketch);
    b.movePoint(anchor, { x: 25, y: -3 });
    expect(shouldAutoFrameSketchEdit(sketch, b.build(), false)).toBe(false);
  });

  it("still permits framing when a dimension is created or resized", () => {
    const { sketch } = outline();
    const b = new SketchBuilder(sketch);
    const line = b.line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const dimId = b.dimension("distance", [line], "10");
    const withDimension = b.build();
    expect(shouldAutoFrameSketchEdit(sketch, withDimension, false)).toBe(true);
    const resized = {
      ...withDimension,
      dimensions: {
        ...withDimension.dimensions,
        [dimId]: { ...withDimension.dimensions[dimId]!, expression: "500" },
      },
    };
    expect(shouldAutoFrameSketchEdit(withDimension, resized, false)).toBe(true);
  });

  it("does not reframe when only a dimension label is moved", () => {
    const { sketch } = outline();
    const b = new SketchBuilder(sketch);
    const line = b.line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const id = b.dimension("distance", [line], "10");
    const before = b.build();
    const after = {
      ...before,
      dimensions: {
        ...before.dimensions,
        [id]: { ...before.dimensions[id]!, labelPosition: { x: 99, y: 99 } },
      },
    };
    expect(shouldAutoFrameSketchEdit(before, after, false)).toBe(false);
  });

  it("allows parameter changes to reframe, but not new sketches", () => {
    const { sketch } = outline();
    expect(shouldAutoFrameSketchEdit(sketch, sketch, true)).toBe(true);
    expect(shouldAutoFrameSketchEdit(undefined, sketch, true)).toBe(false);
  });
});
