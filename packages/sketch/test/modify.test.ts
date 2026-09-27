import { describe, expect, it } from "vitest";
import { type Vec2, curveEnd, curveStart, dist2, signedArea } from "@fabcad/geometry";
import {
  createArcCenter,
  createCircle,
  createLine,
  createPolyline,
  createRectangle2Point,
  createSlot,
} from "../src/create";
import { entityToCurves } from "../src/curves";
import { SketchBuilder, getPoint, listCurves } from "../src/edit";
import { measureDimension } from "../src/measure";
import type { ArcEntity, CircleEntity, LineEntity, Sketch } from "../src/model";
import {
  SKETCH_MODIFY_TOOLS,
  breakCurve,
  circularPattern,
  copyEntities,
  extendCurve,
  mirrorEntities,
  moveEntities,
  offsetEntities,
  rectangularPattern,
  scaleEntities,
  sketchChamfer,
  sketchFillet,
  toggleConstruction,
  trimCurve,
} from "../src/modify";
import { detectProfiles } from "../src/profiles";
import { build, constraintTypes, countTypes, v } from "./helpers";

const lineEnds = (s: Sketch, id: string): [Vec2, Vec2] => {
  const l = s.entities[id] as LineEntity;
  return [getPoint(s, l.p1), getPoint(s, l.p2)];
};

const expectPoint = (p: Vec2, x: number, y: number): void => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

/** Area of the polygon formed by a closed chain of lines given in order. */
const chainArea = (s: Sketch, ids: string[]): number =>
  signedArea(ids.map((id) => lineEnds(s, id)[0]));

describe("move / copy / scale", () => {
  it("moves shared points once and leaves the input untouched", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(10, 10)));
    const frozen = JSON.stringify(sketch);
    const moved = moveEntities(sketch, out.entities, v(5, 7));
    expect(JSON.stringify(sketch)).toBe(frozen);
    expectPoint(getPoint(moved, out.points[0]!), 5, 7);
    expectPoint(getPoint(moved, out.points[2]!), 15, 17);
    expect(countTypes(moved)).toEqual(countTypes(sketch));
  });

  it("copy duplicates points once and copies inner constraints", () => {
    const { sketch, out } = build((b) => {
      const rect = createRectangle2Point(b, v(0, 0), v(10, 10));
      const other = createLine(b, v(50, 50), v(60, 50));
      b.constrain("parallel", rect.entities[0]!, other.entities[0]!);
      b.dimension("distance", [rect.entities[0]!], "10");
      b.constrain("fix", rect.points[0]!);
      return rect;
    });
    const res = copyEntities(sketch, out.entities, v(100, 0));
    expect(res.created).toHaveLength(4);
    expect(countTypes(res.sketch)).toEqual({ point: 10, line: 9 });
    expect(constraintTypes(res.sketch)).toEqual({
      horizontal: 4,
      vertical: 4,
      parallel: 1,
      fix: 1,
    });
    expect(Object.keys(res.sketch.dimensions)).toHaveLength(2);
    const lines = res.created.map((id) => res.sketch.entities[id] as LineEntity);
    lines.forEach((l, i) => expect(l.p2).toBe(lines[(i + 1) % 4]!.p1));
    expect(res.map[out.entities[0]!]).toBe(res.created[0]);
    expectPoint(getPoint(res.sketch, res.map[out.points[2]!]!), 110, 10);
    expect(detectProfiles(res.sketch)).toHaveLength(2);
    expect(Object.keys(sketch.entities)).toHaveLength(11);
  });

  it("scale", () => {
    const { sketch, out } = build((b) => createCircle(b, v(10, 0), 5));
    const scaled = scaleEntities(sketch, out.entities, v(0, 0), 3);
    expect((scaled.entities[out.entities[0]!] as CircleEntity).radius).toBeCloseTo(15);
    expectPoint(getPoint(scaled, out.points[0]!), 30, 0);
  });

  it("toggle construction", () => {
    const { sketch, out } = build((b) => createLine(b, v(0, 0), v(1, 1)));
    const on = toggleConstruction(sketch, out.entities);
    expect(on.entities[out.entities[0]!]!.construction).toBe(true);
    expect(sketch.entities[out.entities[0]!]!.construction).toBeUndefined();
    const off = toggleConstruction(on, out.entities);
    expect(off.entities[out.entities[0]!]).toEqual(sketch.entities[out.entities[0]!]);
  });
});

