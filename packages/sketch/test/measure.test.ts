import { describe, expect, it } from "vitest";
import { createCircle, createLine, createPoint } from "../src/create";
import { SketchBuilder } from "../src/edit";
import {
  dimensionAnchor,
  hitTestSketch,
  measureDimension,
  sketchBounds,
  snapPoint,
} from "../src/measure";
import type { DimensionType, Sketch, SketchDimension } from "../src/model";
import { emptySketch, v } from "./helpers";

function fixture(): { sketch: Sketch; ids: Record<string, string> } {
  const b = new SketchBuilder(emptySketch());
  const l1 = createLine(b, v(0, 0), v(30, 40));
  const l2 = createLine(b, v(0, 10), v(10, 10));
  const l3 = createLine(b, v(0, 20), v(10, 20));
  const up = createLine(b, v(50, 0), v(50, 10));
  const down = createLine(b, v(60, 10), v(60, 0));
  const p = createPoint(b, v(5, 15));
  const c = createCircle(b, v(100, 100), 7);
  const arc = b.arc(v(0, 100), v(5, 100), v(0, 105));
  return {
    sketch: b.build(),
    ids: {
      l1: l1.entities[0]!,
      l1a: l1.points[0]!,
      l1b: l1.points[1]!,
      l2: l2.entities[0]!,
      l3: l3.entities[0]!,
      up: up.entities[0]!,
      down: down.entities[0]!,
      p: p.points[0]!,
      c: c.entities[0]!,
      center: c.points[0]!,
      arc,
    },
  };
}

const dim = (type: DimensionType, refs: string[]): SketchDimension => ({
  id: "d",
  type,
  refs,
  expression: "1",
  driving: false,
});

describe("measureDimension", () => {
  const { sketch, ids } = fixture();
  const m = (type: DimensionType, ...refs: string[]): number | null =>
    measureDimension(sketch, dim(type, refs));

  it("distance", () => {
    expect(m("distance", ids.l1!)).toBeCloseTo(50);
    expect(m("distance", ids.l1a!, ids.l1b!)).toBeCloseTo(50);
    expect(m("distance", ids.p!, ids.l2!)).toBeCloseTo(5);
    expect(m("distance", ids.l2!, ids.p!)).toBeCloseTo(5);
    expect(m("distance", ids.l2!, ids.l3!)).toBeCloseTo(10);
  });

  it("horizontal / vertical distance", () => {
    expect(m("hdistance", ids.l1!)).toBeCloseTo(30);
    expect(m("hdistance", ids.l1b!, ids.l1a!)).toBeCloseTo(30);
    expect(m("vdistance", ids.l1!)).toBeCloseTo(40);
    expect(m("vdistance", ids.l1a!, ids.l1b!)).toBeCloseTo(40);
  });

  it("angle is CCW from the first to the second line in [0, 360)", () => {
    expect(m("angle", ids.l2!, ids.up!)).toBeCloseTo(90);
    expect(m("angle", ids.up!, ids.l2!)).toBeCloseTo(270);
    expect(m("angle", ids.l2!, ids.down!)).toBeCloseTo(270);
    expect(m("angle", ids.l2!, ids.l3!)).toBeCloseTo(0);
    expect(m("angle", ids.up!, ids.down!)).toBeCloseTo(180);
  });

  it("radius / diameter", () => {
    expect(m("radius", ids.c!)).toBeCloseTo(7);
    expect(m("diameter", ids.c!)).toBeCloseTo(14);
    expect(m("radius", ids.arc!)).toBeCloseTo(5);
    expect(m("diameter", ids.arc!)).toBeCloseTo(10);
  });

  it("unresolvable refs give null", () => {
    expect(m("distance", "nope")).toBeNull();
    expect(m("radius", ids.l1!)).toBeNull();
    expect(m("angle", ids.l1!, ids.c!)).toBeNull();
  });

  it("anchors", () => {
    const a = dimensionAnchor(sketch, dim("distance", [ids.l1!]));
    expect(a.points).toEqual([v(0, 0), v(30, 40)]);
    expect(Number.isFinite(a.defaultLabel.x)).toBe(true);
    const r = dimensionAnchor(sketch, dim("radius", [ids.c!]));
    expect(r.points[0]).toEqual(v(100, 100));
    expect(Math.hypot(r.points[1]!.x - 100, r.points[1]!.y - 100)).toBeCloseTo(7);
    const d = dimensionAnchor(sketch, dim("diameter", [ids.arc!]));
    expect(
      Math.hypot(d.points[1]!.x - d.points[0]!.x, d.points[1]!.y - d.points[0]!.y),
    ).toBeCloseTo(10);
    const g = dimensionAnchor(sketch, dim("angle", [ids.l2!, ids.up!]));
    expect(g.points[0]!.x).toBeCloseTo(50);
    expect(g.points[0]!.y).toBeCloseTo(10);
    for (const t of ["hdistance", "vdistance"] as const) {
      expect(dimensionAnchor(sketch, dim(t, [ids.l1!])).points).toHaveLength(2);
    }
    expect(dimensionAnchor(sketch, dim("distance", ["nope"])).points).toHaveLength(0);
  });
});

describe("bounds, hit test, snapping", () => {
  const { sketch, ids } = fixture();

  it("bounds include curves", () => {
    expect(sketchBounds(emptySketch())).toBeNull();
    const b = sketchBounds(sketch)!;
    expect(b.minX).toBeCloseTo(0, 1);
    expect(b.maxX).toBeCloseTo(107, 1);
    expect(b.maxY).toBeCloseTo(107, 1);
    expect(b.minY).toBeCloseTo(0);
  });

  it("hit test prefers points", () => {
    expect(hitTestSketch(sketch, v(0.3, 0.2), 1)).toMatchObject({ id: ids.l1a, type: "point" });
    expect(hitTestSketch(sketch, v(0.3, 0.2), 1, { points: false })).toMatchObject({ id: ids.l1 });
    expect(hitTestSketch(sketch, v(15.4, 20), 1)).toMatchObject({ id: ids.l1, type: "line" });
    expect(hitTestSketch(sketch, v(107.5, 100), 1)).toMatchObject({ id: ids.c, type: "circle" });
    expect(hitTestSketch(sketch, v(107.5, 100), 1, { curves: false })).toBeNull();
    expect(hitTestSketch(sketch, v(200, 200), 1)).toBeNull();
  });

  it("snap kinds", () => {
    expect(snapPoint(sketch, v(0.2, 0.1), 1)).toMatchObject({ kind: "point", pointId: ids.l1a });
    expect(snapPoint(sketch, v(100.2, 100), 1)).toMatchObject({
      kind: "center",
      pointId: ids.center,
      curveId: ids.c,
    });
    expect(snapPoint(sketch, v(5.2, 10.3), 1)).toMatchObject({
      kind: "midpoint",
      curveId: ids.l2,
      point: v(5, 10),
    });
    const onCurve = snapPoint(sketch, v(2, 10.3), 1);
    expect(onCurve.kind).toBe("curve");
    expect(onCurve.point.y).toBeCloseTo(10);
    expect(snapPoint(sketch, v(200, 200), 1)).toEqual({ point: v(200, 200), kind: "none" });
    expect(snapPoint(sketch, v(0.2, 0.1), 1, [ids.l1a!, ids.l1!]).kind).toBe("none");
  });
});
