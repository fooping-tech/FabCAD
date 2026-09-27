import { describe, expect, it } from "vitest";
import {
  type Curve2,
  ORIGIN_PLANES,
  arcThroughPoints,
  closestParam,
  controlSplineToBeziers,
  curveEnd,
  curveLength,
  curvePointAt,
  curveStart,
  dist2,
  edgeInteriorAngle,
  fitSplineToBeziers,
  flattenCurve,
  interiorAngle,
  intersectCurves,
  makePlane,
  meshToTopology,
  offsetPolygon,
  offsetPolygonEdges,
  planeToWorld,
  pointInPolygon,
  polygonsOverlap,
  prismTopology,
  reverseCurve,
  signedArea,
  subCurve,
  worldToPlane,
} from "../src";

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("polygons", () => {
  it("measures area and containment", () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea(square.slice().reverse())).toBe(-100);
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it("offsets uniformly and per edge", () => {
    const shrunk = offsetPolygon(square, 1);
    expect(signedArea(shrunk.polygon)).toBeCloseTo(64);
    expect(shrunk.collapsedEdges).toEqual([]);
    // Clockwise input shrinks as well for positive offsets.
    expect(Math.abs(signedArea(offsetPolygon(square.slice().reverse(), 1).polygon))).toBeCloseTo(64);
    const grown = offsetPolygon(square, -0.5);
    expect(signedArea(grown.polygon)).toBeCloseTo(121);
    const one = offsetPolygonEdges(square, [2, 0, 0, 0]);
    expect(signedArea(one.polygon)).toBeCloseTo(80);
    expect(offsetPolygon(square, 6).collapsedEdges.length).toBeGreaterThan(0);
  });

  it("reports interior angles independent of winding", () => {
    const l = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(interiorAngle(l, 0)).toBeCloseTo(Math.PI / 2);
    expect(interiorAngle(l, 3)).toBeCloseTo((3 * Math.PI) / 2);
    const cw = l.slice().reverse();
    expect(interiorAngle(cw, cw.indexOf(l[3]!))).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("detects overlapping polygons", () => {
    const moved = square.map((p) => ({ x: p.x + 5, y: p.y + 5 }));
    const apart = square.map((p) => ({ x: p.x + 20, y: p.y }));
    const inner = square.map((p) => ({ x: 4 + p.x / 10, y: 4 + p.y / 10 }));
    expect(polygonsOverlap(square, moved)).toBe(true);
    expect(polygonsOverlap(square, apart)).toBe(false);
    expect(polygonsOverlap(square, inner)).toBe(true);
  });
});

describe("curves", () => {
  const arc: Curve2 = { type: "arc", center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI };
  const line: Curve2 = { type: "line", a: { x: -20, y: 5 }, b: { x: 20, y: 5 } };

  it("evaluates, reverses and splits", () => {
    expect(curveStart(arc)).toEqual({ x: 10, y: 0 });
    expect(curveEnd(arc).x).toBeCloseTo(-10);
    expect(curveLength(arc)).toBeCloseTo(Math.PI * 10);
    const r = reverseCurve(arc);
    expect(curveStart(r).x).toBeCloseTo(-10);
    expect(curvePointAt(r, 0.5).y).toBeCloseTo(10);
    const part = subCurve(arc, 0.25, 0.75);
    expect(curveLength(part)).toBeCloseTo((Math.PI * 10) / 2);
    expect(curveStart(part).x).toBeCloseTo(10 * Math.cos(Math.PI / 4));
  });

  it("intersects lines, arcs and splines", () => {
    const hits = intersectCurves(line, arc);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.point.y).toBeCloseTo(5);
      expect(Math.hypot(h.point.x, h.point.y)).toBeCloseTo(10);
      expect(dist2(curvePointAt(line, h.ta), h.point)).toBeLessThan(1e-9);
      expect(dist2(curvePointAt(arc, h.tb), h.point)).toBeLessThan(1e-9);
    }
    // The lower half of the circle is not part of the arc.
    const low: Curve2 = { type: "line", a: { x: -20, y: -5 }, b: { x: 20, y: -5 } };
    expect(intersectCurves(low, arc)).toHaveLength(0);

    const other: Curve2 = { type: "arc", center: { x: 10, y: 0 }, radius: 10, startAngle: 0, sweep: 2 * Math.PI };
    const aa = intersectCurves(arc, other);
    expect(aa).toHaveLength(1);
    expect(aa[0]!.point.x).toBeCloseTo(5);
    expect(aa[0]!.point.y).toBeCloseTo(Math.sqrt(75));

    const bezier = fitSplineToBeziers([
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]);
    const cut: Curve2 = { type: "line", a: { x: 0, y: -5 }, b: { x: 0, y: 20 } };
    const sb = bezier.flatMap((b) => intersectCurves(cut, b));
    expect(sb.length).toBeGreaterThanOrEqual(1);
    expect(sb[0]!.point.x).toBeCloseTo(0, 6);
    expect(sb[0]!.point.y).toBeCloseTo(10, 6);
  });

  it("builds arcs through three points and finds closest parameters", () => {
    const a = arcThroughPoints({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 })!;
    expect(a.center.x).toBeCloseTo(0);
    expect(a.radius).toBeCloseTo(10);
    expect(a.sweep).toBeCloseTo(Math.PI);
    const cw = arcThroughPoints({ x: 10, y: 0 }, { x: 0, y: -10 }, { x: -10, y: 0 })!;
    expect(cw.sweep).toBeCloseTo(-Math.PI);
    expect(arcThroughPoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(closestParam(arc, { x: 0, y: 30 })).toBeCloseTo(0.5);
    expect(closestParam(line, { x: 0, y: 0 })).toBeCloseTo(0.5);
  });

  it("flattens within tolerance and converts splines", () => {
    const pts = flattenCurve(arc, 0.01);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
    expect(pts.length).toBeGreaterThan(20);
    const control = controlSplineToBeziers([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: -20 },
      { x: 30, y: 20 },
      { x: 40, y: 0 },
    ]);
    expect(control).toHaveLength(2);
    expect(control[0]!.p0).toEqual({ x: 0, y: 0 });
    expect(control[1]!.p3.x).toBeCloseTo(40);
    expect(dist2(control[0]!.p3, control[1]!.p0)).toBeLessThan(1e-9);
  });
});

