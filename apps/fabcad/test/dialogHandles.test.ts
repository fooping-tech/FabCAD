import { beforeAll, describe, expect, it } from "vitest";
import type { BodyGeometry, GeometryKernel } from "@fabcad/brep";
import {
  type CadDocument,
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addCircularPattern,
  addExtrude,
  addRevolve,
  addSketch,
  createDocument,
  evaluateParameters,
  parameterScope,
  syncBodyRecords,
  updateSketch,
} from "@fabcad/cad-document";
import { FeatureEngine, makeEdgeRef, makeFaceRef } from "@fabcad/features";
import { type Vec2, type Vec3, add3, cross3, dot3, scale3 } from "@fabcad/geometry";
import {
  type SketchBuilder,
  type SketchPlaneRef,
  createPoint,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import type { Dialog } from "../src/app/appState";
import {
  type AngularHandle,
  type DialogHandle,
  type HandleContext,
  type LinearHandle,
  dialogHandles,
} from "../src/app/dialogHandles";

let kernel: GeometryKernel;
const solver = createDefaultSolver();
beforeAll(async () => {
  kernel = await nodeKernel();
});

const XY: SketchPlaneRef = { type: "origin", plane: "XY" };
const XZ: SketchPlaneRef = { type: "origin", plane: "XZ" };

function sketch<T>(store: DocumentStore, plane: SketchPlaneRef, draw: (b: SketchBuilder) => T): { id: string; made: T } {
  const s: CreatedRef = {};
  store.execute(addSketch(plane, s));
  let made: T | undefined;
  store.execute(updateSketch(s.id!, "Draw", (sk) => editSketch(sk, (b) => void (made = draw(b)))));
  return { id: s.id!, made: made as T };
}

const sketchOf = (doc: CadDocument, id: string) => (doc.features[id] as SketchFeature).sketch;
const profileAt = (doc: CadDocument, id: string, p: Vec2) =>
  profileRefOf(regionAtPoint(detectProfiles(sketchOf(doc, id)), p)!);

function block(store: DocumentStore, from: Vec2, to: Vec2, distance: string): string {
  const s = sketch(store, XY, (b) => createRectangle2Point(b, from, to));
  const e: CreatedRef = {};
  store.execute(
    addExtrude({ sketchId: s.id, profiles: [profileAt(store.document, s.id, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })], distance }, e),
  );
  return e.bodyId!;
}

async function compute(store: DocumentStore, engine: FeatureEngine): Promise<HandleContext> {
  const result = await engine.recompute(store.document);
  for (const f of Object.values(result.features)) expect(f.state, f.message).toBe("ok");
  store.amend(
    syncBodyRecords(
      result.bodies.flatMap((b) => (b.record ? [{ id: b.id, ...b.record }] : [])),
      result.bodies.map((b) => b.id),
    ),
  );
  const bodies = Object.fromEntries(
    result.bodies.map((b) => [b.id, { id: b.id, hash: "", geometry: engine.bodyGeometry(b.id)!, names: engine.bodyNames(b.id)! }]),
  );
  return { doc: store.document, bodies, planes: {}, scope: parameterScope(evaluateParameters(store.document.parameters)) };
}

const only = <T extends DialogHandle>(handles: DialogHandle[]): T => {
  expect(handles).toHaveLength(1);
  return handles[0] as T;
};
const tip = (h: LinearHandle): Vec3 => add3(h.origin, scale3(h.direction, h.factor * h.value));
/** Where the knob of a ring is, at the radius of what turns. */
const knob = (h: AngularHandle): Vec3 => {
  const a = (h.value * Math.PI) / 180;
  const r = h.radius ?? 1;
  return add3(h.center, add3(scale3(h.reference, r * Math.cos(a)), scale3(cross3(h.axis, h.reference), r * Math.sin(a))));
};
const near = (a: Vec3, b: Vec3): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};
const faceAt = (g: BodyGeometry, c: Vec3): number =>
  g.faces.findIndex((f) => Math.hypot(f.center.x - c.x, f.center.y - c.y, f.center.z - c.z) < 1e-4);

