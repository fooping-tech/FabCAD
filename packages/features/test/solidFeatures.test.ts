import { beforeAll, describe, expect, it } from "vitest";
import { type BodyGeometry, type GeometryKernel, edgePolyline, faceEdges } from "@fabcad/brep";
import {
  type BodyOperation,
  type CircularPatternFeature,
  type CreatedRef,
  type ExtrudeFeature,
  DocumentStore,
  type HoleFeature,
  type MoveFeature,
  type RectangularPatternFeature,
  type SketchFeature,
  type SplitFeature,
  addAlign,
  addBoolean,
  addCircularPattern,
  addExtrude,
  addFillet,
  addHole,
  addLoft,
  addMirror,
  addMove,
  addOffsetPlane,
  addParameter,
  addRectangularPattern,
  addSketch,
  addSplit,
  addSweep,
  affectedFeatures,
  command,
  createDocument,
  deserializeDocument,
  dynamicBodyId,
  featureExpressions,
  serializeDocument,
  syncBodyRecords,
  updateFeature,
  updateParameter,
  updateSketch,
} from "@fabcad/cad-document";
import { type Plane3, type Vec2, type Vec3, ORIGIN_PLANES, dot3, makePlane, scale3 } from "@fabcad/geometry";
import {
  type Sketch,
  type SketchBuilder,
  type SketchPlaneRef,
  addProjection,
  createArcCenter,
  createCircle,
  createLine,
  createPoint,
  createRectangle2Point,
  createSpline,
  detectProfiles,
  editSketch,
  profileRefOf,
  projectCurve,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../brep/test/nodeKernel";
import {
  type BodyNames,
  FeatureEngine,
  type RecomputeResult,
  makeEdgeRef,
  makeFaceRef,
  makeVertexRef,
  resolveDocumentSketches,
  resolveFaceRef,
} from "../src";

let kernel: GeometryKernel;
const solver = createDefaultSolver();

beforeAll(async () => {
  kernel = await nodeKernel();
});

// ------------------------------------------------------------------ helpers

interface Ctx {
  store: DocumentStore;
  engine: FeatureEngine;
}

const context = (): Ctx => ({
  store: new DocumentStore(createDocument()),
  engine: new FeatureEngine(kernel, solver),
});

/** Like the app: a parameter change re-solves the sketches in the same undo step. */
function run(ctx: Ctx, cmd: ReturnType<typeof command>): void {
  ctx.store.execute(
    command(cmd.label, (doc) => {
      const next = cmd.apply(doc);
      return next.parameters !== doc.parameters ? resolveDocumentSketches(next, solver) : next;
    }),
  );
}

/** Recompute and, like the app, write back what the engine found out about the document. */
async function compute(ctx: Ctx, expectOk = true): Promise<RecomputeResult> {
  const result = await ctx.engine.recompute(ctx.store.document);
  ctx.store.amend((doc) => {
    let features = doc.features;
    for (const [id, sketch] of Object.entries(result.sketchUpdates)) {
      const f = features[id];
      if (!f || f.type !== "sketch") continue;
      if (features === doc.features) features = { ...doc.features };
      features[id] = { ...f, sketch };
    }
    const next = features === doc.features ? doc : { ...doc, features };
    return syncBodyRecords(
      result.bodies.flatMap((b) => (b.record ? [{ id: b.id, ...b.record }] : [])),
      result.bodies.map((b) => b.id),
    )(next);
  });
  if (expectOk) {
    for (const f of Object.values(result.features)) expect(f.state, `${f.id}: ${f.message}`).toBe("ok");
  }
  return result;
}

function setParameter(ctx: Ctx, name: string, expression: string): void {
  const p = ctx.store.document.parameters.find((q) => q.name === name)!;
  run(ctx, updateParameter(p.id, { expression }));
}

const sketchOf = (ctx: Ctx, id: string): Sketch =>
  (ctx.store.document.features[id] as SketchFeature).sketch;

function sketch<T>(ctx: Ctx, plane: SketchPlaneRef, draw: (b: SketchBuilder) => T): { id: string; made: T } {
  const s: CreatedRef = {};
  ctx.store.execute(addSketch(plane, s));
  let made: T | undefined;
  ctx.store.execute(
    updateSketch(s.id!, "Draw", (sk) =>
      editSketch(sk, (b) => {
        made = draw(b);
      }),
    ),
  );
  return { id: s.id!, made: made as T };
}

const XY: SketchPlaneRef = { type: "origin", plane: "XY" };
const XZ: SketchPlaneRef = { type: "origin", plane: "XZ" };
const planeAt = (z: number): SketchPlaneRef => ({
  type: "custom",
  plane: { ...ORIGIN_PLANES.XY, origin: { x: 0, y: 0, z } },
});

const profileAt = (ctx: Ctx, sketchId: string, p: Vec2): ReturnType<typeof profileRefOf> =>
  profileRefOf(regionAtPoint(detectProfiles(sketchOf(ctx, sketchId)), p)!);

interface Made {
  sketchId: string;
  featureId: string;
  bodyId: string;
  lines: string[];
}

/** Extrude a rectangle drawn on a plane. */
function block(
  ctx: Ctx,
  from: Vec2,
  to: Vec2,
  distance: string,
  options: { plane?: SketchPlaneRef; operation?: BodyOperation; targets?: string[] } = {},
): Made {
  const s = sketch(ctx, options.plane ?? XY, (b) => createRectangle2Point(b, from, to).entities);
  const e: CreatedRef = {};
  ctx.store.execute(
    addExtrude(
      {
        sketchId: s.id,
        profiles: [profileAt(ctx, s.id, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })],
        distance,
        operation: options.operation ?? "new",
        targetBodyIds: options.targets ?? [],
      },
      e,
    ),
  );
  return { sketchId: s.id, featureId: e.id!, bodyId: e.bodyId!, lines: s.made };
}

const geometry = (ctx: Ctx, bodyId: string): BodyGeometry => ctx.engine.bodyGeometry(bodyId)!;
const names = (ctx: Ctx, bodyId: string): BodyNames => ctx.engine.bodyNames(bodyId)!;
const body = (ctx: Ctx, bodyId: string): { geometry: BodyGeometry; names: BodyNames } => ({
  geometry: geometry(ctx, bodyId),
  names: names(ctx, bodyId),
});

const near = (a: Vec3, b: Vec3, tol = 1e-4): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol;

const faceAt = (g: BodyGeometry, center: Vec3): number => g.faces.findIndex((f) => near(f.center, center));
const edgeAt = (g: BodyGeometry, midpoint: Vec3): number =>
  g.edges.findIndex((e) => near(e.midpoint, midpoint));

/** The plane a sketch on a face gets: its origin is the foot of the world origin. */
function onFace(ctx: Ctx, bodyId: string, center: Vec3): SketchPlaneRef {
  const b = body(ctx, bodyId);
  const index = faceAt(b.geometry, center);
  expect(index).toBeGreaterThanOrEqual(0);
  const face = b.geometry.faces[index]!;
  const plane: Plane3 = makePlane(
    scale3(face.normal, dot3(face.normal, face.center)),
    face.normal,
    Math.abs(face.normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 },
  );
  return { type: "face", bodyId, hint: face.center, plane, ref: makeFaceRef(b, index)! };
}

const circleArea = (d: number): number => (Math.PI * d * d) / 4;

// ------------------------------------------- sketch on a face, outline projected

