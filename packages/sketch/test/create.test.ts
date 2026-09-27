import { describe, expect, it } from "vitest";
import { dist2 } from "@fabcad/geometry";
import {
  SKETCH_CREATE_TOOLS,
  createArc3Point,
  createArcCenter,
  createCircle,
  createCircle3Point,
  createConstructionLine,
  createEllipse,
  createLine,
  createPoint,
  createPolygon,
  createPolyline,
  createRectangle2Point,
  createRectangle3Point,
  createRectangleCenter,
  createSlot,
  createSpline,
} from "../src/create";
import { entityToCurves } from "../src/curves";
import { getPoint } from "../src/edit";
import type { ArcEntity, LineEntity } from "../src/model";
import { build, constraintTypes, countTypes, v } from "./helpers";

describe("create tools", () => {
  it("point / line / construction line", () => {
    const { sketch, out } = build((b) => {
      const p = createPoint(b, v(1, 2));
      const l = createLine(b, p.points[0]!, v(10, 0));
      const c = createConstructionLine(b, l.points[1]!, v(10, 10));
      return { p, l, c };
    });
    expect(countTypes(sketch)).toEqual({ point: 3, line: 2 });
    expect(out.l.points[0]).toBe(out.p.points[0]);
    expect((sketch.entities[out.c.entities[0]!] as LineEntity).construction).toBe(true);
    expect((sketch.entities[out.l.entities[0]!] as LineEntity).construction).toBeUndefined();
    expect((sketch.entities[out.c.entities[0]!] as LineEntity).p1).toBe(out.l.points[1]);
  });

  it("polyline shares points", () => {
    const { sketch, out } = build((b) =>
      createPolyline(b, [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], true),
    );
    expect(countTypes(sketch)).toEqual({ point: 4, line: 4 });
    const lines = out.entities.map((id) => sketch.entities[id] as LineEntity);
    lines.forEach((l, i) => expect(l.p2).toBe(lines[(i + 1) % 4]!.p1));
    const open = build((b) => createPolyline(b, [v(0, 0), v(10, 0), v(10, 10)], false));
    expect(countTypes(open.sketch)).toEqual({ point: 3, line: 2 });
  });

  it("2 point rectangle", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(100, 80)));
    expect(countTypes(sketch)).toEqual({ point: 4, line: 4 });
    expect(constraintTypes(sketch)).toEqual({ horizontal: 2, vertical: 2 });
    expect(out.entities).toHaveLength(4);
    expect(out.constraints).toHaveLength(4);
    for (const c of Object.values(sketch.constraints)) {
      const l = sketch.entities[c.refs[0]!] as LineEntity;
      const a = getPoint(sketch, l.p1);
      const b = getPoint(sketch, l.p2);
      if (c.type === "horizontal") expect(a.y).toBeCloseTo(b.y);
      else expect(a.x).toBeCloseTo(b.x);
    }
  });

  it("3 point rectangle", () => {
    const { sketch, out } = build((b) => createRectangle3Point(b, v(0, 0), v(10, 10), v(0, 10)));
    expect(countTypes(sketch)).toEqual({ point: 4, line: 4 });
    expect(constraintTypes(sketch)).toEqual({ parallel: 2, perpendicular: 1 });
    const pts = out.points.map((p) => getPoint(sketch, p));
    expect(dist2(pts[0]!, pts[1]!)).toBeCloseTo(Math.hypot(10, 10));
    expect(dist2(pts[1]!, pts[2]!)).toBeCloseTo(Math.SQRT1_2 * 10);
    expect(pts[3]!.x).toBeCloseTo(-5);
    expect(pts[3]!.y).toBeCloseTo(5);
  });

  it("center rectangle", () => {
    const { sketch, out } = build((b) => createRectangleCenter(b, v(10, 10), v(30, 20)));
    expect(countTypes(sketch)).toEqual({ point: 5, line: 5 });
    expect(constraintTypes(sketch)).toEqual({ horizontal: 2, vertical: 2, midpoint: 1 });
    const construction = Object.values(sketch.entities).filter((e) => e.construction);
    expect(construction).toHaveLength(1);
    const xs = out.points
      .slice(0, 4)
      .map((p) => getPoint(sketch, p).x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([-10, -10, 30, 30]);
    expect(getPoint(sketch, out.points[4]!)).toEqual({ x: 10, y: 10 });
  });

  it("circles", () => {
    const { sketch, out } = build((b) => ({
      c: createCircle(b, v(0, 0), 5),
      c3: createCircle3Point(b, v(10, 0), v(0, 10), v(-10, 0)),
    }));
    expect(countTypes(sketch)).toEqual({ point: 5, circle: 2 });
    expect(constraintTypes(sketch)).toEqual({ coincident: 3 });
    const c3 = sketch.entities[out.c3.entities[0]!]!;
    expect(c3.type === "circle" && c3.radius).toBeCloseTo(10);
    const center = getPoint(sketch, out.c3.points[0]!);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
    for (const c of Object.values(sketch.constraints)) expect(c.refs[1]).toBe(c3.id);
  });

  it("center arc stores CCW and swaps when clockwise", () => {
    const { sketch, out } = build((b) => ({
      ccw: createArcCenter(b, v(0, 0), v(10, 0), v(0, 20)),
      cw: createArcCenter(b, v(0, 0), v(10, 0), v(0, 10), false),
    }));
    const ccw = sketch.entities[out.ccw.entities[0]!] as ArcEntity;
    expect(ccw.start).toBe(out.ccw.points[1]);
    expect(getPoint(sketch, ccw.end).y).toBeCloseTo(10); // projected onto the radius
    expect(entityToCurves(sketch, ccw)[0]).toMatchObject({ type: "arc", radius: 10 });
    const cw = sketch.entities[out.cw.entities[0]!] as ArcEntity;
    expect(cw.start).toBe(out.cw.points[2]);
    expect(cw.end).toBe(out.cw.points[1]);
    const curve = entityToCurves(sketch, cw)[0]!;
    expect(curve.type === "arc" && curve.sweep).toBeCloseTo(1.5 * Math.PI);
  });

  it("3 point arc passes through the third point", () => {
    for (const through of [v(0, 10), v(0, -10)]) {
      const { sketch, out } = build((b) => createArc3Point(b, v(10, 0), v(-10, 0), through));
      const arc = sketch.entities[out.entities[0]!] as ArcEntity;
      const curve = entityToCurves(sketch, arc)[0]!;
      expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI);
      const mid = { x: 0, y: 0 };
      if (curve.type === "arc") {
        const a = curve.startAngle + curve.sweep / 2;
        mid.x = curve.center.x + curve.radius * Math.cos(a);
        mid.y = curve.center.y + curve.radius * Math.sin(a);
      }
      expect(mid.x).toBeCloseTo(through.x);
      expect(mid.y).toBeCloseTo(through.y);
    }
  });

  it("ellipse and splines", () => {
    const { sketch, out } = build((b) => ({
      e: createEllipse(b, v(0, 0), v(20, 0), 5),
      f: createSpline(b, "fit", [v(0, 0), v(10, 5), v(20, 0)]),
      c: createSpline(b, "control", [v(0, 0), v(10, 5), v(20, 0), v(30, 5)], false),
    }));
    expect(countTypes(sketch)).toEqual({ point: 9, ellipse: 1, spline: 2 });
    expect(out.f.points).toHaveLength(3);
    expect(sketch.entities[out.c.entities[0]!]).toMatchObject({ kind: "control", closed: false });
  });

  it("inscribed polygon", () => {
    const { sketch, out } = build((b) => createPolygon(b, v(0, 0), v(10, 0), 6));
    expect(countTypes(sketch)).toEqual({ point: 7, line: 6, circle: 1 });
    expect(constraintTypes(sketch)).toEqual({ coincident: 6, equal: 5 });
    const circle = sketch.entities[out.entities[6]!]!;
    expect(circle.construction).toBe(true);
    for (const p of out.points.slice(0, 6)) {
      expect(dist2(getPoint(sketch, p), v(0, 0))).toBeCloseTo(10);
    }
    const lines = out.entities.slice(0, 6).map((id) => sketch.entities[id] as LineEntity);
    lines.forEach((l, i) => expect(l.p2).toBe(lines[(i + 1) % 6]!.p1));
  });

  it("circumscribed polygon", () => {
    const { sketch, out } = build((b) => createPolygon(b, v(0, 0), v(10, 0), 4, "circumscribed"));
    expect(constraintTypes(sketch)).toEqual({ tangent: 4, equal: 3 });
    for (const p of out.points.slice(0, 4)) {
      expect(dist2(getPoint(sketch, p), v(0, 0))).toBeCloseTo(10 * Math.SQRT2);
    }
    const first = sketch.entities[out.entities[0]!] as LineEntity;
    const a = getPoint(sketch, first.p1);
    const c = getPoint(sketch, first.p2);
    expect((a.x + c.x) / 2).toBeCloseTo(10);
    expect((a.y + c.y) / 2).toBeCloseTo(0);
  });

  it("slot", () => {
    const { sketch, out } = build((b) => createSlot(b, v(0, 0), v(40, 0), 10));
    expect(countTypes(sketch)).toEqual({ point: 6, line: 3, arc: 2 });
    expect(constraintTypes(sketch)).toEqual({ tangent: 4, parallel: 1 });
    const [l1, a1, l2, a2, axis] = out.entities.map((id) => sketch.entities[id]!);
    expect(axis!.construction).toBe(true);
    expect((l1 as LineEntity).p2).toBe((a1 as ArcEntity).start);
    expect((a1 as ArcEntity).end).toBe((l2 as LineEntity).p1);
    expect((l2 as LineEntity).p2).toBe((a2 as ArcEntity).start);
    expect((a2 as ArcEntity).end).toBe((l1 as LineEntity).p1);
    for (const a of [a1, a2]) {
      const curve = entityToCurves(sketch, a as ArcEntity)[0]!;
      expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI);
      expect(curve.type === "arc" && curve.radius).toBeCloseTo(5);
    }
  });

  it("tool registry", () => {
    const ids = SKETCH_CREATE_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SKETCH_CREATE_TOOLS.every((t) => t.group === "create")).toBe(true);
    expect(ids).toContain("slot");
  });
});