describe("mirror", () => {
  it("mirrors an arc and keeps it CCW", () => {
    const { sketch, out } = build((b) => ({
      axis: createLine(b, v(0, -10), v(0, 10), true),
      arc: createArcCenter(b, v(10, 0), v(15, 0), v(10, 5)),
      line: createLine(b, v(5, 5), v(8, 9)),
    }));
    const res = mirrorEntities(
      sketch,
      [...out.arc.entities, ...out.line.entities, ...out.axis.entities],
      out.axis.entities[0]!,
      { symmetryConstraints: true },
    );
    expect(res.created).toHaveLength(2);
    const arc = res.sketch.entities[res.created[0]!] as ArcEntity;
    expectPoint(getPoint(res.sketch, arc.center), -10, 0);
    expectPoint(getPoint(res.sketch, arc.start), -10, 5);
    expectPoint(getPoint(res.sketch, arc.end), -15, 0);
    const curve = entityToCurves(res.sketch, arc)[0]!;
    expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI / 2);
    expect(constraintTypes(res.sketch)).toEqual({ symmetry: 5 });
    for (const c of Object.values(res.sketch.constraints)) {
      expect(c.refs[2]).toBe(out.axis.entities[0]);
    }
  });

  it("shares points on the axis so that half profiles close", () => {
    const { sketch, out } = build((b) => ({
      axis: createLine(b, v(0, 0), v(0, 10), true),
      half: createPolyline(b, [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], false),
    }));
    const res = mirrorEntities(sketch, out.half.entities, out.axis.entities[0]!);
    expect(res.map[out.half.points[0]!]).toBe(out.half.points[0]);
    const regions = detectProfiles(res.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(200);
  });
});

describe("patterns", () => {
  it("rectangular", () => {
    const { sketch, out } = build((b) => createCircle(b, v(0, 0), 2));
    const res = rectangularPattern(sketch, out.entities, {
      dx: v(10, 0),
      countX: 3,
      dy: v(0, 20),
      countY: 2,
    });
    expect(res.created).toHaveLength(5);
    expect(countTypes(res.sketch)).toEqual({ point: 6, circle: 6 });
    const centers = res.created.map((id) =>
      getPoint(res.sketch, (res.sketch.entities[id] as CircleEntity).center),
    );
    expect(centers).toEqual([v(10, 0), v(20, 0), v(0, 20), v(10, 20), v(20, 20)]);
    expect(
      rectangularPattern(sketch, out.entities, { dx: v(1, 0), countX: 4 }).created,
    ).toHaveLength(3);
  });

  it("circular", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(10, -1), v(20, 1)));
    const res = circularPattern(sketch, out.entities, { center: v(0, 0), count: 4 });
    expect(res.created).toHaveLength(12);
    const regions = detectProfiles(res.sketch);
    expect(regions).toHaveLength(4);
    for (const r of regions) expect(r.area).toBeCloseTo(20);
    // The 90° copy no longer has horizontal / vertical constraints, the 180° copy does.
    expect(constraintTypes(res.sketch)).toEqual({ horizontal: 4, vertical: 4 });
    const partial = circularPattern(sketch, out.entities, {
      center: v(0, 0),
      count: 3,
      totalAngle: Math.PI,
    });
    const last = partial.sketch.entities[partial.created[4]!] as LineEntity;
    expect(partial.created).toHaveLength(8);
    expectPoint(getPoint(partial.sketch, last.p1), -10, 1);
  });
});