describe("sketch on a face with its outline projected", () => {
  /**
   * A ring R25 / R30 drawn on the top of a ring R50 / R55, crossing its inner edge and touching
   * its outer one (issue #8). The projected outline must not cut the drawn ring, and the union
   * of the two rings is one closed solid.
   */
  it("extrudes the drawn ring whole and unites it with the body below", async () => {
    const ctx = context();
    const base = sketch(ctx, XY, (b) => [createCircle(b, { x: 0, y: 0 }, 55), createCircle(b, { x: 0, y: 0 }, 50)]);
    const e1: CreatedRef = {};
    ctx.store.execute(
      addExtrude({ sketchId: base.id, profiles: [profileAt(ctx, base.id, { x: 52.5, y: 0 })], distance: "10" }, e1),
    );
    await compute(ctx);
    const below = geometry(ctx, e1.bodyId!).volume;
    expect(below).toBeCloseTo(Math.PI * (55 * 55 - 50 * 50) * 10, 0);

    const g = geometry(ctx, e1.bodyId!);
    const top = g.faces.findIndex((f) => f.surface === "plane" && f.normal.z > 0.99);
    const plane = makePlane({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
    const onTop: SketchPlaneRef = {
      type: "face",
      bodyId: e1.bodyId!,
      hint: { x: 52.5, y: 0, z: 10 },
      plane,
      ref: makeFaceRef(body(ctx, e1.bodyId!), top)!,
    };
    const s = sketch(ctx, onTop, (b) => [createCircle(b, { x: 25, y: 0 }, 25), createCircle(b, { x: 25, y: 0 }, 30)]);
    // As the app does: the outline of the face is projected into the new sketch.
    ctx.store.execute(
      updateSketch(s.id, "Project", (sk) =>
        faceEdges(g, top).reduce((current, edge) => {
          const shape = projectCurve(plane, edgePolyline(g, edge), edge.bezier, edge)!;
          return addProjection(current, shape, { bodyId: e1.bodyId!, source: "edge", hint: edge.midpoint })!.sketch;
        }, sk),
      ),
    );
    const sk = sketchOf(ctx, s.id);
    // The projected circles are exactly concentric with the sketch origin.
    for (const ref of sk.projections) {
      const circle = ref.entityIds.map((id) => sk.entities[id]).find((x) => x?.type === "circle");
      if (circle?.type !== "circle") continue;
      expect(sk.entities[circle.center]).toMatchObject({ x: 0, y: 0 });
    }

    const [inner, outer] = s.made.map((c) => c.entities[0]!);
    const ring = profileAt(ctx, s.id, { x: 25, y: 27.5 });
    expect(ring.entityIds).toEqual([outer]);
    const region = regionAtPoint(detectProfiles(sk), { x: 25, y: 27.5 })!;
    expect(region.holeEntityIds).toEqual([[inner]]);
    expect(region.area).toBeCloseTo(Math.PI * (30 * 30 - 25 * 25), 3);

    const e2: CreatedRef = {};
    ctx.store.execute(addExtrude({ sketchId: s.id, profiles: [ring], distance: "10" }, e2));
    await compute(ctx);
    const upper = geometry(ctx, e2.bodyId!).volume;
    expect(upper).toBeCloseTo(Math.PI * (30 * 30 - 25 * 25) * 10, 0);

    ctx.store.execute(addBoolean({ operation: "union", targetBodyId: e1.bodyId!, toolBodyIds: [e2.bodyId!] }));
    await compute(ctx);
    const union = geometry(ctx, e1.bodyId!).volume;
    expect(union).toBeGreaterThanOrEqual(Math.max(below, upper) - 1e-6);
    expect(union).toBeCloseTo(below + upper, 0);
  });
});

// ------------------------------------------------------------- extrude up to

describe("extrude up to", () => {
  const extrudeTo = (ctx: Ctx, from: Vec2, to: Vec2, target: ExtrudeFeature["to"]): Made => {
    const s = sketch(ctx, XY, (b) => createRectangle2Point(b, from, to).entities);
    const e: CreatedRef = {};
    ctx.store.execute(
      addExtrude(
        { sketchId: s.id, profiles: [profileAt(ctx, s.id, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })], distance: "1", to: target },
        e,
      ),
    );
    return { sketchId: s.id, featureId: e.id!, bodyId: e.bodyId!, lines: s.made };
  };

  it("goes up to a construction plane and follows it", async () => {
    const ctx = context();
    const plane: CreatedRef = {};
    ctx.store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "35" }, plane));
    const e = extrudeTo(ctx, { x: 0, y: 0 }, { x: 10, y: 10 }, { type: "plane", featureId: plane.id! });
    await compute(ctx);
    expect(geometry(ctx, e.bodyId).bounds.max.z).toBeCloseTo(35, 6);
    // The plane moves: the extrusion follows it, also to the other side.
    run(ctx, updateFeature(plane.id!, { offset: "-12" }));
    await compute(ctx);
    const g = geometry(ctx, e.bodyId);
    expect(g.bounds.min.z).toBeCloseTo(-12, 6);
    expect(g.bounds.max.z).toBeCloseTo(0, 6);
  });

  it("goes up to a flat face of another body, and to a vertex", async () => {
    const ctx = context();
    const base = block(ctx, { x: 0, y: 0 }, { x: 40, y: 30 }, "20");
    await compute(ctx);
    const top = faceAt(geometry(ctx, base.bodyId), { x: 20, y: 15, z: 20 });
    const ref = makeFaceRef(body(ctx, base.bodyId), top)!;
    const e = extrudeTo(ctx, { x: 50, y: 0 }, { x: 60, y: 10 }, { type: "face", bodyId: base.bodyId, ref });
    await compute(ctx);
    expect(geometry(ctx, e.bodyId).bounds.max.z).toBeCloseTo(20, 6);
    expect(geometry(ctx, e.bodyId).volume).toBeCloseTo(10 * 10 * 20, 3);

    const g = geometry(ctx, base.bodyId);
    const vertex = g.vertices.length / 3;
    let index = -1;
    for (let i = 0; i < vertex; i++) {
      if (Math.abs(g.vertices[i * 3 + 2]! - 20) < 1e-6) index = i;
    }
    const v = makeVertexRef(body(ctx, base.bodyId), base.bodyId, index)!;
    const f = extrudeTo(ctx, { x: 70, y: 0 }, { x: 80, y: 10 }, v);
    await compute(ctx);
    expect(geometry(ctx, f.bodyId).bounds.max.z).toBeCloseTo(20, 6);
    // The base grows: both follow.
    run(ctx, updateFeature(base.featureId, { distance: "25" }));
    await compute(ctx);
    expect(geometry(ctx, e.bodyId).bounds.max.z).toBeCloseTo(25, 6);
    expect(geometry(ctx, f.bodyId).bounds.max.z).toBeCloseTo(25, 6);
    // The distance is not a value of the feature while it goes up to something.
    expect(featureExpressions(ctx.store.document.features[e.featureId]!)).toEqual([]);
  });

  it("refuses a plane that is not parallel to the sketch, and one on the sketch plane", async () => {
    const ctx = context();
    const a = extrudeTo(ctx, { x: 0, y: 0 }, { x: 10, y: 10 }, { type: "origin-plane", plane: "XZ" });
    const b = extrudeTo(ctx, { x: 20, y: 0 }, { x: 30, y: 10 }, { type: "origin-plane", plane: "XY" });
    const result = await compute(ctx, false);
    expect(result.features[a.featureId]).toMatchObject({ state: "error", message: "The plane to extrude to is not parallel to the sketch." });
    expect(result.features[b.featureId]).toMatchObject({ state: "error", message: "What to extrude to lies on the sketch plane." });
  });
});

// --------------------------------------------------------------------- hole

describe("hole", () => {
  /** 100 × 80 plate, `thickness` thick, on the XY plane. */
  function plate(ctx: Ctx): Made {
    run(ctx, addParameter({ name: "thickness", expression: "10", unit: "mm" }));
    return block(ctx, { x: 0, y: 0 }, { x: 100, y: 80 }, "thickness");
  }

  it("drills a simple hole through all and names its face after the sketch point", async () => {
    const ctx = context();
    const p = plate(ctx);
    const s = sketch(ctx, XY, (b) => createPoint(b, { x: 30, y: 40 }).points[0]!);
    const h: CreatedRef = {};
    ctx.store.execute(
      addHole({ bodyId: p.bodyId, sketchId: s.id, points: [s.made], diameter: "8" }, h),
    );
    expect(ctx.store.document.features[h.id!]!.name).toBe("Hole001");
    await compute(ctx);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(100 * 80 * 10 - circleArea(8) * 10, 3);
    const hole = names(ctx, p.bodyId).faces.filter((n) => n.feature === h.id);
    expect(hole.length).toBeGreaterThan(0);
    for (const n of hole) {
      expect(n).toMatchObject({ role: "hole", sketch: s.id, entity: s.made });
    }
    // The faces of the plate are still those of the extrude.
    expect(names(ctx, p.bodyId).faces.map((n) => n.key)).toContain(`${p.featureId}:end`);
  });

  it("drills a blind hole into the body from a sketch on a face", async () => {
    const ctx = context();
    const p = plate(ctx);
    await compute(ctx);
    const s = sketch(ctx, onFace(ctx, p.bodyId, { x: 50, y: 40, z: 10 }), (b) =>
      createPoint(b, { x: 30, y: 40 }).points[0]!,
    );
    const h: CreatedRef = {};
    ctx.store.execute(
      addHole(
        { bodyId: p.bodyId, sketchId: s.id, points: [s.made], diameter: "8", extent: "distance", depth: "4" },
        h,
      ),
    );
    await compute(ctx);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(100 * 80 * 10 - circleArea(8) * 4, 3);
    // The normal of the face points up; the hole goes down, into the plate.
    const bottom = names(ctx, p.bodyId).faces.findIndex((n) => n.role === "hole-bottom");
    expect(g.faces[bottom]!.center).toMatchObject({ x: 30, y: 40 });
    expect(g.faces[bottom]!.center.z).toBeCloseTo(6, 6);
    expect(names(ctx, p.bodyId).faces[bottom]!.entity).toBe(s.made);

    // Flipped it points away from the plate and removes nothing: that is an error, not a no-op.
    ctx.store.execute(updateFeature<HoleFeature>(h.id!, { flip: true }));
    const flipped = await compute(ctx, false);
    expect(flipped.features[h.id!]).toMatchObject({ state: "error" });
    expect(flipped.features[h.id!]!.message).toMatch(/does not remove any material/);
  });

  it("makes counterbores and countersinks", async () => {
    const ctx = context();
    const p = plate(ctx);
    await compute(ctx);
    const top = onFace(ctx, p.bodyId, { x: 50, y: 40, z: 10 });
    const s = sketch(ctx, top, (b) => [
      createPoint(b, { x: 30, y: 40 }).points[0]!,
      createPoint(b, { x: 70, y: 40 }).points[0]!,
    ]);
    const bore: CreatedRef = {};
    ctx.store.execute(
      addHole(
        {
          bodyId: p.bodyId,
          sketchId: s.id,
          points: [s.made[0]!],
          holeType: "counterbore",
          diameter: "6",
          counterboreDiameter: "11",
          counterboreDepth: "3",
        },
        bore,
      ),
    );
    await compute(ctx);
    const afterBore = 100 * 80 * 10 - circleArea(6) * 10 - (circleArea(11) - circleArea(6)) * 3;
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(afterBore, 3);
    const roles = new Set(
      names(ctx, p.bodyId)
        .faces.filter((n) => n.feature === bore.id)
        .map((n) => n.role),
    );
    expect(roles).toEqual(new Set(["hole", "counterbore", "counterbore-bottom"]));

    const sink: CreatedRef = {};
    ctx.store.execute(
      addHole(
        {
          bodyId: p.bodyId,
          sketchId: s.id,
          points: [s.made[1]!],
          holeType: "countersink",
          diameter: "6",
          extent: "distance",
          depth: "8",
          countersinkDiameter: "12",
          countersinkAngle: "90",
        },
        sink,
      ),
    );
    await compute(ctx);
    // 90° included angle: the cone is 3 mm high; below it 5 mm of plain hole.
    const cone = (Math.PI * 3 * (36 + 18 + 9)) / 3;
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(afterBore - cone - circleArea(6) * 5, 3);
    const sinkRoles = new Set(
      names(ctx, p.bodyId)
        .faces.filter((n) => n.feature === sink.id)
        .map((n) => n.role),
    );
    expect(sinkRoles).toEqual(new Set(["hole", "countersink", "hole-bottom"]));
  });

  it("takes its sizes from parameters", async () => {
    const ctx = context();
    const p = plate(ctx);
    run(ctx, addParameter({ name: "bolt", expression: "6", unit: "mm" }));
    const s = sketch(ctx, XY, (b) => createPoint(b, { x: 30, y: 40 }).points[0]!);
    const h: CreatedRef = {};
    ctx.store.execute(
      addHole({ bodyId: p.bodyId, sketchId: s.id, points: [s.made], diameter: "bolt + 0.5" }, h),
    );
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(80000 - circleArea(6.5) * 10, 3);
    expect(affectedFeatures(ctx.store.document, { parameters: ["bolt"] })).toEqual([h.id]);
    setParameter(ctx, "bolt", "10");
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual([h.id]);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(80000 - circleArea(10.5) * 10, 3);

    ctx.store.execute(updateFeature<HoleFeature>(h.id!, { diameter: "0" }));
    const bad = await compute(ctx, false);
    expect(bad.features[h.id!]!.message).toMatch(/diameter must be positive/);
    // The body is as it was before the hole.
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(80000, 3);
  });

  it("drills one hole per point, follows the points and keeps the names", async () => {
    const ctx = context();
    const p = plate(ctx);
    const s = sketch(ctx, XY, (b) => [
      createPoint(b, { x: 20, y: 20 }).points[0]!,
      createPoint(b, { x: 50, y: 40 }).points[0]!,
      createPoint(b, { x: 80, y: 60 }).points[0]!,
    ]);
    const h: CreatedRef = {};
    ctx.store.execute(addHole({ bodyId: p.bodyId, sketchId: s.id, points: s.made, diameter: "8" }, h));
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(80000 - 3 * circleArea(8) * 10, 3);
    const holeFaces = (): { entity: string | undefined; key: string; x: number; y: number }[] => {
      const g = geometry(ctx, p.bodyId);
      return names(ctx, p.bodyId)
        .faces.map((n, i) => ({ n, f: g.faces[i]! }))
        .filter(({ n }) => n.feature === h.id)
        .map(({ n, f }) => ({ entity: n.entity, key: n.key, x: f.center.x, y: f.center.y }));
    };
    const before = holeFaces();
    expect(new Set(before.map((f) => f.entity))).toEqual(new Set(s.made));
    for (const f of before.filter((q) => q.entity === s.made[1])) {
      expect(f.x).toBeCloseTo(50, 3);
      expect(f.y).toBeCloseTo(40, 3);
    }

    // A face of the middle hole, referenced the way a later feature would.
    const index = names(ctx, p.bodyId).faces.findIndex((n) => n.entity === s.made[1]);
    const ref = makeFaceRef(body(ctx, p.bodyId), index)!;

    ctx.store.execute(
      updateSketch(s.id, "Move point", (sk) =>
        editSketch(sk, (b) => b.movePoint(s.made[1]!, { x: 60, y: 25 })),
      ),
    );
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual([h.id]);
    const after = holeFaces();
    expect(after.map((f) => f.key).sort()).toEqual(before.map((f) => f.key).sort());
    for (const f of after.filter((q) => q.entity === s.made[1])) {
      expect(f.x).toBeCloseTo(60, 3);
      expect(f.y).toBeCloseTo(25, 3);
    }
    const found = resolveFaceRef(ref, body(ctx, p.bodyId))!;
    expect(found.by).toBe("name");
    expect(geometry(ctx, p.bodyId).faces[found.index]!.center.x).toBeCloseTo(60, 3);
  });

  it("still goes through all after the body got thicker", async () => {
    const ctx = context();
    const p = plate(ctx);
    await compute(ctx);
    const s = sketch(ctx, onFace(ctx, p.bodyId, { x: 50, y: 40, z: 10 }), (b) =>
      createPoint(b, { x: 30, y: 40 }).points[0]!,
    );
    ctx.store.execute(addHole({ bodyId: p.bodyId, sketchId: s.id, points: [s.made], diameter: "8" }));
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(80000 - circleArea(8) * 10, 3);
    setParameter(ctx, "thickness", "65");
    await compute(ctx);
    const g = geometry(ctx, p.bodyId);
    expect(g.bounds.max.z).toBeCloseTo(65, 6);
    expect(g.volume).toBeCloseTo(100 * 80 * 65 - circleArea(8) * 65, 3);
    // Through: the hole has no bottom.
    expect(names(ctx, p.bodyId).faces.some((n) => n.role === "hole-bottom")).toBe(false);
  });
});

