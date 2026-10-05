import { describe, expect, it } from "vitest";
import { ORIGIN_PLANES, type Vec3 } from "@fabcad/geometry";
import { createSketch } from "../src/model";
import { detectProfiles } from "../src/profiles";
import { editSketch } from "../src/edit";
import {
  addProjection,
  projectCurve,
  projectPolyline,
  projectedEntityIds,
  projectedShapes,
  sameProjectedShape,
  updateProjection,
} from "../src/project";

const XY = ORIGIN_PLANES.XY;
const circle3d = (r: number, z: number, from = 0, to = 2 * Math.PI, n = 48): Vec3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: 10 + r * Math.cos(a), y: 5 + r * Math.sin(a), z };
  });

describe("projectPolyline", () => {
  it("recognises lines, points, circles, arcs and free curves", () => {
    expect(projectPolyline(XY, [{ x: 0, y: 0, z: 30 }, { x: 40, y: 10, z: 30 }])).toEqual({
      type: "line",
      a: { x: 0, y: 0 },
      b: { x: 40, y: 10 },
    });
    // An edge perpendicular to the plane collapses into a point.
    expect(projectPolyline(XY, [{ x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 30 }])).toEqual({
      type: "point",
      at: { x: 3, y: 4 },
    });
    const c = projectPolyline(XY, circle3d(8, 12));
    expect(c).toMatchObject({ type: "circle" });
    if (c?.type === "circle") {
      expect(c.center.x).toBeCloseTo(10);
      expect(c.center.y).toBeCloseTo(5);
      expect(c.radius).toBeCloseTo(8);
    }
    // Arcs are stored counter-clockwise whatever the direction of the source edge.
    for (const pts of [circle3d(8, 0, 0, Math.PI / 2), circle3d(8, 0, 0, Math.PI / 2).reverse()]) {
      const a = projectPolyline(XY, pts);
      expect(a).toMatchObject({ type: "arc" });
      if (a?.type === "arc") {
        expect(a.start.x).toBeCloseTo(18);
        expect(a.end.y).toBeCloseTo(13);
      }
    }
    // A circle seen at an angle is an ellipse: kept as a closed spline.
    const tilted = circle3d(8, 0).map((p) => ({ x: p.x, y: p.y * 0.5, z: p.y }));
    expect(projectPolyline(XY, tilted)).toMatchObject({ type: "spline", closed: true });
    // A circle seen edge-on is a line as long as its diameter.
    const edgeOn = projectPolyline(ORIGIN_PLANES.XZ, circle3d(8, 3));
    expect(edgeOn).toMatchObject({ type: "line" });
    if (edgeOn?.type === "line") expect(Math.abs(edgeOn.b.x - edgeOn.a.x)).toBeCloseTo(16);
  });
});

describe("projections in a sketch", () => {
  const base = createSketch("s", "Sketch", { type: "origin", plane: "XY" });
  const line = projectPolyline(XY, [{ x: 0, y: 0, z: 30 }, { x: 40, y: 0, z: 30 }])!;
  const source = { bodyId: "body-1", source: "edge" as const, hint: { x: 20, y: 0, z: 30 } };

  it("adds entities once and lists them as projected", () => {
    const first = addProjection(base, line, source)!;
    expect(Object.values(first.sketch.entities).map((e) => e.type).sort()).toEqual([
      "line",
      "point",
      "point",
    ]);
    expect(first.sketch.projections).toHaveLength(1);
    expect(projectedEntityIds(first.sketch).size).toBe(3);
    expect(addProjection(first.sketch, line, source)).toBeNull();
    expect(base.projections).toHaveLength(0);
  });

  it("follows the source and reports when nothing moved", () => {
    const { sketch, ref } = addProjection(base, line, source)!;
    expect(updateProjection(sketch, ref, line, source.hint)).toBe(sketch);
    const longer = projectPolyline(XY, [{ x: 0, y: 0, z: 30 }, { x: 60, y: 0, z: 30 }])!;
    const moved = updateProjection(sketch, ref, longer, { x: 30, y: 0, z: 30 })!;
    const xs = Object.values(moved.entities).flatMap((e) => (e.type === "point" ? [e.x] : []));
    expect(xs.sort((a, b) => a - b)).toEqual([0, 60]);
    expect(moved.projections[0]!.hint.x).toBe(30);
    // A different kind of shape cannot be mapped onto the existing entities.
    expect(updateProjection(sketch, ref, projectPolyline(XY, circle3d(5, 0))!, source.hint)).toBeNull();
  });

  it("releases a projection when its geometry is deleted", () => {
    const { sketch, ref } = addProjection(base, line, source)!;
    const lineId = ref.entityIds.find((id) => sketch.entities[id]!.type === "line")!;
    const after = editSketch(sketch, (b) => b.remove([lineId]));
    expect(after.projections).toHaveLength(0);
    expect(Object.keys(after.entities)).toHaveLength(0);
  });
});