describe("offset", () => {
  it("rectangle loop grows for positive and shrinks for negative distances", () => {
    for (const pts of [
      [v(0, 0), v(100, 0), v(100, 80), v(0, 80)],
      [v(0, 0), v(0, 80), v(100, 80), v(100, 0)], // drawn clockwise
    ]) {
      const { sketch, out } = build((b) => createPolyline(b, pts, true));
      const grown = offsetEntities(sketch, out.entities, 5);
      expect(grown.created).toHaveLength(4);
      expect(Math.abs(chainArea(grown.sketch, grown.created))).toBeCloseTo(110 * 90);
      expect(countTypes(grown.sketch)).toEqual({ point: 8, line: 8 });
      const shrunk = offsetEntities(sketch, out.entities, -5);
      expect(Math.abs(chainArea(shrunk.sketch, shrunk.created))).toBeCloseTo(90 * 70);
      const regions = detectProfiles(shrunk.sketch);
      expect(regions.map((r) => r.area)).toEqual(
        [6300, 8000 - 6300].map((a) => expect.closeTo(a, 6)),
      );
    }
  });

  it("slot loop with arcs", () => {
    const { sketch, out } = build((b) => createSlot(b, v(0, 0), v(40, 0), 10));
    const res = offsetEntities(sketch, out.entities.slice(0, 4), 2);
    expect(res.created).toHaveLength(4);
    const only = toggleConstruction(res.sketch, out.entities.slice(0, 4));
    const regions = detectProfiles(only);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(40 * 14 + Math.PI * 49, 6);
    expect(constraintTypes(res.sketch)).toMatchObject({ concentric: 2, parallel: 3 });
  });

  it("open chain and circle", () => {
    const { sketch, out } = build((b) => ({
      chain: createPolyline(b, [v(0, 0), v(10, 0), v(10, 10)], false),
      circle: createCircle(b, v(50, 50), 10),
    }));
    const res = offsetEntities(sketch, [...out.chain.entities, ...out.circle.entities], 2);
    expect(res.created).toHaveLength(3);
    const [circle, l1, l2] = res.created.map((id) => res.sketch.entities[id]!);
    expect((circle as CircleEntity).radius).toBeCloseTo(12);
    // Travelling +X then +Y: right of travel is −Y, then +X.
    const a = lineEnds(res.sketch, l1!.id);
    expectPoint(a[0], 0, -2);
    expectPoint(a[1], 12, -2);
    expect((l2 as LineEntity).p1).toBe((l1 as LineEntity).p2);
    expectPoint(lineEnds(res.sketch, l2!.id)[1], 12, 10);
    expect(() => offsetEntities(sketch, out.circle.entities, -10)).toThrow();
  });
});