// ------------------------------------------------------------------ patterns

describe("pattern", () => {
  it("repeats a cut in two directions", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 100, y: 80 }, "10");
    const s = sketch(ctx, XY, (b) => createCircle(b, { x: 15, y: 15 }, 3).entities[0]!);
    const cut: CreatedRef = {};
    ctx.store.execute(
      addExtrude(
        {
          sketchId: s.id,
          profiles: [profileAt(ctx, s.id, { x: 15, y: 15 })],
          distance: "10",
          operation: "cut",
          targetBodyIds: [p.bodyId],
        },
        cut,
      ),
    );
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [cut.id!] },
          direction: { type: "origin-axis", axis: "X" },
          count: "3",
          distance: "30",
          direction2: { type: "sketch-line", sketchId: p.sketchId, entityId: p.lines[1]! },
          count2: "2",
          distance2: "40",
        },
        pattern,
      ),
    );
    expect(ctx.store.document.features[pattern.id!]!.name).toBe("Rectangular Pattern001");
    const result = await compute(ctx);
    // One body: a pattern of features makes no bodies.
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(80000 - 6 * circleArea(6) * 10, 2);
    for (const x of [15, 45, 75]) {
      for (const y of [15, 55]) {
        expect(
          g.edges.some((e) => e.curve === "circle" && e.center && near(e.center, { x, y, z: 10 })),
          `hole at ${x}, ${y}`,
        ).toBe(true);
      }
    }
    // Every copy is named after the instance, and all names are different.
    const all = names(ctx, p.bodyId).faces;
    expect(new Set(all.map((n) => n.key)).size).toBe(all.length);
    const copies = all.filter((n) => n.feature === pattern.id);
    expect(new Set(copies.map((n) => n.instance))).toEqual(new Set(["1", "2", "0.1", "1.1", "2.1"]));
    for (const n of copies) {
      expect(n).toMatchObject({ role: "side", sketch: s.id, entity: s.made });
      expect(n.of).toHaveLength(1);
      expect(n.of![0]).toContain(`${cut.id}:side`);
    }
  });

  /** 100 × 100 × 10 plate around the origin with a hole at (30, 0) repeated about Z. */
  async function boltCircle(): Promise<{
    ctx: Ctx;
    plate: Made;
    holeId: string;
    patternId: string;
    point: string;
  }> {
    const ctx = context();
    run(ctx, addParameter({ name: "bolts", expression: "6", unit: "" }));
    const plate = block(ctx, { x: -50, y: -50 }, { x: 50, y: 50 }, "10");
    const s = sketch(ctx, XY, (b) => createPoint(b, { x: 30, y: 0 }).points[0]!);
    const h: CreatedRef = {};
    ctx.store.execute(
      addHole({ bodyId: plate.bodyId, sketchId: s.id, points: [s.made], diameter: "6" }, h),
    );
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addCircularPattern(
        {
          source: { kind: "features", featureIds: [h.id!] },
          axis: { type: "origin-axis", axis: "Z" },
          count: "bolts",
        },
        pattern,
      ),
    );
    await compute(ctx);
    return { ctx, plate, holeId: h.id!, patternId: pattern.id!, point: s.made };
  }

  it("repeats a hole on a bolt circle", async () => {
    const { ctx, plate, patternId, point } = await boltCircle();
    expect((ctx.store.document.features[patternId] as CircularPatternFeature).angle).toBe("360");
    const g = geometry(ctx, plate.bodyId);
    expect(g.volume).toBeCloseTo(100000 - 6 * circleArea(6) * 10, 2);
    // Evenly around the full turn, the first one not made twice.
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const centre = { x: 30 * Math.cos(a), y: 30 * Math.sin(a), z: 10 };
      expect(
        g.edges.filter((e) => e.curve === "circle" && e.center && near(e.center, centre)).length,
        `hole ${i}`,
      ).toBeGreaterThan(0);
    }
    const copies = names(ctx, plate.bodyId).faces.filter((n) => n.feature === patternId);
    expect(new Set(copies.map((n) => n.instance))).toEqual(new Set(["1", "2", "3", "4", "5"]));
    // A copy of a hole is still the hole of that sketch point.
    for (const n of copies) expect(n).toMatchObject({ role: "hole", entity: point });
  });

  it("recomputes when the count changes and leaves the names of the instances alone", async () => {
    const { ctx, plate, holeId, patternId } = await boltCircle();
    const holeNames = (): string[] =>
      names(ctx, plate.bodyId)
        .faces.filter((n) => n.feature === patternId || n.feature === holeId)
        .map((n) => n.key)
        .sort();
    const before = holeNames();
    expect(affectedFeatures(ctx.store.document, { parameters: ["bolts"] })).toEqual([patternId]);

    setParameter(ctx, "bolts", "8");
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual([patternId]);
    expect(geometry(ctx, plate.bodyId).volume).toBeCloseTo(100000 - 8 * circleArea(6) * 10, 2);
    const after = holeNames();
    for (const key of before) expect(after).toContain(key);
    expect(after.length).toBeGreaterThan(before.length);
    // Instance 3 is still instance 3, although it moved from 180° to 135°.
    const g = geometry(ctx, plate.bodyId);
    const third = names(ctx, plate.bodyId).faces.findIndex((n) => n.instance === "3");
    const a = (3 * Math.PI) / 4;
    expect(g.faces[third]!.center.x).toBeCloseTo(30 * Math.cos(a), 2);
    expect(g.faces[third]!.center.y).toBeCloseTo(30 * Math.sin(a), 2);

    setParameter(ctx, "bolts", "2.6");
    await compute(ctx);
    expect(geometry(ctx, plate.bodyId).volume).toBeCloseTo(100000 - 3 * circleArea(6) * 10, 2);

    setParameter(ctx, "bolts", "0");
    const bad = await compute(ctx, false);
    expect(bad.features[patternId]!.message).toMatch(/at least 1/);
  });

  it("spreads the instances over an angle", async () => {
    const { ctx, plate, patternId } = await boltCircle();
    setParameter(ctx, "bolts", "3");
    ctx.store.execute(updateFeature<CircularPatternFeature>(patternId, { angle: "90" }));
    await compute(ctx);
    const g = geometry(ctx, plate.bodyId);
    for (const deg of [0, 45, 90]) {
      const a = (deg * Math.PI) / 180;
      const centre = { x: 30 * Math.cos(a), y: 30 * Math.sin(a), z: 10 };
      expect(g.edges.some((e) => e.center && near(e.center, centre)), `hole at ${deg}°`).toBe(true);
    }
  });

  it("makes a body for every instance of a body pattern", async () => {
    const ctx = context();
    run(ctx, addParameter({ name: "n", expression: "4", unit: "" }));
    const p = block(ctx, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "bodies", bodyIds: [p.bodyId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "25",
        },
        pattern,
      ),
    );
    // How many bodies there are is not known before the pattern is evaluated.
    expect(Object.keys(ctx.store.document.bodies)).toEqual([p.bodyId]);
    const first = await ctx.engine.recompute(ctx.store.document);
    const ids = [1, 2, 3].map((i) => dynamicBodyId(pattern.id!, p.bodyId, i));
    expect(ids[0]).toBe(`${pattern.id}:${p.bodyId}:1`);
    expect(first.bodies.map((b) => b.id)).toEqual([p.bodyId, ...ids]);
    expect(first.bodies[0]!.record).toBeUndefined();
    expect(first.bodies[2]!.record).toEqual({
      createdBy: pattern.id,
      sourceBodyId: p.bodyId,
      suggestedName: "Body001 (Rectangular Pattern001 2)",
      componentId: ctx.store.document.assembly.rootComponentId,
    });

    await compute(ctx);
    expect(Object.keys(ctx.store.document.bodies)).toEqual([p.bodyId, ...ids]);
    expect(ctx.store.document.bodies[ids[1]!]).toMatchObject({
      name: "Body001 (Rectangular Pattern001 2)",
      createdBy: pattern.id,
      visible: true,
    });
    ids.forEach((id, i) => {
      const g = geometry(ctx, id);
      expect(g.volume).toBeCloseTo(6000, 3);
      expect(g.bounds.min.x).toBeCloseTo(25 * (i + 1), 6);
    });
    // Records that exist are not reported again.
    const again = await ctx.engine.recompute(ctx.store.document);
    expect(again.bodies.every((b) => b.record === undefined)).toBe(true);

    // Fewer instances: the bodies and their records go; more: they come back.
    setParameter(ctx, "n", "2");
    await compute(ctx);
    expect(Object.keys(ctx.store.document.bodies)).toEqual([p.bodyId, ids[0]]);
    expect(ctx.engine.bodyIds()).toEqual([p.bodyId, ids[0]]);

    // A feature on an instance depends on the pattern, which its id names.
    const fillet: CreatedRef = {};
    const edge = edgeAt(geometry(ctx, ids[0]!), { x: 25, y: 0, z: 15 });
    ctx.store.execute(
      addFillet(
        { bodyId: ids[0]!, edges: [makeEdgeRef(body(ctx, ids[0]!), edge)!], radius: "2" },
        fillet,
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, ids[0]!).volume).toBeLessThan(6000);
    expect(affectedFeatures(ctx.store.document, { parameters: ["n"] })).toEqual([
      pattern.id,
      fillet.id,
    ]);
    expect(affectedFeatures(ctx.store.document, { features: [p.featureId] })).toEqual([
      p.featureId,
      pattern.id,
      fillet.id,
    ]);
  });

  it("refuses to repeat features that have no tool", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    await compute(ctx);
    const fillet: CreatedRef = {};
    const edge = edgeAt(geometry(ctx, p.bodyId), { x: 0, y: 0, z: 15 });
    ctx.store.execute(
      addFillet({ bodyId: p.bodyId, edges: [makeEdgeRef(body(ctx, p.bodyId), edge)!], radius: "2" }, fillet),
    );
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [fillet.id!] },
          direction: { type: "origin-axis", axis: "X" },
          count: "2",
          distance: "5",
        },
        pattern,
      ),
    );
    const result = await compute(ctx, false);
    expect(result.features[pattern.id!]).toMatchObject({ state: "error" });
    expect(result.features[pattern.id!]!.message).toMatch(/"Fillet001" cannot be repeated/);
  });

  it("joins the copies of a feature that made a body to that body", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [p.featureId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "3",
          distance: "10",
        },
        pattern,
      ),
    );
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(3 * 6000, 3);
    expect(g.bounds.max.x).toBeCloseTo(30, 6);
  });
});

