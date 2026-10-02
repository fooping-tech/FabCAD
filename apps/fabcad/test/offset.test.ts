import { describe, expect, it } from "vitest";
import { createCircle, createRectangle2Point, createSketch, editSketch } from "@fabcad/sketch";
import { offsetSideAt, offsetSketch, offsetThrough, onOffsetPreview } from "../src/sketch/offsetGeometry";

/** A 40 × 20 rectangle at the origin; the chain is its four lines. */
function rectangle() {
  let chain: string[] = [];
  const sketch = editSketch(createSketch("s", "Sketch", { type: "origin", plane: "XY" }), (b) => {
    chain = createRectangle2Point(b, { x: 0, y: 0 }, { x: 40, y: 20 }).entities;
  });
  return { sketch, chain };
}

const xsOf = (before: ReturnType<typeof rectangle>["sketch"], after: ReturnType<typeof rectangle>["sketch"]) =>
  Object.values(after.entities)
    .filter((e) => e.type === "point" && !before.entities[e.id])
    .map((e) => (e.type === "point" ? e.x : 0));

describe("sketch offset", () => {
  it("previews on the side that was clicked", () => {
    const { sketch, chain } = rectangle();
    const outside = offsetSideAt(sketch, chain, 5, { x: 20, y: -3 })!;
    const inside = offsetSideAt(sketch, chain, 5, { x: 20, y: 3 })!;
    expect(outside).toBe(-inside);
    const grown = xsOf(sketch, offsetSketch(sketch, { chain, distance: 5, side: outside })!);
    expect(Math.min(...grown)).toBeCloseTo(-5);
    expect(Math.max(...grown)).toBeCloseTo(45);
  });

  it("refuses an offset that collapses a circle, and a zero distance", () => {
    let chain: string[] = [];
    const sketch = editSketch(createSketch("s", "Sketch", { type: "origin", plane: "XY" }), (b) => {
      chain = createCircle(b, { x: 0, y: 0 }, 10).entities;
    });
    expect(offsetSideAt(sketch, chain, 4, { x: 7, y: 0 })).toBe(-1);
    expect(offsetSketch(sketch, { chain, distance: 12, side: -1 })).toBeNull();
    expect(offsetSketch(sketch, { chain, distance: 12, side: 1 })).not.toBeNull();
    expect(offsetSketch(sketch, { chain, distance: 0, side: 1 })).toBeNull();
  });

  it("follows a drag of the previewed curve, in steps", () => {
    const { sketch, chain } = rectangle();
    const outside = offsetSideAt(sketch, chain, 5, { x: 20, y: -3 })!;
    expect(offsetThrough(sketch, chain, { x: 20, y: -7.3 }, 1)).toEqual({ distance: 7, side: outside });
    expect(offsetThrough(sketch, chain, { x: 20, y: 2.26 }, 0.5)).toEqual({ distance: 2.5, side: -outside });
    const offset = { sketchId: "s", chain, distance: 5, side: outside };
    expect(onOffsetPreview(sketch, offset, { x: 10, y: -5.2 }, 0.5)).toBe(true);
    expect(onOffsetPreview(sketch, offset, { x: 10, y: -2 }, 0.5)).toBe(false);
  });
});
