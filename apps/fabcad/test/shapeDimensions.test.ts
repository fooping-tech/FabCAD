import { describe, expect, it } from "vitest";
import {
  type CreateResult,
  type Sketch,
  createArcCenter,
  createCircle,
  createLine,
  createPolygon,
  createRectangle2Point,
  createSketch,
  createSlot,
  editSketch,
} from "@fabcad/sketch";
import { shapeDimensions } from "../src/sketch/shapeDimensions";

function drawn(make: Parameters<typeof editSketch>[1] extends (b: infer B) => unknown ? (b: B) => CreateResult : never): {
  sketch: Sketch;
  result: CreateResult;
} {
  let result!: CreateResult;
  const sketch = editSketch(createSketch("s", "Sketch", { type: "origin", plane: "XY" }), (b) => {
    result = make(b);
  });
  return { sketch, result };
}

const summary = (tool: string, d: ReturnType<typeof drawn>) =>
  shapeDimensions(d.sketch, tool, d.result).map((x) => `${x.label} ${x.type} ${x.value}`);

describe("dimensions offered for a shape just drawn", () => {
  it("line, rectangle, circle, arc", () => {
    expect(summary("line", drawn((b) => createLine(b, { x: 0, y: 0 }, { x: 30, y: 40 })))).toEqual(["Length distance 50"]);
    expect(summary("rectangle-2point", drawn((b) => createRectangle2Point(b, { x: 0, y: 0 }, { x: 60, y: 40 })))).toEqual([
      "Width distance 60",
      "Height distance 40",
    ]);
    expect(summary("circle", drawn((b) => createCircle(b, { x: 0, y: 0 }, 12.5)))).toEqual(["Diameter diameter 25"]);
    expect(
      summary("arc-center", drawn((b) => createArcCenter(b, { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }))),
    ).toEqual(["Radius radius 8"]);
  });

  it("polygon and slot", () => {
    expect(
      summary("polygon-inscribed", drawn((b) => createPolygon(b, { x: 0, y: 0 }, { x: 10, y: 0 }, 6, "inscribed"))),
    ).toEqual(["Diameter (corners) diameter 20"]);
    expect(
      summary("polygon-circumscribed", drawn((b) => createPolygon(b, { x: 0, y: 0 }, { x: 10, y: 0 }, 6, "circumscribed"))),
    ).toEqual(["Across flats diameter 20"]);
    expect(summary("slot", drawn((b) => createSlot(b, { x: 0, y: 0 }, { x: 30, y: 0 }, 8)))).toEqual([
      "Length distance 30",
      "Width diameter 8",
    ]);
  });

  it("offers nothing where a dimension does not size the shape", () => {
    expect(summary("point", drawn((b) => createLine(b, { x: 0, y: 0 }, { x: 1, y: 0 })))).toEqual([]);
  });
});