describe("mirror", () => {
  it("mirrors a body across an origin plane and across a face", async () => {
    const ctx = context();
    const p = block(ctx, { x: 10, y: 0 }, { x: 30, y: 20 }, "30");
    await compute(ctx);
    const m: CreatedRef = {};
    ctx.store.execute(
      addMirror(
        { source: { kind: "bodies", bodyIds: [p.bodyId] }, plane: { type: "origin-plane", plane: "YZ" } },
        m,
      ),
    );
    const mirrored = dynamicBodyId(m.id!, p.bodyId, 1);
    expect(m.bodyId).toBe(mirrored);
    // Which body a mirror makes is known at once: the command adds the record.
    expect(ctx.store.document.bodies[mirrored]).toMatchObject({
      name: "Body001 (Mirror001)",
      createdBy: m.id,
    });
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId, mirrored]);
    const g = geometry(ctx, mirrored);
    expect(g.volume).toBeCloseTo(12000, 3);
    expect(g.bounds.min.x).toBeCloseTo(-30, 6);
    expect(g.bounds.max.x).toBeCloseTo(-10, 6);
    // The faces are named after the faces they are the image of.
    const keys = names(ctx, mirrored).faces.map((n) => n.key);
    expect(new Set(keys).size).toBe(6);
    expect(keys).toContain(`${m.id}:end[${p.featureId}:end]@1`);

    // Across the face at x = 30 of the original.
    const face = faceAt(geometry(ctx, p.bodyId), { x: 30, y: 10, z: 15 });
    const m2: CreatedRef = {};
    ctx.store.execute(
      addMirror(
        {
          source: { kind: "bodies", bodyIds: [p.bodyId] },
          plane: { type: "face", bodyId: p.bodyId, ref: makeFaceRef(body(ctx, p.bodyId), face)! },
        },
        m2,
      ),
    );
    await compute(ctx);
    const g2 = geometry(ctx, m2.bodyId!);
    expect(g2.bounds.min.x).toBeCloseTo(30, 6);
    expect(g2.bounds.max.x).toBeCloseTo(50, 6);

    // The face is found by its name: the mirror image follows when the body gets wider.
    ctx.store.execute(
      updateSketch(p.sketchId, "Widen", (sk) =>
        editSketch(sk, (b) => {
          const right = sk.entities[p.lines[1]!];
          if (right?.type !== "line") throw new Error("not a line");
          b.movePoint(right.p1, { x: 45, y: (sk.entities[right.p1] as Vec2).y });
          b.movePoint(right.p2, { x: 45, y: (sk.entities[right.p2] as Vec2).y });
        }),
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).bounds.max.x).toBeCloseTo(45, 6);
    expect(geometry(ctx, m2.bodyId!).bounds.min.x).toBeCloseTo(45, 6);
    expect(geometry(ctx, m2.bodyId!).bounds.max.x).toBeCloseTo(80, 6);
  });

  it("mirrors a feature across an origin plane and across a face", async () => {
    const ctx = context();
    const p = block(ctx, { x: -50, y: -40 }, { x: 50, y: 40 }, "10");
    const s = sketch(ctx, XY, (b) => createPoint(b, { x: 30, y: 20 }).points[0]!);
    const h: CreatedRef = {};
    ctx.store.execute(
      addHole({ bodyId: p.bodyId, sketchId: s.id, points: [s.made], diameter: "8" }, h),
    );
    const m: CreatedRef = {};
    ctx.store.execute(
      addMirror(
        { source: { kind: "features", featureIds: [h.id!] }, plane: { type: "origin-plane", plane: "YZ" } },
        m,
      ),
    );
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(80000 - 2 * circleArea(8) * 10, 2);
    expect(g.edges.some((e) => e.center && near(e.center, { x: -30, y: 20, z: 10 }))).toBe(true);
    const image = names(ctx, p.bodyId).faces.filter((n) => n.feature === m.id);
    expect(image.length).toBeGreaterThan(0);
    for (const n of image) expect(n).toMatchObject({ role: "hole", entity: s.made, instance: "1" });

    // A boss on top, mirrored across the plane of a side face of another body.
    const wall = block(ctx, { x: -5, y: 60 }, { x: 0, y: 70 }, "10");
    const boss = block(ctx, { x: 10, y: -30 }, { x: 20, y: -20 }, "15", {
      operation: "join",
      targets: [p.bodyId],
    });
    await compute(ctx);
    const face = faceAt(geometry(ctx, wall.bodyId), { x: -5, y: 65, z: 5 });
    const m2: CreatedRef = {};
    ctx.store.execute(
      addMirror(
        {
          source: { kind: "features", featureIds: [boss.featureId] },
          plane: { type: "face", bodyId: wall.bodyId, ref: makeFaceRef(body(ctx, wall.bodyId), face)! },
        },
        m2,
      ),
    );
    await compute(ctx);
    const g2 = geometry(ctx, p.bodyId);
    expect(g2.volume).toBeCloseTo(80000 - 2 * circleArea(8) * 10 + 2 * 10 * 10 * 5, 2);
    // x = 10 … 20 mirrored at x = −5 is x = −30 … −20.
    expect(faceAt(g2, { x: -25, y: -25, z: 15 })).toBeGreaterThanOrEqual(0);
    expect(affectedFeatures(ctx.store.document, { features: [wall.featureId] })).toContain(m2.id);
  });
});

// -------------------------------------------------- references that persist