describe("trim", () => {
  const crossing = (): { sketch: Sketch; rect: string[]; line: string } => {
    const { sketch, out } = build((b) => ({
      rect: createRectangle2Point(b, v(0, 0), v(100, 80)),
      line: createLine(b, v(-20, 40), v(120, 40)),
    }));
    return { sketch, rect: out.rect.entities, line: out.line.entities[0]! };
  };

  it("removes the middle of a line crossing a rectangle", () => {
    const { sketch, rect, line } = crossing();
    const res = trimCurve(sketch, line, v(50, 41));
    expect(countTypes(res)).toEqual({ point: 8, line: 6 });
    expect(constraintTypes(res)).toEqual({
      horizontal: 2,
      vertical: 2,
      coincident: 2,
      collinear: 1,
    });
    const [a, b] = lineEnds(res, line);
    expectPoint(a, -20, 40);
    expectPoint(b, 0, 40);
    const tail = listCurves(res).find((e) => !sketch.entities[e.id])!;
    expectPoint(lineEnds(res, tail.id)[0], 100, 40);
    expectPoint(lineEnds(res, tail.id)[1], 120, 40);
    const on = Object.values(res.constraints).filter((c) => c.type === "coincident");
    expect(on.map((c) => c.refs[1]).sort()).toEqual([rect[1]!, rect[3]!].sort());
    expect(detectProfiles(res)).toHaveLength(1);
    expect(Object.keys(sketch.entities)).toHaveLength(11);
  });

  it("removes an overhanging end", () => {
    const { sketch, line } = crossing();
    const res = trimCurve(sketch, line, v(-10, 40));
    expect(countTypes(res)).toEqual({ point: 6, line: 5 });
    expectPoint(lineEnds(res, line)[0], 0, 40);
    expectPoint(lineEnds(res, line)[1], 120, 40);
    expect(detectProfiles(res)).toHaveLength(2);
    const other = trimCurve(sketch, line, v(110, 40));
    expectPoint(lineEnds(other, line)[0], -20, 40);
    expectPoint(lineEnds(other, line)[1], 100, 40);
  });

  it("trims a rectangle edge between crossing lines and drops its length dimension", () => {
    const { sketch, out } = build((b) => {
      const rect = createRectangle2Point(b, v(0, 0), v(100, 80));
      createLine(b, v(30, -10), v(30, 10));
      createLine(b, v(60, -10), v(60, 10));
      b.dimension("distance", [rect.entities[0]!], "100");
      return rect;
    });
    const res = trimCurve(sketch, out.entities[0]!, v(45, 0));
    expect(Object.keys(res.dimensions)).toHaveLength(0);
    expectPoint(lineEnds(res, out.entities[0]!)[1], 30, 0);
    expect((res.entities[out.entities[0]!] as LineEntity).p1).toBe(out.points[0]);
    expect(detectProfiles(res)).toHaveLength(0);
  });

  it("deletes a curve without intersections", () => {
    const { sketch, out } = build((b) => ({
      l: createLine(b, v(0, 0), v(10, 0)),
      c: createCircle(b, v(50, 50), 5),
    }));
    expect(countTypes(trimCurve(sketch, out.l.entities[0]!, v(5, 0)))).toEqual({
      point: 1,
      circle: 1,
    });
    expect(countTypes(trimCurve(sketch, out.c.entities[0]!, v(55, 50)))).toEqual({
      point: 2,
      line: 1,
    });
  });

  it("turns a circle into an arc", () => {
    const { sketch, out } = build((b) => {
      const c = createCircle(b, v(0, 0), 10);
      const l = createLine(b, v(-20, 0), v(20, 0));
      b.dimension("radius", [c.entities[0]!], "10");
      return { c, l };
    });
    const res = trimCurve(sketch, out.c.entities[0]!, v(0, 10));
    expect(countTypes(res)).toEqual({ point: 5, line: 1, arc: 1 });
    const arc = Object.values(res.entities).find((e): e is ArcEntity => e.type === "arc")!;
    expect(arc.center).toBe(out.c.points[0]);
    expectPoint(getPoint(res, arc.start), -10, 0);
    expectPoint(getPoint(res, arc.end), 10, 0);
    const dims = Object.values(res.dimensions);
    expect(dims).toHaveLength(1);
    expect(dims[0]!.refs).toEqual([arc.id]);
    expect(measureDimension(res, dims[0]!)).toBeCloseTo(10);
    expect(constraintTypes(res)).toEqual({ coincident: 2 });
    const regions = detectProfiles(res);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 50);
    const upper = trimCurve(sketch, out.c.entities[0]!, v(0, -10));
    const kept = Object.values(upper.entities).find((e): e is ArcEntity => e.type === "arc")!;
    expectPoint(getPoint(upper, kept.start), 10, 0);
    expectPoint(getPoint(upper, kept.end), -10, 0);
  });

  it("trims an arc", () => {
    const { sketch, out } = build((b) => ({
      arc: createArcCenter(b, v(0, 0), v(10, 0), v(-10, 0)),
      l: createLine(b, v(0, 0), v(0, 20)),
    }));
    const res = trimCurve(sketch, out.arc.entities[0]!, v(-7, 7));
    const arc = res.entities[out.arc.entities[0]!] as ArcEntity;
    expect(arc.start).toBe(out.arc.points[1]);
    expectPoint(getPoint(res, arc.end), 0, 10);
    expect(res.entities[out.arc.points[2]!]).toBeUndefined();
  });
});

