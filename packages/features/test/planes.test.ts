import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import {
  type CreatedRef,
  DocumentStore,
  type OffsetPlaneFeature,
  type SketchFeature,
  addExtrude,
  addMirror,
  addOffsetPlane,
  addParameter,
  addSketch,
  addSplit,
  affectedFeatures,
  createDocument,
  deserializeDocument,
  featureInputPlanes,
  removeFeatures,
  serializeDocument,
  setFeatureSuppressed,
  setPlaneVisible,
  updateFeature,
  updateParameter,
  updateSketch,
} from "@fabcad/cad-document";
import type { Vec3 } from "@fabcad/geometry";
import {
  type Sketch,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../brep/test/nodeKernel";
import {
  FeatureEngine,
  type RecomputeResult,
  makeFaceRef,
  offsetPlanePatch,
  originPlanePatch,
  resolveSketchPlane,
  solveSketchWithParameters,
} from "../src";

let kernel: GeometryKernel;
const solver = createDefaultSolver();

beforeAll(async () => {
  kernel = await nodeKernel();
});

const near = (a: Vec3, b: Vec3): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

const planeOf = (result: RecomputeResult, id: string) => result.planes.find((p) => p.id === id);

function rectangleSketch(store: DocumentStore, sketchId: string, w: number, h: number): void {
  store.execute(
    updateSketch(sketchId, "Draw", (sketch: Sketch) => {
      const drawn = editSketch(sketch, (b) => {
        createRectangle2Point(b, { x: 0, y: 0 }, { x: w, y: h });
      });
      const info = solveSketchWithParameters(drawn, solver, () => undefined);
      expect(info.converged).toBe(true);
      return info.sketch;
    }),
  );
}

/** A 100 × 80 × 50 box on the XY plane. */
function box(store: DocumentStore): { sketchId: string; extrudeId: string; bodyId: string } {
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  rectangleSketch(store, s.id!, 100, 80);
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const region = regionAtPoint(detectProfiles(sketch), { x: 10, y: 10 })!;
  const e: CreatedRef = {};
  store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "50" }, e));
  return { sketchId: s.id!, extrudeId: e.id!, bodyId: e.bodyId! };
}

describe("plane patches", () => {
  it("moves a patch along the normal, in both directions", () => {
    const base = originPlanePatch("XZ");
    // The normal of the front plane is -Y.
    near(offsetPlanePatch(base, 12).plane.origin, { x: 0, y: -12, z: 0 });
    near(offsetPlanePatch(base, -12).plane.origin, { x: 0, y: 12, z: 0 });
    const moved = offsetPlanePatch(base, 12);
    expect(moved.plane.xDir).toEqual(base.plane.xDir);
    expect(moved.plane.yDir).toEqual(base.plane.yDir);
    expect(moved.size).toBe(base.size);
    near(moved.center, { x: base.center.x, y: base.center.y - 12, z: base.center.z });
  });
});

describe("offset plane: document", () => {
  it("is a feature of the timeline with an expression", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedRef = {};
    expect(
      store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "25" }, out)),
    ).toBe(true);
    const f = store.document.features[out.id!] as OffsetPlaneFeature;
    expect(f).toMatchObject({
      type: "offset-plane",
      name: "Plane001",
      offset: "25",
      visible: true,
      suppressed: false,
      base: { type: "origin-plane", plane: "XY" },
    });
    expect(store.document.timeline).toEqual([out.id]);
  });

  it("undoes and redoes creation, edits and visibility", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "25" }, out));
    store.execute(updateFeature<OffsetPlaneFeature>(out.id!, { offset: "-7.5" }, "Edit offset plane"));
    store.execute(setPlaneVisible(out.id!, false));
    const plane = (): OffsetPlaneFeature | undefined =>
      store.document.features[out.id!] as OffsetPlaneFeature | undefined;
    expect(plane()).toMatchObject({ offset: "-7.5", visible: false });
    store.undo();
    expect(plane()).toMatchObject({ offset: "-7.5", visible: true });
    store.undo();
    expect(plane()).toMatchObject({ offset: "25" });
    store.undo();
    expect(plane()).toBeUndefined();
    expect(store.document.timeline).toEqual([]);
    store.redo();
    store.redo();
    expect(plane()).toMatchObject({ offset: "-7.5", visible: true });
  });

  it("refuses a base that does not exist", () => {
    const store = new DocumentStore(createDocument());
    expect(
      store.execute(addOffsetPlane({ base: { type: "plane", featureId: "nope" }, offset: "1" })),
    ).toBe(false);
    expect(
      store.execute(
        addOffsetPlane({
          base: { type: "face", bodyId: "nope", ref: { kind: "face", point: { x: 0, y: 0, z: 0 } } },
          offset: "1",
        }),
      ),
    ).toBe(false);
  });

  it("survives saving and loading", () => {
    const store = new DocumentStore(createDocument("Planes"));
    const a: CreatedRef = {};
    const b: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "YZ" }, offset: "h / 2" }, a));
    store.execute(addOffsetPlane({ base: { type: "plane", featureId: a.id! }, offset: "-3" }, b));
    store.execute(setPlaneVisible(b.id!, false));
    const s: CreatedRef = {};
    store.execute(
      addSketch(
        { type: "plane", featureId: b.id!, plane: offsetPlanePatch(originPlanePatch("YZ"), 9).plane },
        s,
      ),
    );
    const loaded = deserializeDocument(serializeDocument(store.document));
    expect(loaded.features).toEqual(store.document.features);
    expect(loaded.timeline).toEqual(store.document.timeline);
    expect((loaded.features[b.id!] as OffsetPlaneFeature).visible).toBe(false);
  });

  it("knows what depends on a plane", () => {
    const store = new DocumentStore(createDocument());
    store.execute(addParameter({ name: "h", expression: "30", unit: "mm" }));
    const a: CreatedRef = {};
    const b: CreatedRef = {};
    const s: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "h" }, a));
    store.execute(addOffsetPlane({ base: { type: "plane", featureId: a.id! }, offset: "5" }, b));
    store.execute(
      addSketch(
        { type: "plane", featureId: b.id!, plane: offsetPlanePatch(originPlanePatch("XY"), 35).plane },
        s,
      ),
    );
    const doc = store.document;
    expect(featureInputPlanes(doc.features[b.id!]!)).toEqual([a.id]);
    expect(featureInputPlanes(doc.features[s.id!]!)).toEqual([b.id]);
    expect(affectedFeatures(doc, { parameters: ["h"] })).toEqual([a.id, b.id, s.id]);
    expect(affectedFeatures(doc, { features: [b.id!] })).toEqual([b.id, s.id]);
  });
});