describe("references through the new features", () => {
  it("keeps a fillet on the same edge of a pattern instance when the spacing changes", async () => {
    const ctx = context();
    run(ctx, addParameter({ name: "pitch", expression: "30", unit: "mm" }));
    const p = block(ctx, { x: 0, y: 0 }, { x: 100, y: 40 }, "10");
    const boss = block(ctx, { x: 10, y: 10 }, { x: 20, y: 20 }, "15", {
      operation: "join",
      targets: [p.bodyId],
    });
    const pattern: CreatedRef = {};
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [boss.featureId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "3",
          distance: "pitch",
        },
        pattern,
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(40000 + 3 * 500, 3);

    // The top edge at the far side of the last boss: x = 80.
    const edge = edgeAt(geometry(ctx, p.bodyId), { x: 80, y: 15, z: 15 });
    expect(edge).toBeGreaterThanOrEqual(0);
    const ref = makeEdgeRef(body(ctx, p.bodyId), edge)!;
    expect(ref.faces!.every((f) => f.endsWith("@2"))).toBe(true);
    const fillet: CreatedRef = {};
    ctx.store.execute(addFillet({ bodyId: p.bodyId, edges: [ref], radius: "2" }, fillet));
    await compute(ctx);
    const filletAt = (): Vec3 => {
      const i = names(ctx, p.bodyId).faces.findIndex((n) => n.feature === fillet.id);
      return geometry(ctx, p.bodyId).faces[i]!.center;
    };
    expect(filletAt().x).toBeGreaterThan(78);
    expect(filletAt().x).toBeLessThan(80);

    expect(affectedFeatures(ctx.store.document, { parameters: ["pitch"] })).toEqual([
      pattern.id,
      fillet.id,
    ]);
    setParameter(ctx, "pitch", "22");
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual([pattern.id, fillet.id]);
    // The last boss is now at x = 54 … 64. Position alone would have found the middle one's
    // neighbourhood or nothing at all.
    expect(filletAt().x).toBeGreaterThan(62);
    expect(filletAt().x).toBeLessThan(64);
    const g = geometry(ctx, p.bodyId);
    expect(edgeAt(g, { x: 64, y: 15, z: 15 })).toBe(-1);
    expect(edgeAt(g, { x: 42, y: 15, z: 15 })).toBeGreaterThanOrEqual(0);
  });

  it("keeps a sketch on the face of a moved body on that face", async () => {
    const ctx = context();
    run(ctx, addParameter({ name: "lift", expression: "20", unit: "mm" }));
    const p = block(ctx, { x: 0, y: 0 }, { x: 40, y: 40 }, "10");
    const move: CreatedRef = {};
    ctx.store.execute(
      addMove(
        { bodyIds: [p.bodyId], transform: { type: "translate", x: "0", y: "0", z: "lift" } },
        move,
      ),
    );
    await compute(ctx);
    const s = sketch(ctx, onFace(ctx, p.bodyId, { x: 20, y: 20, z: 30 }), (b) =>
      createRectangle2Point(b, { x: 10, y: 10 }, { x: 30, y: 30 }).entities,
    );
    const e: CreatedRef = {};
    ctx.store.execute(
      addExtrude(
        {
          sketchId: s.id,
          profiles: [profileAt(ctx, s.id, { x: 20, y: 20 })],
          distance: "5",
          operation: "join",
          targetBodyIds: [p.bodyId],
        },
        e,
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).bounds).toMatchObject({ min: { z: 20 }, max: { z: 35 } });
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(16000 + 2000, 3);

    setParameter(ctx, "lift", "50");
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual([move.id, e.id]);
    const plane = sketchOf(ctx, s.id).plane;
    expect(plane.type === "face" && plane.plane.origin.z).toBeCloseTo(60, 6);
    expect(geometry(ctx, p.bodyId).bounds).toMatchObject({ min: { z: 50 }, max: { z: 65 } });
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(16000 + 2000, 3);
  });
});

// --------------------------------------------------------------- move, align

describe("move", () => {
  it("translates and rotates bodies and keeps their names", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    await compute(ctx);
    const before = names(ctx, p.bodyId);
    const move: CreatedRef = {};
    ctx.store.execute(
      addMove(
        { bodyIds: [p.bodyId], transform: { type: "translate", x: "5", y: "-2 mm", z: "10 / 2" } },
        move,
      ),
    );
    await compute(ctx);
    let g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(6000, 3);
    expect(g.bounds.min).toMatchObject({ x: 5, y: -2, z: 5 });
    expect(names(ctx, p.bodyId)).toEqual(before);
    expect(names(ctx, p.bodyId).faces[faceAt(g, { x: 10, y: 8, z: 35 })]!.role).toBe("end");

    // The expressions of a nested transform are edited by their path.
    ctx.store.execute(updateFeature<MoveFeature>(move.id!, { "transform.x": "50" } as never));
    expect((ctx.store.document.features[move.id!] as MoveFeature).transform).toEqual({
      type: "translate",
      x: "50",
      y: "-2 mm",
      z: "10 / 2",
    });
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).bounds.min.x).toBeCloseTo(50, 6);

    ctx.store.execute(
      updateFeature<MoveFeature>(move.id!, {
        transform: { type: "rotate", axis: { type: "origin-axis", axis: "Z" }, angle: "90" },
      }),
    );
    await compute(ctx);
    g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(6000, 3);
    expect(g.bounds.min.x).toBeCloseTo(-20, 6);
    expect(g.bounds.max.y).toBeCloseTo(10, 6);
    expect(names(ctx, p.bodyId)).toEqual(before);
    // The side that came from the sketch line at x = 10 now looks along +Y.
    const side = names(ctx, p.bodyId).faces.findIndex((n) => n.entity === p.lines[1]);
    expect(g.faces[side]!.normal.y).toBeCloseTo(1, 6);
  });

  it("copies a body, from point to point", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    await compute(ctx);
    const g0 = geometry(ctx, p.bodyId);
    let corner = -1;
    for (let i = 0; i < g0.vertices.length / 3; i++) {
      if (near({ x: g0.vertices[i * 3]!, y: g0.vertices[i * 3 + 1]!, z: g0.vertices[i * 3 + 2]! }, { x: 10, y: 20, z: 30 })) {
        corner = i;
      }
    }
    const from = makeVertexRef(body(ctx, p.bodyId), p.bodyId, corner)!;
    expect(from.edges).toHaveLength(3);
    const copy: CreatedRef = {};
    ctx.store.execute(
      addMove(
        {
          bodyIds: [p.bodyId],
          copy: true,
          transform: { type: "point-to-point", from, to: { type: "fixed", point: { x: 100, y: 0, z: 0 } } },
        },
        copy,
      ),
    );
    const id = dynamicBodyId(copy.id!, p.bodyId, 1);
    expect(copy.bodyId).toBe(id);
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId, id]);
    expect(geometry(ctx, p.bodyId).bounds.min).toMatchObject({ x: 0, y: 0, z: 0 });
    const g = geometry(ctx, id);
    expect(g.volume).toBeCloseTo(6000, 3);
    expect(g.bounds.max.x).toBeCloseTo(100, 6);
    expect(g.bounds.max.y).toBeCloseTo(0, 6);
    expect(g.bounds.max.z).toBeCloseTo(0, 6);
    expect(names(ctx, id)).toEqual(names(ctx, p.bodyId));

    // The vertex is where its edges meet, also after the body changed its size.
    ctx.store.execute(updateFeature(p.featureId, { distance: "50" } as never));
    await compute(ctx);
    expect(geometry(ctx, id).bounds.max.z).toBeCloseTo(0, 6);
    expect(geometry(ctx, id).bounds.min.z).toBeCloseTo(-50, 6);

    // No copy any more: the body itself moves and the record of the copy goes.
    ctx.store.execute(updateFeature<MoveFeature>(copy.id!, { copy: false }));
    await compute(ctx);
    expect(Object.keys(ctx.store.document.bodies)).toEqual([p.bodyId]);
    expect(geometry(ctx, p.bodyId).bounds.max.x).toBeCloseTo(100, 6);
  });
});

describe("align", () => {
  it("brings two faces into contact", async () => {
    const ctx = context();
    const fixed = block(ctx, { x: 0, y: 0 }, { x: 40, y: 40 }, "10");
    const loose = block(ctx, { x: 100, y: 0 }, { x: 110, y: 20 }, "30");
    await compute(ctx);
    // The top of the loose block goes onto the side face at x = 40 of the fixed one.
    const from = makeFaceRef(
      body(ctx, loose.bodyId),
      faceAt(geometry(ctx, loose.bodyId), { x: 105, y: 10, z: 30 }),
    )!;
    const to = makeFaceRef(
      body(ctx, fixed.bodyId),
      faceAt(geometry(ctx, fixed.bodyId), { x: 40, y: 20, z: 5 }),
    )!;
    const a: CreatedRef = {};
    ctx.store.execute(
      addAlign({ mode: "face-to-face", bodyId: loose.bodyId, from, to: { bodyId: fixed.bodyId, ref: to } }, a),
    );
    expect(ctx.store.document.features[a.id!]!.name).toBe("Align001");
    await compute(ctx);
    const moved = body(ctx, loose.bodyId);
    expect(moved.geometry.volume).toBeCloseTo(6000, 3);
    const face = moved.geometry.faces[resolveFaceRef(from, moved)!.index]!;
    expect(resolveFaceRef(from, moved)!.by).toBe("name");
    // Distance 0 and the normals opposite: the faces touch.
    expect(near(face.center, { x: 40, y: 20, z: 5 }, 1e-6)).toBe(true);
    expect(face.normal.x).toBeCloseTo(-1, 6);
    expect(moved.geometry.bounds.min.x).toBeCloseTo(40, 6);
    expect(moved.geometry.bounds.max.x).toBeCloseTo(70, 6);
    expect(geometry(ctx, fixed.bodyId).bounds.max.x).toBeCloseTo(40, 6);

    // Flipped the faces look the same way: the block lies inside the fixed one's side.
    ctx.store.execute(updateFeature(a.id!, { flip: true } as never));
    await compute(ctx);
    const flipped = body(ctx, loose.bodyId);
    const same = flipped.geometry.faces[resolveFaceRef(from, flipped)!.index]!;
    expect(near(same.center, { x: 40, y: 20, z: 5 }, 1e-6)).toBe(true);
    expect(same.normal.x).toBeCloseTo(1, 6);

    // It follows the face it is aligned with.
    ctx.store.execute(updateFeature(a.id!, { flip: false } as never));
    ctx.store.execute(updateFeature(fixed.featureId, { distance: "30" } as never));
    await compute(ctx);
    const again = body(ctx, loose.bodyId);
    expect(near(again.geometry.faces[resolveFaceRef(from, again)!.index]!.center, { x: 40, y: 20, z: 15 }, 1e-6)).toBe(true);
  });

  it("brings two points together", async () => {
    const ctx = context();
    const loose = block(ctx, { x: 100, y: 0 }, { x: 110, y: 20 }, "30");
    const s = sketch(ctx, XY, (b) => createPoint(b, { x: -10, y: 5 }).points[0]!);
    const a: CreatedRef = {};
    ctx.store.execute(
      addAlign(
        {
          mode: "point-to-point",
          bodyId: loose.bodyId,
          from: { type: "fixed", point: { x: 100, y: 0, z: 0 } },
          to: { type: "sketch-point", sketchId: s.id, entityId: s.made },
        },
        a,
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, loose.bodyId).bounds.min).toMatchObject({ x: -10, y: 5, z: 0 });
    expect(affectedFeatures(ctx.store.document, { features: [s.id] })).toEqual([s.id, a.id]);
  });
});

// -------------------------------------------------------------------- split