describe("extend / break", () => {
  it("extends a line to the next curve", () => {
    const { sketch, out } = build((b) => ({
      l: createLine(b, v(0, 0), v(10, 0)),
      wall: createLine(b, v(30, -10), v(30, 10)),
      far: createLine(b, v(50, -10), v(50, 10)),
    }));
    const res = extendCurve(sketch, out.l.entities[0]!, v(9, 1));
    expectPoint(lineEnds(res, out.l.entities[0]!)[1], 30, 0);
    expectPoint(lineEnds(res, out.l.entities[0]!)[0], 0, 0);
    expect(Object.values(res.constraints)).toMatchObject([
      { type: "coincident", refs: [out.l.points[1], out.wall.entities[0]] },
    ]);
    expect(extendCurve(sketch, out.l.entities[0]!, v(1, 1))).toBe(sketch);
  });

  it("does not drag along curves sharing the end point", () => {
    const { sketch, out } = build((b) => ({
      chain: createPolyline(b, [v(0, 5), v(0, 0), v(10, 0)], false),
      wall: createLine(b, v(30, -10), v(30, 10)),
    }));
    const swapped = extendCurve(sketch, out.chain.entities[0]!, v(0, 4.5));
    expect(swapped).toBe(sketch);
    const { sketch: s2, out: o2 } = build((b) => ({
      chain: createPolyline(b, [v(0, 0), v(10, 0), v(10, 5)], false),
      wall: createLine(b, v(30, -10), v(30, 10)),
    }));
    const res = extendCurve(s2, o2.chain.entities[0]!, v(10, 0));
    expectPoint(getPoint(res, o2.chain.points[1]!), 10, 0);
    expectPoint(lineEnds(res, o2.chain.entities[0]!)[1], 30, 0);
    expectPoint(lineEnds(res, o2.chain.entities[1]!)[0], 10, 0);
  });

  it("extends an arc along its circle", () => {
    const { sketch, out } = build((b) => ({
      arc: createArcCenter(b, v(0, 0), v(10, 0), v(0, 10)),
      l: createLine(b, v(-20, 0), v(-5, 0)),
      below: createLine(b, v(0, -5), v(0, -20)),
    }));
    const res = extendCurve(sketch, out.arc.entities[0]!, v(0, 10));
    const arc = res.entities[out.arc.entities[0]!] as ArcEntity;
    expectPoint(getPoint(res, arc.end), -10, 0);
    expectPoint(getPoint(res, arc.start), 10, 0);
    const back = extendCurve(sketch, out.arc.entities[0]!, v(10, 0));
    expectPoint(getPoint(back, (back.entities[arc.id] as ArcEntity).start), 0, -10);
  });

  it("breaks a line and moves point-on-line constraints", () => {
    const { sketch, out } = build((b) => {
      const l = createLine(b, v(0, 0), v(10, 0));
      const p = b.point(8, 0);
      b.constrain("coincident", p, l.entities[0]!);
      b.constrain("horizontal", l.entities[0]!);
      return { l, p };
    });
    const res = breakCurve(sketch, out.l.entities[0]!, v(4, 3));
    expect(res.created).toHaveLength(1);
    const first = res.sketch.entities[out.l.entities[0]!] as LineEntity;
    const second = res.sketch.entities[res.created[0]!] as LineEntity;
    expect(first.p2).toBe(second.p1);
    expectPoint(getPoint(res.sketch, first.p2), 4, 0);
    expect(second.p2).toBe(out.l.points[1]);
    expect(constraintTypes(res.sketch)).toEqual({ coincident: 1, horizontal: 1, collinear: 1 });
    const on = Object.values(res.sketch.constraints).find((c) => c.type === "coincident")!;
    expect(on.refs).toEqual([out.p, second.id]);
    expect(breakCurve(sketch, out.l.entities[0]!, v(-5, 0)).created).toEqual([]);
  });

  it("breaks an arc and a circle", () => {
    const { sketch, out } = build((b) => ({
      arc: createArcCenter(b, v(0, 0), v(10, 0), v(-10, 0)),
      c: createCircle(b, v(100, 0), 10),
    }));
    const a = breakCurve(sketch, out.arc.entities[0]!, v(0, 30));
    const first = a.sketch.entities[out.arc.entities[0]!] as ArcEntity;
    const second = a.sketch.entities[a.created[0]!] as ArcEntity;
    expect(first.end).toBe(second.start);
    expect(second.center).toBe(first.center);
    expectPoint(getPoint(a.sketch, first.end), 0, 10);

    const c = breakCurve(sketch, out.c.entities[0]!, v(100, 30));
    expect(c.created).toHaveLength(2);
    expect(c.sketch.entities[out.c.entities[0]!]).toBeUndefined();
    const arcs = c.created.map((id) => c.sketch.entities[id] as ArcEntity);
    expect(arcs[0]!.end).toBe(arcs[1]!.start);
    expect(arcs[1]!.end).toBe(arcs[0]!.start);
    const total = arcs.reduce((sum, arc) => {
      const curve = entityToCurves(c.sketch, arc)[0]!;
      expect(dist2(curveStart(curve), curveEnd(curve))).toBeCloseTo(20);
      return sum + (curve.type === "arc" ? curve.sweep : 0);
    }, 0);
    expect(total).toBeCloseTo(2 * Math.PI);
    const regions = detectProfiles(c.sketch).filter((r) => r.entityIds.includes(arcs[0]!.id));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 100);
  });
});