describe("projected shapes", () => {
  it("tells when a new projection would lie on top of an existing one", () => {
    const base = createSketch("s", "Sketch", { type: "origin", plane: "XY" });
    const line = projectPolyline(XY, [{ x: 0, y: 0, z: 30 }, { x: 0, y: 30, z: 30 }])!;
    const { sketch } = addProjection(base, line, { bodyId: "b", source: "edge", hint: { x: 20, y: 15, z: 0 } })!;
    const shapes = projectedShapes(sketch);
    expect(shapes).toHaveLength(1);
    // The other seam of a cylinder seen from the side: another edge, the same line, reversed.
    const seam = projectPolyline(XY, [{ x: 0, y: 30, z: -5 }, { x: 0, y: 0, z: -5 }])!;
    expect(sameProjectedShape(shapes[0]!, seam)).toBe(true);
    const beside = projectPolyline(XY, [{ x: 1, y: 0, z: 0 }, { x: 1, y: 30, z: 0 }])!;
    expect(sameProjectedShape(shapes[0]!, beside)).toBe(false);
    expect(sameProjectedShape(shapes[0]!, projectPolyline(XY, circle3d(5, 0))!)).toBe(false);
  });
});

describe("projectCurve", () => {
  const poles = [
    { x: 0, y: 0, z: 7 },
    { x: 10, y: 0.1, z: 7 },
    { x: 20, y: 0.1, z: 7 },
    { x: 30, y: 0, z: 7 },
  ];
  // A nearly straight span tessellated with two points looks like a line.
  const samples = [poles[0]!, poles[3]!];

  it("keeps a Bézier edge as the Bézier of its projected control points", () => {
    expect(projectPolyline(XY, samples)).toMatchObject({ type: "line" });
    expect(projectCurve(XY, samples, poles)).toEqual({
      type: "spline",
      kind: "control",
      points: poles.map((p) => ({ x: p.x, y: p.y })),
      closed: false,
    });
  });

  it("raises a quadratic to a cubic, and falls back to the samples when seen edge-on", () => {
    const quad = projectCurve(XY, samples, [poles[0]!, { x: 15, y: 6, z: 7 }, poles[3]!]);
    expect(quad).toMatchObject({ type: "spline", kind: "control" });
    if (quad?.type === "spline") expect(quad.points[1]).toEqual({ x: 10, y: 4 });
    const edgeOn = projectCurve(ORIGIN_PLANES.XZ, [poles[0]!, poles[3]!], poles);
    expect(edgeOn).toMatchObject({ type: "line" });
  });
});