describe("split", () => {
  it("cuts a body in two with an origin plane", async () => {
    const ctx = context();
    const p = block(ctx, { x: -30, y: 0 }, { x: 70, y: 40 }, "10");
    const split: CreatedRef = {};
    ctx.store.execute(
      addSplit({ bodyId: p.bodyId, tool: { type: "origin-plane", plane: "YZ" } }, split),
    );
    expect(ctx.store.document.features[split.id!]!.name).toBe("Split Body001");
    const other = dynamicBodyId(split.id!, p.bodyId, 1);
    expect(split.bodyId).toBe(other);
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId, other]);
    // The body keeps the side the normal points to.
    const positive = geometry(ctx, p.bodyId);
    const negative = geometry(ctx, other);
    expect(positive.bounds.min.x).toBeCloseTo(0, 6);
    expect(negative.bounds.max.x).toBeCloseTo(0, 6);
    expect(positive.volume).toBeCloseTo(28000, 3);
    expect(negative.volume).toBeCloseTo(12000, 3);
    expect(positive.volume + negative.volume).toBeCloseTo(40000, 3);
    for (const id of [p.bodyId, other]) {
      const cut = names(ctx, id).faces.filter((n) => n.feature === split.id);
      expect(cut).toHaveLength(1);
      expect(cut[0]).toMatchObject({ role: "split", key: `${split.id}:split` });
      expect(names(ctx, id).faces.map((n) => n.key)).toContain(`${p.featureId}:end`);
    }

    // A feature on the new body.
    const edge = edgeAt(negative, { x: -30, y: 0, z: 5 });
    const fillet: CreatedRef = {};
    ctx.store.execute(
      addFillet({ bodyId: other, edges: [makeEdgeRef(body(ctx, other), edge)!], radius: "3" }, fillet),
    );
    expect(fillet.id).toBeDefined();
    await compute(ctx);
    expect(geometry(ctx, other).volume).toBeCloseTo(12000 - (9 - (Math.PI * 9) / 4) * 10, 3);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(28000, 3);
    expect(affectedFeatures(ctx.store.document, { features: [split.id!] })).toEqual([
      split.id,
      fillet.id,
    ]);
  });

  it("cuts a body with the plane of one of its own faces", async () => {
    const ctx = context();
    // An L: a plate with a block on one end. The top of the plate cuts through the block.
    const plate = block(ctx, { x: 0, y: 0 }, { x: 60, y: 40 }, "10");
    block(ctx, { x: 0, y: 0 }, { x: 20, y: 40 }, "30", { operation: "join", targets: [plate.bodyId] });
    await compute(ctx);
    const step = faceAt(geometry(ctx, plate.bodyId), { x: 40, y: 20, z: 10 });
    expect(step).toBeGreaterThanOrEqual(0);
    const ref = makeFaceRef(body(ctx, plate.bodyId), step)!;
    const split: CreatedRef = {};
    ctx.store.execute(addSplit({ bodyId: plate.bodyId, tool: { type: "face", bodyId: plate.bodyId, ref } }, split));
    await compute(ctx);
    // The face looks up: the body keeps the part above it.
    expect(geometry(ctx, plate.bodyId).volume).toBeCloseTo(20 * 40 * 20, 3);
    expect(geometry(ctx, plate.bodyId).bounds.min.z).toBeCloseTo(10, 6);
    expect(geometry(ctx, dynamicBodyId(split.id!, plate.bodyId, 1)).volume).toBeCloseTo(60 * 40 * 10, 3);
  });

  it("reports a face of the body that does not cut it", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 60, y: 40 }, "10");
    await compute(ctx);
    const top = faceAt(geometry(ctx, p.bodyId), { x: 30, y: 20, z: 10 });
    const ref = makeFaceRef(body(ctx, p.bodyId), top)!;
    const split: CreatedRef = {};
    ctx.store.execute(addSplit({ bodyId: p.bodyId, tool: { type: "face", bodyId: p.bodyId, ref } }, split));
    const result = await compute(ctx, false);
    expect(result.features[split.id!]).toMatchObject({ state: "error", message: "The plane does not cut the body." });
  });

  it("keeps one side only", async () => {
    const ctx = context();
    const p = block(ctx, { x: -30, y: 0 }, { x: 70, y: 40 }, "10");
    const split: CreatedRef = {};
    ctx.store.execute(
      addSplit({ bodyId: p.bodyId, tool: { type: "origin-plane", plane: "YZ" }, keep: "positive" }, split),
    );
    expect(split.bodyId).toBe(p.bodyId);
    let result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(28000, 3);

    ctx.store.execute(updateFeature<SplitFeature>(split.id!, { keep: "negative" }));
    result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(12000, 3);
    expect(geometry(ctx, p.bodyId).bounds.max.x).toBeCloseTo(0, 6);

    // Both again: the second body and its record appear, and go when it is one side again.
    ctx.store.execute(updateFeature<SplitFeature>(split.id!, { keep: "both" }));
    const other = dynamicBodyId(split.id!, p.bodyId, 1);
    expect(ctx.store.document.bodies[other]).toBeDefined();
    result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId, other]);
    ctx.store.execute(updateFeature<SplitFeature>(split.id!, { keep: "positive" }));
    await compute(ctx);
    expect(Object.keys(ctx.store.document.bodies)).toEqual([p.bodyId]);
  });

  it("splits with the plane of a face and reports a plane that misses", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 100, y: 40 }, "10");
    const tool = block(ctx, { x: 40, y: 60 }, { x: 60, y: 80 }, "10");
    await compute(ctx);
    const face = faceAt(geometry(ctx, tool.bodyId), { x: 60, y: 70, z: 5 });
    const split: CreatedRef = {};
    ctx.store.execute(
      addSplit(
        {
          bodyId: p.bodyId,
          tool: { type: "face", bodyId: tool.bodyId, ref: makeFaceRef(body(ctx, tool.bodyId), face)! },
        },
        split,
      ),
    );
    await compute(ctx);
    // The face looks along +X: beyond x = 60 is the positive side.
    expect(geometry(ctx, p.bodyId).bounds.min.x).toBeCloseTo(60, 6);
    expect(geometry(ctx, split.bodyId!).bounds.max.x).toBeCloseTo(60, 6);

    ctx.store.execute(
      updateFeature<SplitFeature>(split.id!, { tool: { type: "origin-plane", plane: "XZ" } }),
    );
    const missed = await compute(ctx, false);
    expect(missed.features[split.id!]).toMatchObject({
      state: "error",
      message: "The plane does not cut the body.",
    });
    // Nothing happened to the body.
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(40000, 3);
    expect(missed.bodies.map((b) => b.id)).toEqual([p.bodyId, tool.bodyId]);
  });
});

// -------------------------------------------------------------------- sweep

describe("sweep", () => {
  it("sweeps a circle along a line", async () => {
    const ctx = context();
    const profile = sketch(ctx, XY, (b) => createCircle(b, { x: 0, y: 0 }, 2).entities[0]!);
    // On the XZ plane the sketch y axis is world Z.
    const path = sketch(ctx, XZ, (b) => createLine(b, { x: 0, y: 0 }, { x: 0, y: 25 }).entities[0]!);
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 0, y: 0 })],
          path: { sketchId: path.id, entityIds: [path.made] },
        },
        sweep,
      ),
    );
    expect(ctx.store.document.features[sweep.id!]!.name).toBe("Sweep001");
    expect(ctx.store.document.bodies[sweep.bodyId!]).toMatchObject({ createdBy: sweep.id });
    await compute(ctx);
    const g = geometry(ctx, sweep.bodyId!);
    expect(g.volume).toBeCloseTo(Math.PI * 4 * 25, 4);
    expect(g.bounds.max.z).toBeCloseTo(25, 6);
    const n = names(ctx, sweep.bodyId!);
    expect(n.faces[faceAt(g, { x: 0, y: 0, z: 0 })]!.key).toBe(`${sweep.id}:start`);
    expect(n.faces[faceAt(g, { x: 0, y: 0, z: 25 })]!.key).toBe(`${sweep.id}:end`);
    for (const f of n.faces.filter((q) => q.role === "side")) {
      expect(f).toMatchObject({ sketch: profile.id, entity: profile.made });
    }
    expect(affectedFeatures(ctx.store.document, { features: [path.id] })).toEqual([path.id, sweep.id]);

    // The path gets longer: the sweep follows.
    ctx.store.execute(
      updateSketch(path.id, "Longer", (sk) =>
        editSketch(sk, (b) => {
          const line = sk.entities[path.made];
          if (line?.type !== "line") throw new Error("not a line");
          b.movePoint(line.p2, { x: 0, y: 40 });
        }),
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, sweep.bodyId!).volume).toBeCloseTo(Math.PI * 4 * 40, 4);
  });

  it("sweeps a profile along a chain of curves given in any order", async () => {
    const ctx = context();
    const profile = sketch(ctx, XY, (b) => createRectangle2Point(b, { x: -2, y: -1 }, { x: 2, y: 1 }).entities);
    const path = sketch(ctx, XZ, (b) => {
      // A quarter turn from straight up to straight along +X, then on in that direction.
      const arc = createArcCenter(b, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, false);
      const line = createLine(b, arc.points[2]!, { x: 30, y: 10 });
      return { arc: arc.entities[0]!, line: line.entities[0]! };
    });
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 0, y: 0 })],
          path: { sketchId: path.id, entityIds: [path.made.line, path.made.arc] },
        },
        sweep,
      ),
    );
    await compute(ctx);
    const g = geometry(ctx, sweep.bodyId!);
    // Pappus: the centroid of the rectangle runs along the path.
    expect(g.volume).toBeCloseTo(8 * ((Math.PI / 2) * 10 + 20), 3);
    expect(g.bounds.max.x).toBeCloseTo(30, 5);
    const n = names(ctx, sweep.bodyId!);
    expect(n.faces[faceAt(g, { x: 0, y: 0, z: 0 })]!.role).toBe("start");
    expect(n.faces[faceAt(g, { x: 30, y: 0, z: 10 })]!.role).toBe("end");
    // Every side face comes from one line of the rectangle, on the arc as on the line.
    const sides = n.faces.filter((f) => f.role === "side");
    expect(sides).toHaveLength(8);
    expect(new Set(sides.map((f) => f.entity))).toEqual(new Set(profile.made));
    // The line y = 1 of the profile (its third) makes the faces at world y = 1.
    g.faces.forEach((f, i) => {
      if (n.faces[i]!.role === "side" && Math.abs(f.normal.y - 1) < 1e-6) {
        expect(n.faces[i]!.entity).toBe(profile.made[2]);
      }
    });
    expect(new Set(n.faces.map((f) => f.key)).size).toBe(n.faces.length);
  });

  it("sweeps along a spline", async () => {
    const ctx = context();
    const profile = sketch(ctx, XY, (b) => createCircle(b, { x: 0, y: 0 }, 1.5).entities[0]!);
    const path = sketch(ctx, XZ, (b) =>
      createSpline(b, "control", [
        { x: 0, y: 0 },
        { x: 0, y: 15 },
        { x: 20, y: 15 },
        { x: 20, y: 30 },
      ]).entities[0]!,
    );
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 0, y: 0 })],
          path: { sketchId: path.id, entityIds: [path.made] },
        },
        sweep,
      ),
    );
    await compute(ctx);
    const g = geometry(ctx, sweep.bodyId!);
    expect(g.bounds.max.z).toBeCloseTo(30, 4);
    expect(g.volume).toBeGreaterThan(Math.PI * 2.25 * Math.hypot(20, 30));
    expect(g.volume).toBeLessThan(Math.PI * 2.25 * 50);
    const n = names(ctx, sweep.bodyId!);
    expect(n.faces.filter((f) => f.role === "start")).toHaveLength(1);
    expect(n.faces.filter((f) => f.role === "end")).toHaveLength(1);
    for (const f of n.faces.filter((q) => q.role === "side")) expect(f.entity).toBe(profile.made);
  });

  it("cuts with a sweep", async () => {
    const ctx = context();
    const p = block(ctx, { x: 0, y: 0 }, { x: 100, y: 80 }, "50");
    const profile = sketch(ctx, XY, (b) => createCircle(b, { x: 50, y: 40 }, 2).entities[0]!);
    const path = sketch(ctx, XZ, (b) => createLine(b, { x: 50, y: 0 }, { x: 50, y: 50 }).entities[0]!);
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 50, y: 40 })],
          path: { sketchId: path.id, entityIds: [path.made] },
          operation: "cut",
          targetBodyIds: [p.bodyId],
        },
        sweep,
      ),
    );
    expect(sweep.bodyId).toBe("");
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(400000 - Math.PI * 4 * 50, 3);
    const made = names(ctx, p.bodyId).faces.filter((n) => n.feature === sweep.id);
    expect(made.length).toBeGreaterThan(0);
    for (const n of made) expect(n).toMatchObject({ role: "side", entity: profile.made });

    // As a body of its own instead.
    ctx.store.execute(updateFeature(sweep.id!, { operation: "new" } as never));
    const bodyId = (ctx.store.document.features[sweep.id!] as { bodyId: string }).bodyId;
    expect(ctx.store.document.bodies[bodyId]).toMatchObject({ createdBy: sweep.id });
    await compute(ctx);
    expect(geometry(ctx, bodyId).volume).toBeCloseTo(Math.PI * 4 * 50, 3);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(400000, 3);
  });

  it("reports a path that is not a chain", async () => {
    const ctx = context();
    const profile = sketch(ctx, XY, (b) => createCircle(b, { x: 0, y: 0 }, 2).entities[0]!);
    const path = sketch(ctx, XZ, (b) => {
      const a = createLine(b, { x: 0, y: 0 }, { x: 0, y: 10 });
      const gap = createLine(b, { x: 5, y: 12 }, { x: 5, y: 20 });
      const left = createLine(b, a.points[1]!, { x: -10, y: 20 });
      const right = createLine(b, a.points[1]!, { x: 10, y: 20 });
      return { a: a.entities[0]!, gap: gap.entities[0]!, left: left.entities[0]!, right: right.entities[0]! };
    });
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 0, y: 0 })],
          path: { sketchId: path.id, entityIds: [path.made.a, path.made.gap] },
        },
        sweep,
      ),
    );
    let result = await compute(ctx, false);
    expect(result.features[sweep.id!]!.message).toMatch(/not connected/);
    expect(result.bodies).toHaveLength(0);

    ctx.store.execute(
      updateFeature(sweep.id!, {
        path: { sketchId: path.id, entityIds: [path.made.a, path.made.left, path.made.right] },
      } as never),
    );
    result = await compute(ctx, false);
    expect(result.features[sweep.id!]!.message).toMatch(/branches/);
  });
});