describe("fillet / chamfer", () => {
  it("fillets a rectangle corner", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(100, 80)));
    const res = sketchFillet(sketch, out.entities[0]!, out.entities[1]!, 10);
    expect(res.created).toHaveLength(1);
    expect(countTypes(res.sketch)).toEqual({ point: 6, line: 4, arc: 1 });
    expect(res.sketch.entities[out.points[1]!]).toBeUndefined();
    expect(constraintTypes(res.sketch)).toEqual({ horizontal: 2, vertical: 2, tangent: 2 });
    const arc = res.sketch.entities[res.created[0]!] as ArcEntity;
    expectPoint(getPoint(res.sketch, arc.center), 90, 10);
    expectPoint(getPoint(res.sketch, arc.start), 90, 0);
    expectPoint(getPoint(res.sketch, arc.end), 100, 10);
    expect((res.sketch.entities[out.entities[0]!] as LineEntity).p2).toBe(arc.start);
    expect((res.sketch.entities[out.entities[1]!] as LineEntity).p1).toBe(arc.end);
    const regions = detectProfiles(res.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(8000 - (100 - Math.PI * 25), 6);
    // Same result with the lines given in the other order and for a clockwise corner.
    const other = sketchFillet(sketch, out.entities[1]!, out.entities[0]!, 10);
    expect(detectProfiles(other.sketch)[0]!.area).toBeCloseTo(regions[0]!.area, 6);
    expect(() => sketchFillet(sketch, out.entities[0]!, out.entities[1]!, 90)).toThrow();
    expect(() => sketchFillet(sketch, out.entities[0]!, out.entities[2]!, 5)).toThrow();
  });

  it("fillets lines whose end points only coincide, at an acute angle", () => {
    const { sketch, out } = build((b) => ({
      a: createLine(b, v(0, 0), v(50, 0)),
      b: createLine(b, v(30, 30), v(0, 0)),
    }));
    const res = sketchFillet(sketch, out.a.entities[0]!, out.b.entities[0]!, 5);
    const arc = res.sketch.entities[res.created[0]!] as ArcEntity;
    const c = getPoint(res.sketch, arc.center);
    expect(dist2(c, getPoint(res.sketch, arc.start))).toBeCloseTo(5);
    expect(dist2(c, getPoint(res.sketch, arc.end))).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
    const curve = entityToCurves(res.sketch, arc)[0]!;
    expect(curve.type === "arc" && curve.sweep).toBeCloseTo((Math.PI * 3) / 4);
    expect(countTypes(res.sketch)).toEqual({ point: 5, line: 2, arc: 1 });
  });

  it("keeps length dimensions attached to the original corner", () => {
    const { sketch, out } = build((b) => {
      const rect = createRectangle2Point(b, v(0, 0), v(100, 80));
      b.dimension("distance", [rect.entities[0]!], "100");
      return rect;
    });
    const res = sketchFillet(sketch, out.entities[0]!, out.entities[1]!, 10);
    const dim = Object.values(res.sketch.dimensions)[0]!;
    expect(dim.id).toBe(Object.keys(sketch.dimensions)[0]);
    expect(dim.refs).toEqual([out.points[0], out.points[1]]);
    expect(measureDimension(res.sketch, dim)).toBeCloseTo(100);
    expect(res.sketch.entities[out.points[1]!]).toBeDefined();
    expect(constraintTypes(res.sketch).coincident).toBe(1);
  });

  it("chamfers a corner", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(100, 80)));
    const res = sketchChamfer(sketch, out.entities[1]!, out.entities[2]!, 10);
    expect(countTypes(res.sketch)).toEqual({ point: 5, line: 5 });
    const [a, b] = lineEnds(res.sketch, res.created[0]!);
    expectPoint(a, 100, 70);
    expectPoint(b, 90, 80);
    const regions = detectProfiles(res.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(8000 - 50, 6);
    expect(regions[0]!.entityIds).toHaveLength(5);
  });
});

describe("registry", () => {
  it("lists the modify tools", () => {
    const ids = SKETCH_MODIFY_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SKETCH_MODIFY_TOOLS.every((t) => t.group === "modify")).toBe(true);
    expect(new SketchBuilder(build(() => 0).sketch).current.nextId).toBe(1);
  });
});