describe("projectCurve with the exact edge", () => {
  // Single-precision samples of a circle about the origin are a little off.
  const noisy = (r: number, from: number, to: number): Vec3[] =>
    Array.from({ length: 49 }, (_, i) => {
      const a = from + ((to - from) * i) / 48;
      return { x: Math.fround(r * Math.cos(a)) + 2e-6, y: Math.fround(r * Math.sin(a)) - 2e-6, z: 10 };
    });

  it("takes the center and radius of a circle from the B-Rep", () => {
    const exact = {
      curve: "circle" as const,
      from: { x: 55, y: 0, z: 10 },
      to: { x: 55, y: 0, z: 10 },
      center: { x: 1e-15, y: -1e-15, z: 10 },
      radius: 55,
    };
    expect(projectCurve(XY, noisy(55, 0, 2 * Math.PI), undefined, exact)).toEqual({
      type: "circle",
      center: { x: 0, y: 0 },
      radius: 55,
    });
  });

  it("takes the ends of arcs and lines from the B-Rep, so that neighbours meet exactly", () => {
    const end = { x: 0, y: 30, z: 10 };
    const arc = projectCurve(XY, noisy(30, 0, Math.PI / 2), undefined, {
      curve: "circle",
      from: { x: 30, y: 0, z: 10 },
      to: end,
      center: { x: 0, y: 0, z: 10 },
      radius: 30,
    });
    expect(arc).toEqual({ type: "arc", center: v0, start: { x: 30, y: 0 }, end: { x: 0, y: 30 } });
    const line = projectCurve(
      XY,
      [
        { x: 2e-6, y: 30.00001, z: 10 },
        { x: -20, y: 30, z: 10 },
      ],
      undefined,
      { curve: "line", from: end, to: { x: -20, y: 30, z: 10 } },
    );
    expect(line).toEqual({ type: "line", a: { x: 0, y: 30 }, b: { x: -20, y: 30 } });
  });

  it("takes the exact circle for a short arc whose fitted center is off", () => {
    // 6° of a 38.5 mm circle away from the origin, sampled coarsely and in single precision:
    // the circle through three of the samples misses the center by micrometres.
    const c = { x: 7.33108, y: -7 };
    const r = 38.5;
    const samples: Vec3[] = Array.from({ length: 4 }, (_, i) => {
      const a = 1 + (0.1 * i) / 3;
      const wobble = i === 1 ? 4e-6 : i === 2 ? -4e-6 : 0;
      return {
        x: Math.fround(c.x + (r + wobble) * Math.cos(a)),
        y: Math.fround(c.y + (r + wobble) * Math.sin(a)),
        z: 10,
      };
    });
    const at = (a: number): Vec3 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), z: 10 });
    const exact = { curve: "circle" as const, from: at(1), to: at(1.1), center: { ...c, z: 10 }, radius: r };
    const fitted = projectCurve(XY, samples);
    expect(fitted?.type).toBe("arc");
    expect(Math.hypot((fitted as any).center.x - c.x, (fitted as any).center.y - c.y)).toBeGreaterThan(1e-3);
    const shape = projectCurve(XY, samples, undefined, exact);
    const end = (a: number) => ({ x: Math.round((c.x + r * Math.cos(a)) * 1e9) / 1e9, y: Math.round((c.y + r * Math.sin(a)) * 1e9) / 1e9 });
    expect(shape).toEqual({ type: "arc", center: c, start: end(1), end: end(1.1) });
  });

  it("keeps a projected vertex where the B-Rep has it, finer than the samples", () => {
    const v = { x: 40.831077088, y: -23.328422305, z: 10 };
    expect(projectCurve(XY, [v], undefined, { curve: "other", from: v, to: v })).toEqual({
      type: "point",
      at: { x: 40.831077088, y: -23.328422305 },
    });
  });

  it("ends a circle seen edge-on at its exact extremes", () => {
    // A circle of radius 7.3 standing upright in the XZ plane, sampled 0.15 rad apart.
    const c = { x: 12.345678, y: 3.21, z: 5 };
    const r = 7.3;
    const samples: Vec3[] = Array.from({ length: 42 }, (_, i) => {
      const a = 0.07 + i * 0.15;
      return { x: Math.fround(c.x + r * Math.cos(a)), y: Math.fround(c.y), z: Math.fround(c.z + r * Math.sin(a)) };
    });
    const start = { x: c.x + r * Math.cos(0.07), y: c.y, z: c.z + r * Math.sin(0.07) };
    const shape = projectCurve(XY, samples, undefined, {
      curve: "circle",
      from: start,
      to: start,
      center: c,
      radius: r,
      axis: { x: 0, y: 1, z: 0 },
    });
    expect(shape?.type).toBe("line");
    const ends = shape?.type === "line" ? [shape.a.x, shape.b.x].sort((p, q) => p - q) : [];
    expect(ends).toEqual([5.045678, 19.645678]);
  });

  it("ends an upright arc at its own ends or at the circle's extreme it passes", () => {
    const c = { x: 12.345678, y: 3.21, z: 5 };
    const r = 7.3;
    const on = (a: number): Vec3 => ({ x: c.x + r * Math.cos(a), y: c.y, z: c.z + r * Math.sin(a) });
    const arc = (from: number, to: number) => {
      const samples = Array.from({ length: 13 }, (_, i) => {
        const p = on(from + ((to - from) * i) / 12);
        return { x: Math.fround(p.x), y: Math.fround(p.y), z: Math.fround(p.z) };
      });
      const shape = projectCurve(XY, samples, undefined, {
        curve: "circle",
        from: on(from),
        to: on(to),
        center: c,
        radius: r,
        axis: { x: 0, y: -1, z: 0 },
      });
      return shape?.type === "line" ? [shape.a.x, shape.b.x].sort((p, q) => p - q) : [];
    };
    const x = (a: number): number => Math.round((c.x + r * Math.cos(a)) * 1e9) / 1e9;
    // Not through the extreme at angle 0: the ends of the arc.
    expect(arc(0.2, 1.5)).toEqual([x(1.5), x(0.2)]);
    // Through it, either way round.
    expect(arc(-0.5, 1)).toEqual([x(1), 19.645678]);
    expect(arc(1, -0.5)).toEqual([x(1), 19.645678]);
  });

  it("projects a tilted circle, an ellipse on the sketch, as a chain within 1e-6 mm", () => {
    // Turned 60° about the x axis: seen from above it is an ellipse with half axes 8 and 4.
    const tilted = circle3d(8, 0).map((p) => ({ x: p.x, y: 5 + (p.y - 5) * 0.5, z: 5 + (p.y - 5) * Math.sin(Math.PI / 3) }));
    const shape = projectCurve(XY, tilted, undefined, {
      curve: "circle",
      from: tilted[0]!,
      to: tilted[0]!,
      center: { x: 10, y: 5, z: 5 },
      radius: 8,
      axis: { x: 0, y: -Math.sin(Math.PI / 3), z: 0.5 },
    });
    expect(shape?.type).toBe("chain");
    const pts = shape?.type === "chain" ? shape.points : [];
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    for (let i = 0; i + 3 < pts.length; i += 3) {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const s = 1 - t;
        const w = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
        const x = w.reduce((m, wk, k) => m + wk * pts[i + k]!.x, 0);
        const y = w.reduce((m, wk, k) => m + wk * pts[i + k]!.y, 0);
        // Distance to the ellipse, to first order.
        const g = Math.hypot((2 * (x - 10)) / 64, (2 * (y - 5)) / 16);
        expect(Math.abs(((x - 10) / 8) ** 2 + ((y - 5) / 4) ** 2 - 1) / g).toBeLessThan(1e-6);
      }
    }
  });
});

