import { describe, expect, it } from "vitest";
import { ORIGIN_PLANES, type Vec3 } from "@fabcad/geometry";
import { createSketch } from "../src/model";
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

  it("leaves a tilted circle, which projects to an ellipse, to the samples", () => {
    // Turned 60° about the x axis: seen from above it is an ellipse.
    const tilted = circle3d(8, 0).map((p) => ({ x: p.x, y: 5 + (p.y - 5) * 0.5, z: 5 + (p.y - 5) * Math.sin(Math.PI / 3) }));
    const shape = projectCurve(XY, tilted, undefined, {
      curve: "circle",
      from: tilted[0]!,
      to: tilted[0]!,
      center: { x: 10, y: 5, z: 5 },
      radius: 8,
    });
    expect(shape).toMatchObject({ type: "spline", closed: true });
  });
});

const v0 = { x: 0, y: 0 };