describe("planes", () => {
  it("round-trips coordinates and stays right-handed", () => {
    for (const plane of Object.values(ORIGIN_PLANES)) {
      const w = planeToWorld(plane, { x: 3, y: 4 });
      expect(worldToPlane(plane, w)).toEqual({ x: 3, y: 4 });
    }
    const p = makePlane({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 2 }, { x: 1, y: 1, z: 5 });
    expect(p.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(p.xDir.x).toBeCloseTo(Math.SQRT1_2);
    expect(p.yDir.x).toBeCloseTo(-Math.SQRT1_2);
    expect(p.yDir.y).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("polyhedral topology", () => {
  it("describes a prism with dihedral angles", () => {
    const t = prismTopology(square, 5);
    expect(t.faces).toHaveLength(6);
    expect(t.edges).toHaveLength(12);
    expect(t.edges.every((e) => e.faces.length === 2)).toBe(true);
    for (const e of t.edges) expect(edgeInteriorAngle(t, e)).toBeCloseTo(Math.PI / 2);

    const l = prismTopology(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      5,
    );
    const angles = l.edges.map((e) => Math.round(((edgeInteriorAngle(l, e) ?? 0) * 180) / Math.PI));
    expect(angles.filter((a) => a === 270)).toHaveLength(1);
    expect(angles.filter((a) => a === 90)).toHaveLength(17);
  });

  it("rebuilds faces from a triangle mesh, whatever its winding", () => {
    // A box as 12 triangles, grouped per face, with duplicated vertices as a kernel produces.
    const corners = [
      [0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0],
      [0, 0, 2], [4, 0, 2], [4, 3, 2], [0, 3, 2],
    ];
    const quads = [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
      [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ];
    for (const flip of [false, true]) {
      const positions: number[] = [];
      const indices: number[] = [];
      const faceGroups = quads.map((q, i) => {
        const base = positions.length / 3;
        for (const c of q) positions.push(...corners[c]!);
        const tris = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
        const start = indices.length;
        for (const k of tris) indices.push(base + k);
        return { faceIndex: i, start, count: 6, surface: "plane" as const };
      });
      const t = meshToTopology({ positions, indices, faceGroups });
      expect(t.vertices).toHaveLength(8);
      expect(t.faces).toHaveLength(6);
      expect(t.edges).toHaveLength(12);
      expect(t.faces.every((f) => f.loops.length === 1 && f.loops[0]!.length === 4)).toBe(true);
      // Normals point outwards.
      for (const f of t.faces) {
        const v = t.vertices[f.loops[0]![0]!]!;
        const out = (v.x - 2) * f.normal.x + (v.y - 1.5) * f.normal.y + (v.z - 1) * f.normal.z;
        expect(out).toBeGreaterThan(0);
      }
      for (const e of t.edges) expect(edgeInteriorAngle(t, e)).toBeCloseTo(Math.PI / 2);
    }
  });
});