const v0 = { x: 0, y: 0 };

describe("chains of cubic Béziers", () => {
  // A circle of radius 10 about (3, 4), tilted 60° about the x axis, as 8 Hermite spans.
  const tilted = (u: number): Vec3 => ({ x: 3 + 10 * Math.cos(u), y: 4 + 5 * Math.sin(u), z: 7 + 10 * Math.sin(u) * Math.sin(Math.PI / 3) });
  const d = (u: number): Vec3 => ({ x: -10 * Math.sin(u), y: 5 * Math.cos(u), z: 10 * Math.cos(u) * Math.sin(Math.PI / 3) });
  const n = 8;
  const cubics: Vec3[] = [tilted(0)];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const b = (2 * Math.PI * (i + 1)) / n;
    const h = (b - a) / 3;
    const pa = tilted(a);
    const pb = i === n - 1 ? cubics[0]! : tilted(b);
    cubics.push(
      { x: pa.x + d(a).x * h, y: pa.y + d(a).y * h, z: pa.z + d(a).z * h },
      { x: pb.x - d(b).x * h, y: pb.y - d(b).y * h, z: pb.z - d(b).z * h },
      pb,
    );
  }
  const samples = Array.from({ length: 65 }, (_, i) => tilted((2 * Math.PI * i) / 64));
  const exact = { curve: "other" as const, from: tilted(0), to: tilted(0), cubics };
  const source = { bodyId: "body-1", source: "edge" as const, hint: tilted(1) };
  const base = createSketch("s", "Sketch", { type: "origin", plane: "XY" });

  it("projects the chain point by point", () => {
    const shape = projectCurve(XY, samples, undefined, exact);
    expect(shape?.type).toBe("chain");
    const pts = shape?.type === "chain" ? shape.points : [];
    expect(pts).toHaveLength(3 * n + 1);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    pts.forEach((p, i) => {
      expect(p.x).toBeCloseTo(cubics[i]!.x, 9);
      expect(p.y).toBeCloseTo(cubics[i]!.y, 9);
    });
  });

  it("is held as control splines that close into one region, and follows the source", () => {
    const shape = projectCurve(XY, samples, undefined, exact)!;
    const { sketch, ref } = addProjection(base, shape, source)!;
    const splines = ref.entityIds.filter((id) => sketch.entities[id]!.type === "spline");
    expect(splines).toHaveLength(n);
    // One shared point where the spans meet, and where the chain closes.
    expect(ref.entityIds.filter((id) => sketch.entities[id]!.type === "point")).toHaveLength(3 * n);
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    // An ellipse with half axes 10 and 5 (the area of the region is measured on a polygon).
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 50, 0);
    expect(projectedShapes(sketch)).toEqual([shape]);
    expect(sameProjectedShape(projectedShapes(sketch)[0]!, shape)).toBe(true);
    expect(updateProjection(sketch, ref, shape, source.hint)).toBe(sketch);
    const moved = { type: "chain" as const, points: (shape as { points: { x: number; y: number }[] }).points.map((p) => ({ x: p.x + 1, y: p.y })) };
    const next = updateProjection(sketch, ref, moved, source.hint)!;
    expect(projectedShapes(next)).toEqual([moved]);
  });

  it("is a line when seen edge-on", () => {
    // The same curve squashed into the upright plane x = 3.
    const shape = projectCurve(XY, samples.map((p) => ({ ...p, x: 3 })), undefined, {
      ...exact,
      from: { ...exact.from, x: 3 },
      to: { ...exact.to, x: 3 },
      cubics: cubics.map((p) => ({ ...p, x: 3 })),
    });
    expect(shape?.type).toBe("line");
  });
});