describe("offset plane: engine", () => {
  it("offsets an origin plane, to either side", async () => {
    const store = new DocumentStore(createDocument());
    const up: CreatedRef = {};
    const down: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "40" }, up));
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "-15" }, down));
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);
    expect(result.features[up.id!]!.state).toBe("ok");
    near(planeOf(result, up.id!)!.plane.origin, { x: 0, y: 0, z: 40 });
    near(planeOf(result, up.id!)!.plane.normal, { x: 0, y: 0, z: 1 });
    near(planeOf(result, down.id!)!.plane.origin, { x: 0, y: 0, z: -15 });
  });

  it("follows a parameter and an edited offset", async () => {
    const store = new DocumentStore(createDocument());
    store.execute(addParameter({ name: "h", expression: "30", unit: "mm" }));
    const p: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "h + 2" }, p));
    const engine = new FeatureEngine(kernel, solver);
    near(planeOf(await engine.recompute(store.document), p.id!)!.plane.origin, { x: 0, y: 0, z: 32 });
    store.execute(updateParameter(store.document.parameters[0]!.id, { expression: "10" }));
    near(planeOf(await engine.recompute(store.document), p.id!)!.plane.origin, { x: 0, y: 0, z: 12 });
    store.execute(updateFeature<OffsetPlaneFeature>(p.id!, { offset: "-4" }));
    near(planeOf(await engine.recompute(store.document), p.id!)!.plane.origin, { x: 0, y: 0, z: -4 });
  });

  it("reports an offset that cannot be evaluated", async () => {
    const store = new DocumentStore(createDocument());
    const p: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "missing * 2" }, p));
    const result = await new FeatureEngine(kernel, solver).recompute(store.document);
    expect(result.features[p.id!]!.state).toBe("error");
    expect(planeOf(result, p.id!)).toBeUndefined();
  });

  it("offsets the face of a body along its outward normal and follows the body", async () => {
    const store = new DocumentStore(createDocument());
    const { extrudeId, bodyId } = box(store);
    const engine = new FeatureEngine(kernel, solver);
    await engine.recompute(store.document);
    const body = { geometry: engine.bodyGeometry(bodyId)!, names: engine.bodyNames(bodyId)! };
    const top = body.geometry.faces.findIndex((f) => f.normal.z > 0.9);
    const ref = makeFaceRef(body, top)!;
    const p: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "face", bodyId, ref }, offset: "10" }, p));

    let result = await engine.recompute(store.document);
    expect(result.features[p.id!]!.state).toBe("ok");
    let plane = planeOf(result, p.id!)!;
    near(plane.plane.normal, { x: 0, y: 0, z: 1 });
    expect(plane.plane.origin.z).toBeCloseTo(60, 6);
    // The patch lies over the face it is measured from.
    near(plane.center, { x: 50, y: 40, z: 60 });
    expect(plane.size).toBeGreaterThanOrEqual(100);

    store.execute(updateFeature(extrudeId, { distance: "70" }));
    result = await engine.recompute(store.document);
    plane = planeOf(result, p.id!)!;
    expect(plane.plane.origin.z).toBeCloseTo(80, 6);
  });

  it("chains planes, and says so when the base is gone", async () => {
    const store = new DocumentStore(createDocument());
    const a: CreatedRef = {};
    const b: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XZ" }, offset: "10" }, a));
    store.execute(addOffsetPlane({ base: { type: "plane", featureId: a.id! }, offset: "5" }, b));
    const engine = new FeatureEngine(kernel, solver);
    let result = await engine.recompute(store.document);
    near(planeOf(result, b.id!)!.plane.origin, { x: 0, y: -15, z: 0 });

    store.execute(setFeatureSuppressed(a.id!, true));
    result = await engine.recompute(store.document);
    expect(result.features[a.id!]!.state).toBe("suppressed");
    expect(result.features[b.id!]!.state).toBe("error");
    expect(result.features[b.id!]!.message).toMatch(/plane/i);
    expect(result.planes).toHaveLength(0);

    store.execute(setFeatureSuppressed(a.id!, false));
    store.execute(removeFeatures([a.id!]));
    result = await engine.recompute(store.document);
    expect(result.features[b.id!]!.state).toBe("error");
  });

  it("carries a sketch that is drawn on it, and the body made from the sketch", async () => {
    const store = new DocumentStore(createDocument());
    const p: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "20" }, p));
    const engine = new FeatureEngine(kernel, solver);
    let result = await engine.recompute(store.document);
    const s: CreatedRef = {};
    store.execute(
      addSketch({ type: "plane", featureId: p.id!, plane: planeOf(result, p.id!)!.plane }, s),
    );
    rectangleSketch(store, s.id!, 30, 20);
    const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
    const region = regionAtPoint(detectProfiles(sketch), { x: 5, y: 5 })!;
    const e: CreatedRef = {};
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "10" }, e));

    result = await engine.recompute(store.document);
    expect(result.features[e.id!]!.state).toBe("ok");
    expect(result.sketchUpdates[s.id!]).toBeUndefined();
    let bounds = engine.bodyGeometry(e.bodyId!)!.bounds;
    expect(bounds.min.z).toBeCloseTo(20, 6);
    expect(bounds.max.z).toBeCloseTo(30, 6);

    // Moving the plane moves the sketch, and the sketch is written back to the document.
    store.execute(updateFeature<OffsetPlaneFeature>(p.id!, { offset: "-50" }));
    result = await engine.recompute(store.document);
    const moved = result.sketchUpdates[s.id!];
    expect(moved?.plane.type).toBe("plane");
    near(resolveSketchPlane(moved!.plane).origin, { x: 0, y: 0, z: -50 });
    bounds = engine.bodyGeometry(e.bodyId!)!.bounds;
    expect(bounds.min.z).toBeCloseTo(-50, 6);
    expect(bounds.max.z).toBeCloseTo(-40, 6);
  });

  it("serves as the plane of a mirror and of a split", async () => {
    const store = new DocumentStore(createDocument());
    const { bodyId } = box(store);
    const p: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "YZ" }, offset: "-10" }, p));
    const m: CreatedRef = {};
    store.execute(
      addMirror(
        { source: { kind: "bodies", bodyIds: [bodyId] }, plane: { type: "plane", featureId: p.id! } },
        m,
      ),
    );
    const cut: CreatedRef = {};
    store.execute(addOffsetPlane({ base: { type: "origin-plane", plane: "XY" }, offset: "20" }, cut));
    const split: CreatedRef = {};
    store.execute(
      addSplit({ bodyId, tool: { type: "plane", featureId: cut.id! }, keep: "positive" }, split),
    );
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);
    expect(result.features[m.id!]!.state).toBe("ok");
    expect(result.features[split.id!]!.state).toBe("ok");
    // The box spans x 0 … 100; mirrored across x = -10 it spans -120 … -20.
    const mirrored = engine.bodyGeometry(m.bodyId!)!.bounds;
    expect(mirrored.min.x).toBeCloseTo(-120, 5);
    expect(mirrored.max.x).toBeCloseTo(-20, 5);
    // What is kept of the box lies above the plane at z = 20.
    const kept = engine.bodyGeometry(bodyId)!.bounds;
    expect(kept.min.z).toBeCloseTo(20, 5);
    expect(kept.max.z).toBeCloseTo(50, 5);

    // The features that use a plane follow it.
    store.execute(updateFeature<OffsetPlaneFeature>(cut.id!, { offset: "35" }));
    await engine.recompute(store.document);
    expect(engine.bodyGeometry(bodyId)!.bounds.min.z).toBeCloseTo(35, 5);
    expect(engine.lastEvaluated).toContain(split.id);
  });
});