describe("dialog handles", () => {
  it("puts the arrow of Offset Plane on the base and sets the offset", async () => {
    const store = new DocumentStore(createDocument());
    const ctx = await compute(store, new FeatureEngine(kernel, solver));
    const dialog: Dialog = { type: "offset-plane", editing: null, base: { type: "origin-plane", plane: "XY" }, offset: "-15", picking: "base" };
    const h = only<LinearHandle>(dialogHandles(dialog, ctx));
    expect(h).toMatchObject({ key: "offset", value: -15, direction: { x: 0, y: 0, z: 1 } });
    expect(tip(h).z).toBeCloseTo(-15, 9);
    expect(h.patch(12.5)).toEqual({ offset: "12.5" });
  });

  it("turns the ring of Revolve the way the body is revolved", async () => {
    const store = new DocumentStore(createDocument());
    const s = sketch(store, XZ, (b) => createRectangle2Point(b, { x: 10, y: 0 }, { x: 20, y: 10 }));
    const profiles = [profileAt(store.document, s.id, { x: 15, y: 5 })];
    const e: CreatedRef = {};
    store.execute(addRevolve({ sketchId: s.id, profiles, axis: { type: "origin-axis", axis: "Z" }, angle: "90" }, e));
    const engine = new FeatureEngine(kernel, solver);
    const ctx = await compute(store, engine);
    const dialog: Dialog = {
      type: "revolve",
      editing: null,
      sketchId: s.id,
      profiles,
      axis: { type: "origin-axis", axis: "Z" },
      angle: "90",
      operation: "new",
      targetBodyIds: [],
      picking: "profile",
    };
    const h = only<AngularHandle>(dialogHandles(dialog, ctx));
    // The knob ends where the revolved body ends.
    const end = knob(h);
    const bounds = engine.bodyGeometry(e.bodyId!)!.bounds;
    expect(end.y).toBeGreaterThan(bounds.min.y + 1);
    expect(end.y).toBeLessThanOrEqual(bounds.max.y + 1e-6);
    expect(Math.abs(end.x)).toBeLessThan(1e-6);
  });

  it("turns the ring of Circular Pattern the way the instances go, also flipped", async () => {
    const store = new DocumentStore(createDocument());
    const body = block(store, { x: 30, y: -5 }, { x: 40, y: 5 }, "5");
    const engine = new FeatureEngine(kernel, solver);
    for (const flip of [false, true]) {
      const e: CreatedRef = {};
      const s = new DocumentStore(store.document);
      s.execute(addCircularPattern({ source: { kind: "bodies", bodyIds: [body] }, axis: { type: "origin-axis", axis: "Z" }, count: "2", angle: "90", flip }, e));
      const result = await engine.recompute(s.document);
      const copy = result.bodies.find((b) => b.id !== body)!;
      const g = engine.bodyGeometry(copy.id)!;
      const center = scale3(add3(g.bounds.min, g.bounds.max), 0.5);
      const ctx = await compute(store, engine);
      const dialog: Dialog = {
        type: "circular-pattern",
        editing: null,
        sourceKind: "bodies",
        featureIds: [],
        bodyIds: [body],
        axis: { type: "origin-axis", axis: "Z" },
        count: "2",
        angle: "90",
        flip,
        picking: "source",
      };
      const h = only<AngularHandle>(dialogHandles(dialog, ctx));
      near(knob(h), { ...center, z: h.center.z });
    }
  });

  it("drills the arrow of Hole into the body, and points Fillet and Shell inwards", async () => {
    const store = new DocumentStore(createDocument());
    const body = block(store, { x: 0, y: 0 }, { x: 40, y: 30 }, "20");
    const below = sketch(store, XY, (b) => createPoint(b, { x: 10, y: 10 }).entities[0]!);
    const ctx = await compute(store, new FeatureEngine(kernel, solver));
    const hole: Dialog = {
      type: "hole",
      editing: null,
      bodyId: body,
      bodyAuto: false,
      sketchId: below.id,
      points: [below.made],
      holeType: "simple",
      diameter: "5",
      extent: "distance",
      depth: "8",
      counterboreDiameter: "10",
      counterboreDepth: "3",
      countersinkDiameter: "10",
      countersinkAngle: "90",
      flip: false,
      picking: "points",
    };
    // The sketch is below the body: the hole goes up into it.
    const h = only<LinearHandle>(dialogHandles(hole, ctx));
    near(tip(h), { x: 10, y: 10, z: 8 });
    expect(only<LinearHandle>(dialogHandles({ ...hole, flip: true }, ctx)).direction.z).toBeCloseTo(-1, 9);
    expect(dialogHandles({ ...hole, extent: "through-all" }, ctx)).toEqual([]);

    const g = ctx.bodies[body]!.geometry;
    const edge = g.edges.findIndex((e) => Math.abs(e.midpoint.x - 20) < 1e-6 && Math.abs(e.midpoint.y - 30) < 1e-6 && Math.abs(e.midpoint.z - 20) < 1e-6);
    const fillet = only<LinearHandle>(
      dialogHandles({ type: "fillet", editing: null, bodyId: body, edges: [makeEdgeRef(ctx.bodies[body]!, edge)!], value: "3" }, ctx),
    );
    // Halfway between the top (+Z) and the back (+Y): into the body along −Y −Z.
    expect(fillet.direction.y).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(fillet.direction.z).toBeCloseTo(-Math.SQRT1_2, 3);

    const top = faceAt(g, { x: 20, y: 15, z: 20 });
    const shell = only<LinearHandle>(
      dialogHandles({ type: "shell", editing: null, bodyId: body, faces: [makeFaceRef(ctx.bodies[body]!, top)!], value: "2" }, ctx),
    );
    expect(dot3(shell.direction, { x: 0, y: 0, z: 1 })).toBeCloseTo(-1, 9);
    expect(shell.patch(0.5)).toEqual({ value: "0.5" });
  });

  it("ends the arrow of Rectangular Pattern at the last instance", async () => {
    const store = new DocumentStore(createDocument());
    const body = block(store, { x: 0, y: 0 }, { x: 10, y: 10 }, "10");
    const ctx = await compute(store, new FeatureEngine(kernel, solver));
    const dialog: Dialog = {
      type: "rectangular-pattern",
      editing: null,
      sourceKind: "bodies",
      featureIds: [],
      bodyIds: [body],
      direction: { type: "origin-axis", axis: "X" },
      count: "4",
      distance: "15",
      flip: true,
      second: true,
      direction2: { type: "origin-axis", axis: "Y" },
      count2: "1",
      distance2: "20",
      flip2: false,
      picking: "source",
    };
    const [first, second] = dialogHandles(dialog, ctx) as LinearHandle[];
    near(tip(first!), { x: 5 - 45, y: 5, z: 5 });
    expect(first!.patch(12)).toEqual({ distance: "12" });
    // One instance: the arrow shows the spacing itself.
    near(tip(second!), { x: 5, y: 25, z: 5 });
    expect(second!.patch(30)).toEqual({ distance2: "30" });
  });
});
