import { describe, expect, it } from "vitest";
import { createCircle, createLine, createPoint } from "../src/create";
import { SketchBuilder } from "../src/edit";
import {
  alignPoint,
  alignmentReferences,
  dimensionAnchor,
  hitTestSketch,
  measureDimension,
  sketchBounds,
  snapPoint,
} from "../src/measure";
import type { DimensionType, Sketch, SketchDimension } from "../src/model";
import { addProjection } from "../src/project";
import { build, emptySketch, v } from "./helpers";

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

describe("alignPoint", () => {
  const refs = [v(0, 0), v(40, 25), v(41, 80)];

  it("takes the X of a reference it is nearly above", () => {
    const r = alignPoint(v(0.4, 30), refs, 0.5);
    expect(r.point).toEqual(v(0, 30));
    expect(r.vertical).toEqual(v(0, 0));
    expect(r.horizontal).toBeUndefined();
  });

  it("takes the Y of a reference it is nearly beside", () => {
    const r = alignPoint(v(70, 24.7), refs, 0.5);
    expect(r.point).toEqual(v(70, 25));
    expect(r.horizontal).toEqual(v(40, 25));
    expect(r.vertical).toBeUndefined();
  });

  it("lines up with two references at once", () => {
    const r = alignPoint(v(0.2, 79.8), refs, 0.5);
    expect(r.point).toEqual(v(0, 80));
    expect(r.vertical).toEqual(v(0, 0));
    expect(r.horizontal).toEqual(v(41, 80));
  });

  it("prefers the reference that is nearest along the axis", () => {
    // X = 40.6 is 0.6 from the reference at 40 and 0.4 from the one at 41.
    const r = alignPoint(v(40.6, 50), refs, 1);
    expect(r.point.x).toBe(41);
    expect(r.vertical).toEqual(v(41, 80));
  });

  it("among references with the same X, reports the nearest", () => {
    const r = alignPoint(v(10.1, 95), [v(10, 0), v(10, 100)], 0.5);
    expect(r.vertical).toEqual(v(10, 100));
  });

  it("leaves a position alone that is not near any reference line", () => {
    const r = alignPoint(v(20, 60), refs, 0.5);
    expect(r).toEqual({ point: v(20, 60) });
  });

  it("puts a polygon corner exactly above its centre", () => {
    // Centre off the millimetre grid; the corner is placed by hand, a little to the side.
    const centre = v(12.37, 8.91);
    const r = alignPoint(v(12.6, 38.2), [centre], 0.4);
    expect(r.point.x).toBe(centre.x);
    expect(r.point.y).toBe(38.2);
  });

  it("collects the points of a sketch, the excluded ones left out", () => {
    const { sketch, ids } = fixture();
    const all = alignmentReferences(sketch);
    const some = alignmentReferences(sketch, [ids.l1a!]);
    expect(all.length).toBe(some.length + 1);
    expect(all).toContainEqual(v(30, 40));
  });

  it("leaves out the centers of projected circles and arcs", () => {
    const drawn = build((b) => createCircle(b, v(5, 5), 3));
    const sketch = addProjection(
      drawn.sketch,
      { type: "circle", center: v(-0.00001, 0.00001), radius: 50 },
      { bodyId: "body-1", source: "edge", hint: { x: 50, y: 0, z: 0 } },
    )!.sketch;
    const refs = alignmentReferences(sketch);
    expect(refs).toContainEqual(v(5, 5));
    expect(refs).not.toContainEqual(v(-0.00001, 0.00001));
  });
});