// --------------------------------------------------------------------- loft

describe("loft", () => {
  const prismatoid = (h: number, a1: number, am: number, a2: number): number =>
    (h / 6) * (a1 + 4 * am + a2);

  it("lofts a rectangle to a smaller one on a parallel plane", async () => {
    const ctx = context();
    const a = sketch(ctx, XY, (b) => createRectangle2Point(b, { x: -10, y: -5 }, { x: 10, y: 5 }).entities);
    const c = sketch(ctx, planeAt(30), (b) =>
      createRectangle2Point(b, { x: -5, y: -2.5 }, { x: 5, y: 2.5 }).entities,
    );
    const loft: CreatedRef = {};
    ctx.store.execute(
      addLoft(
        {
          sections: [
            { type: "profile", sketchId: a.id, profile: profileAt(ctx, a.id, { x: 0, y: 0 }) },
            { type: "profile", sketchId: c.id, profile: profileAt(ctx, c.id, { x: 0, y: 0 }) },
          ],
        },
        loft,
      ),
    );
    expect(ctx.store.document.features[loft.id!]!.name).toBe("Loft001");
    await compute(ctx);
    const g = geometry(ctx, loft.bodyId!);
    expect(g.volume).toBeCloseTo(prismatoid(30, 200, 15 * 7.5, 50), 3);
    const n = names(ctx, loft.bodyId!);
    expect(n.faces[faceAt(g, { x: 0, y: 0, z: 0 })]!.key).toBe(`${loft.id}:start`);
    expect(n.faces[faceAt(g, { x: 0, y: 0, z: 30 })]!.key).toBe(`${loft.id}:end`);
    // The sides are named after the lines of the first section.
    const sides = n.faces.filter((f) => f.role === "side");
    expect(sides.map((f) => f.key).sort()).toEqual(
      a.made.map((l) => `${loft.id}:side(${a.id}/${l})`).sort(),
    );
    expect(affectedFeatures(ctx.store.document, { features: [c.id] })).toEqual([c.id, loft.id]);

    // The names stay when a section changes its size.
    ctx.store.execute(
      updateSketch(c.id, "Smaller", (sk) =>
        editSketch(sk, (b) => {
          for (const e of Object.values(sk.entities)) {
            if (e.type === "point" && e.id !== sk.originId) b.movePoint(e.id, { x: e.x * 0.4, y: e.y * 0.4 });
          }
        }),
      ),
    );
    await compute(ctx);
    expect(geometry(ctx, loft.bodyId!).volume).toBeCloseTo(prismatoid(30, 200, 12 * 6, 8), 3);
    expect(names(ctx, loft.bodyId!).faces.map((f) => f.key).sort()).toEqual(
      n.faces.map((f) => f.key).sort(),
    );
  });

  it("lofts through three sections", async () => {
    const ctx = context();
    const rectangle = (z: number, w: number, h: number): { id: string; made: string[] } =>
      sketch(ctx, z === 0 ? XY : planeAt(z), (b) =>
        createRectangle2Point(b, { x: -w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }).entities,
      );
    const s = [rectangle(0, 20, 10), rectangle(30, 10, 5), rectangle(60, 20, 10)];
    const loft: CreatedRef = {};
    ctx.store.execute(
      addLoft(
        {
          sections: s.map((q) => ({
            type: "profile" as const,
            sketchId: q.id,
            profile: profileAt(ctx, q.id, { x: 0, y: 0 }),
          })),
          ruled: true,
        },
        loft,
      ),
    );
    await compute(ctx);
    const g = geometry(ctx, loft.bodyId!);
    expect(g.volume).toBeCloseTo(2 * prismatoid(30, 200, 15 * 7.5, 50), 3);
    expect(g.bounds.max.z).toBeCloseTo(60, 6);
    const n = names(ctx, loft.bodyId!);
    expect(new Set(n.faces.map((f) => f.key)).size).toBe(n.faces.length);
    expect(n.faces.filter((f) => f.role === "start")).toHaveLength(1);
    expect(n.faces.filter((f) => f.role === "end")).toHaveLength(1);
    // Below the middle section the sides start at the first section, above it at the second.
    g.faces.forEach((f, i) => {
      if (n.faces[i]!.role !== "side") return;
      expect(n.faces[i]!.sketch).toBe(f.center.z < 30 ? s[0]!.id : s[1]!.id);
    });

    // Smooth: one surface per side through all three sections, and less volume in the waist.
    ctx.store.execute(updateFeature(loft.id!, { ruled: false } as never));
    await compute(ctx);
    const smooth = geometry(ctx, loft.bodyId!);
    expect(smooth.faces).toHaveLength(6);
    expect(smooth.volume).toBeLessThan(g.volume);
    expect(smooth.volume).toBeGreaterThan(60 * 50);
  });

  it("joins a loft that starts on a face of the body", async () => {
    const ctx = context();
    const p = block(ctx, { x: -10, y: -5 }, { x: 10, y: 5 }, "10");
    await compute(ctx);
    const top = makeFaceRef(body(ctx, p.bodyId), faceAt(geometry(ctx, p.bodyId), { x: 0, y: 0, z: 10 }))!;
    const c = sketch(ctx, planeAt(40), (b) =>
      createRectangle2Point(b, { x: -5, y: -2.5 }, { x: 5, y: 2.5 }).entities,
    );
    const loft: CreatedRef = {};
    ctx.store.execute(
      addLoft(
        {
          sections: [
            { type: "face", bodyId: p.bodyId, ref: top },
            { type: "profile", sketchId: c.id, profile: profileAt(ctx, c.id, { x: 0, y: 0 }) },
          ],
          operation: "join",
          targetBodyIds: [p.bodyId],
        },
        loft,
      ),
    );
    const result = await compute(ctx);
    expect(result.bodies.map((b) => b.id)).toEqual([p.bodyId]);
    const g = geometry(ctx, p.bodyId);
    expect(g.volume).toBeCloseTo(2000 + prismatoid(30, 200, 15 * 7.5, 50), 3);
    expect(g.bounds.max.z).toBeCloseTo(40, 6);
    const n = names(ctx, p.bodyId);
    expect(n.faces.map((f) => f.key)).toContain(`${loft.id}:end`);
    expect(n.faces.map((f) => f.key)).toContain(`${p.featureId}:start`);
    expect(new Set(n.faces.map((f) => f.key)).size).toBe(n.faces.length);
    expect(affectedFeatures(ctx.store.document, { features: [p.featureId] })).toEqual([
      p.featureId,
      loft.id,
    ]);

    // The section follows the face: a higher block lifts the foot of the loft.
    ctx.store.execute(updateFeature(p.featureId, { distance: "25" } as never));
    await compute(ctx);
    expect(geometry(ctx, p.bodyId).volume).toBeCloseTo(5000 + prismatoid(15, 200, 15 * 7.5, 50), 3);
  });
});

// ------------------------------------------ history, undo / redo, save / load

describe("history", () => {
  /** A document with one feature of every new kind. */
  async function everything(): Promise<{ ctx: Ctx; ids: Record<string, string> }> {
    const ctx = context();
    run(ctx, addParameter({ name: "n", expression: "3", unit: "" }));
    run(ctx, addParameter({ name: "pitch", expression: "25", unit: "mm" }));
    run(ctx, addParameter({ name: "bolt", expression: "6", unit: "mm" }));
    const ids: Record<string, string> = {};
    const out = (key: string): CreatedRef => {
      const ref: CreatedRef = {};
      Object.defineProperty(ref, "id", {
        set: (v: string) => {
          ids[key] = v;
        },
        get: () => ids[key],
      });
      return ref;
    };

    const plate = block(ctx, { x: -50, y: -40 }, { x: 50, y: 40 }, "10");
    ids.plate = plate.bodyId;
    ids.plateFeature = plate.featureId;
    const points = sketch(ctx, XY, (b) => createPoint(b, { x: -40, y: -30 }).points[0]!);
    ctx.store.execute(
      addHole(
        {
          bodyId: plate.bodyId,
          sketchId: points.id,
          points: [points.made],
          holeType: "counterbore",
          diameter: "bolt",
          counterboreDiameter: "bolt * 2",
          counterboreDepth: "3",
        },
        out("hole"),
      ),
    );
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [ids.hole!] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "pitch",
        },
        out("rectangular"),
      ),
    );
    const centre = sketch(ctx, XY, (b) => createPoint(b, { x: 20, y: 0 }).points[0]!);
    ctx.store.execute(
      addHole(
        { bodyId: plate.bodyId, sketchId: centre.id, points: [centre.made], diameter: "4" },
        out("hole2"),
      ),
    );
    ctx.store.execute(
      addCircularPattern(
        {
          source: { kind: "features", featureIds: [ids.hole2!] },
          axis: { type: "origin-axis", axis: "Z" },
          count: "n + 1",
        },
        out("circular"),
      ),
    );
    ctx.store.execute(
      addMirror(
        {
          source: { kind: "features", featureIds: [ids.hole!] },
          plane: { type: "origin-plane", plane: "XZ" },
        },
        out("mirror"),
      ),
    );

    const post = block(ctx, { x: 100, y: 0 }, { x: 110, y: 10 }, "20");
    ids.post = post.bodyId;
    ctx.store.execute(
      addMove(
        { bodyIds: [post.bodyId], copy: true, transform: { type: "translate", x: "pitch", y: "0", z: "0" } },
        out("move"),
      ),
    );
    ids.copy = dynamicBodyId(ids.move!, post.bodyId, 1);
    ctx.store.execute(
      addAlign(
        {
          mode: "point-to-point",
          bodyId: post.bodyId,
          from: { type: "fixed", point: { x: 100, y: 0, z: 0 } },
          to: { type: "fixed", point: { x: 100, y: 50, z: 0 } },
        },
        out("align"),
      ),
    );
    ctx.store.execute(
      addSplit({ bodyId: ids.copy, tool: { type: "origin-plane", plane: "XY" } }, out("split")),
    );
    // The copy stands on the XY plane: the plane misses it. Move it down first.
    ctx.store.execute(
      updateFeature<MoveFeature>(ids.move!, {
        transform: { type: "translate", x: "pitch", y: "0", z: "-5" },
      }),
    );
    ids.half = dynamicBodyId(ids.split!, ids.copy, 1);

    const profile = sketch(ctx, XY, (b) => createCircle(b, { x: 0, y: 100 }, 2).entities[0]!);
    const path = sketch(ctx, XZ, (b) => createLine(b, { x: 0, y: 0 }, { x: 0, y: 25 }).entities[0]!);
    const sweep: CreatedRef = {};
    ctx.store.execute(
      addSweep(
        {
          sketchId: profile.id,
          profiles: [profileAt(ctx, profile.id, { x: 0, y: 100 })],
          path: { sketchId: path.id, entityIds: [path.made] },
        },
        sweep,
      ),
    );
    ids.sweep = sweep.id!;
    ids.swept = sweep.bodyId!;

    const low = sketch(ctx, XY, (b) => createRectangle2Point(b, { x: 200, y: 0 }, { x: 220, y: 10 }).entities);
    const high = sketch(ctx, planeAt(30), (b) =>
      createRectangle2Point(b, { x: 205, y: 2.5 }, { x: 215, y: 7.5 }).entities,
    );
    const loft: CreatedRef = {};
    ctx.store.execute(
      addLoft(
        {
          sections: [
            { type: "profile", sketchId: low.id, profile: profileAt(ctx, low.id, { x: 210, y: 5 }) },
            { type: "profile", sketchId: high.id, profile: profileAt(ctx, high.id, { x: 210, y: 5 }) },
          ],
        },
        loft,
      ),
    );
    ids.loft = loft.id!;
    ids.lofted = loft.bodyId!;
    ctx.store.execute(
      addRectangularPattern(
        {
          source: { kind: "bodies", bodyIds: [ids.lofted] },
          direction: { type: "origin-axis", axis: "Y" },
          count: "n",
          distance: "pitch",
        },
        out("bodies"),
      ),
    );
    await compute(ctx);
    return { ctx, ids };
  }

  const volumes = (ctx: Ctx): Record<string, number> =>
    Object.fromEntries(
      ctx.engine.bodyIds().map((id) => [id, Math.round(geometry(ctx, id).volume * 1e4) / 1e4]),
    );

  it("evaluates a document with every new feature", async () => {
    const { ctx, ids } = await everything();
    const types = new Set(Object.values(ctx.store.document.features).map((f) => f.type));
    for (const t of [
      "hole",
      "rectangular-pattern",
      "circular-pattern",
      "mirror",
      "move",
      "align",
      "split",
      "sweep",
      "loft",
    ]) {
      expect(types.has(t as never), t).toBe(true);
    }
    const bore = circleArea(6) * 10 + (circleArea(12) - circleArea(6)) * 3;
    // Three counterbored holes in a row, the first one mirrored, four holes on a circle.
    expect(geometry(ctx, ids.plate!).volume).toBeCloseTo(80000 - 4 * bore - 4 * circleArea(4) * 10, 2);
    expect(geometry(ctx, ids.post!).bounds.min).toMatchObject({ x: 100, y: 50, z: 0 });
    expect(geometry(ctx, ids.copy!).volume).toBeCloseTo(1500, 3);
    expect(geometry(ctx, ids.half!).volume).toBeCloseTo(500, 3);
    expect(Object.keys(ctx.store.document.bodies).sort()).toEqual(ctx.engine.bodyIds().sort());
    expect(ctx.engine.bodyIds()).toContain(dynamicBodyId(ids.bodies!, ids.lofted!, 2));
  });

  it("marks what a parameter of a pattern affects", async () => {
    const { ctx, ids } = await everything();
    const doc = ctx.store.document;
    // `n` is the count of three patterns; the mirror and the second hole work on the plate
    // after the first pattern changed it.
    const affected = affectedFeatures(doc, { parameters: ["n"] });
    expect(affected).toEqual(
      doc.timeline.filter((id) =>
        [ids.rectangular, ids.hole2, ids.circular, ids.mirror, ids.bodies].includes(id),
      ),
    );
    expect(affectedFeatures(doc, { parameters: ["bolt"] })).toEqual(
      doc.timeline.filter((id) =>
        [ids.hole, ids.rectangular, ids.hole2, ids.circular, ids.mirror].includes(id),
      ),
    );
    // The split works on the copy, which only its id connects with the move.
    expect(affectedFeatures(doc, { features: [ids.move!] })).toEqual([ids.move, ids.split]);

    setParameter(ctx, "n", "4");
    await compute(ctx);
    expect(ctx.engine.lastEvaluated).toEqual(affectedFeatures(ctx.store.document, { parameters: ["n"] }));
    expect(ctx.engine.bodyIds()).toContain(dynamicBodyId(ids.bodies!, ids.lofted!, 3));
  });

  it("undoes and redoes", async () => {
    const { ctx, ids } = await everything();
    const built = ctx.store.document;
    const before = volumes(ctx);

    setParameter(ctx, "n", "5");
    ctx.store.execute(updateFeature<RectangularPatternFeature>(ids.rectangular!, { distance: "12" }));
    await compute(ctx);
    const changed = volumes(ctx);
    expect(changed).not.toEqual(before);
    expect(Object.keys(changed).length).toBe(Object.keys(before).length + 2);
    const edited = ctx.store.document;

    expect(ctx.store.undo()).toBe(true);
    expect(ctx.store.undo()).toBe(true);
    expect(ctx.store.document).toBe(built);
    await compute(ctx);
    expect(volumes(ctx)).toEqual(before);
    expect(Object.keys(ctx.store.document.bodies).sort()).toEqual(Object.keys(before).sort());

    expect(ctx.store.redo()).toBe(true);
    expect(ctx.store.redo()).toBe(true);
    expect(ctx.store.document).toBe(edited);
    await compute(ctx);
    expect(volumes(ctx)).toEqual(changed);

    // Undo back to before the first new feature: no body of theirs is left behind.
    while (ctx.store.canUndo) ctx.store.undo();
    await compute(ctx);
    expect(ctx.engine.bodyIds()).toEqual([]);
    expect(ctx.store.document.bodies).toEqual({});
  });

  it("saves and loads", async () => {
    const { ctx } = await everything();
    const loaded = deserializeDocument(serializeDocument(ctx.store.document));
    expect(loaded).toEqual(ctx.store.document);
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(loaded);
    for (const f of Object.values(result.features)) expect(f.state, f.message).toBe("ok");
    const again = Object.fromEntries(
      engine.bodyIds().map((id) => [id, Math.round(engine.bodyGeometry(id)!.volume * 1e4) / 1e4]),
    );
    expect(again).toEqual(volumes(ctx));
    // Every body has its record: nothing is left for the application to add.
    expect(result.bodies.every((b) => b.record === undefined)).toBe(true);
    for (const id of engine.bodyIds()) {
      expect(engine.bodyNames(id)).toEqual(ctx.engine.bodyNames(id));
    }
  });
});
