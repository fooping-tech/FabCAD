import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import {
  type CadDocument,
  type CreatedRef,
  DocumentStore,
  type Feature,
  type Scope,
  type SketchFeature,
  addExtrude,
  addParameter,
  addSketch,
  createDocument,
  evaluateParameters,
  parameterScope,
  syncBodyRecords,
  updateSketch,
} from "@fabcad/cad-document";
import { FeatureEngine, makeEdgeRef, makeFaceRef, resolveFaceRef } from "@fabcad/features";
import type { Vec2, Vec3 } from "@fabcad/geometry";
import {
  type Sketch,
  type SketchBuilder,
  type SketchPlaneRef,
  createArcCenter,
  createCircle,
  createLine,
  createPoint,
  createRectangle2Point,
  createSpline,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import type {
  HoleDialog,
  LoftDialog,
  MirrorDialog,
  MoveDialog,
  RectangularPatternDialog,
  SolidDialog,
  SplitDialog,
  SweepDialog,
} from "../src/app/appState";
import {
  type Picked,
  applyPick,
  canRepeatFeature,
  consumedSketches,
  dialogFromFeature,
  dialogReferences,
  dialogSketches,
  dialogWants,
  featureOfFace,
  freePoints,
  holeBody,
  isSolidDialog,
  nextPicking,
  pathChain,
  pathProblem,
  solidDialogCommand,
  solidDialogProblem,
} from "../src/app/solidDialogs";

/**
 * The feature dialogs as far as they are plain functions: picking, validation and the command
 * a dialog turns into. The last block runs the commands through the real kernel.
 */

const XY: SketchPlaneRef = { type: "origin", plane: "XY" };
const XZ: SketchPlaneRef = { type: "origin", plane: "XZ" };

function sketch<T>(
  store: DocumentStore,
  plane: SketchPlaneRef,
  draw: (b: SketchBuilder) => T,
): { id: string; made: T } {
  const s: CreatedRef = {};
  store.execute(addSketch(plane, s));
  let made: T | undefined;
  store.execute(
    updateSketch(s.id!, "Draw", (sk) =>
      editSketch(sk, (b) => {
        made = draw(b);
      }),
    ),
  );
  return { id: s.id!, made: made as T };
}

const sketchOf = (doc: CadDocument, id: string): Sketch => (doc.features[id] as SketchFeature).sketch;

const profileAt = (doc: CadDocument, sketchId: string, p: Vec2): ReturnType<typeof profileRefOf> =>
  profileRefOf(regionAtPoint(detectProfiles(sketchOf(doc, sketchId)), p)!);

function block(
  store: DocumentStore,
  from: Vec2,
  to: Vec2,
  distance: string,
): { sketchId: string; featureId: string; bodyId: string } {
  const s = sketch(store, XY, (b) => createRectangle2Point(b, from, to).entities);
  const e: CreatedRef = {};
  store.execute(
    addExtrude(
      {
        sketchId: s.id,
        profiles: [profileAt(store.document, s.id, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })],
        distance,
      },
      e,
    ),
  );
  return { sketchId: s.id, featureId: e.id!, bodyId: e.bodyId! };
}

/** Chains are compared as sets: the engine puts the curves of a path in order itself. */
const sorted = (ids: readonly (string | undefined)[]): (string | undefined)[] => ids.slice().sort();

const scopeOf = (doc: CadDocument): Scope => parameterScope(evaluateParameters(doc.parameters));

const HOLE: HoleDialog = {
  type: "hole",
  editing: null,
  bodyId: null,
  bodyAuto: true,
  sketchId: null,
  points: [],
  holeType: "simple",
  diameter: "5",
  extent: "through-all",
  depth: "10",
  counterboreDiameter: "9",
  counterboreDepth: "3",
  countersinkDiameter: "10",
  countersinkAngle: "90",
  flip: false,
  picking: "points",
};

const PATTERN: RectangularPatternDialog = {
  type: "rectangular-pattern",
  editing: null,
  sourceKind: "features",
  featureIds: [],
  bodyIds: [],
  direction: null,
  count: "3",
  distance: "10",
  flip: false,
  second: false,
  direction2: null,
  count2: "2",
  distance2: "10",
  flip2: false,
  picking: "source",
};

const MIRROR: MirrorDialog = {
  type: "mirror",
  editing: null,
  sourceKind: "bodies",
  featureIds: [],
  bodyIds: [],
  plane: null,
  picking: "source",
};

const MOVE: MoveDialog = {
  type: "move",
  editing: null,
  bodyIds: [],
  copy: false,
  mode: "translate",
  x: "0",
  y: "0",
  z: "0",
  axis: null,
  angle: "90",
  from: null,
  to: null,
  picking: "bodies",
};

const SPLIT: SplitDialog = {
  type: "split",
  editing: null,
  bodyId: null,
  tool: null,
  keep: "both",
  picking: "body",
};

const SWEEP: SweepDialog = {
  type: "sweep",
  editing: null,
  sketchId: null,
  profiles: [],
  pathSketchId: null,
  path: [],
  operation: "new",
  targetBodyIds: [],
  picking: "profile",
};

const LOFT: LoftDialog = {
  type: "loft",
  editing: null,
  sections: [],
  ruled: false,
  operation: "new",
  targetBodyIds: [],
};

/** Apply a pick the way the application does: the patch is merged into the dialog. */
function pick<D extends SolidDialog>(dialog: D, picked: Picked, doc: CadDocument, additive = false): D {
  const patch = applyPick(dialog, picked, { doc, additive });
  return patch ? ({ ...dialog, ...patch } as D) : dialog;
}

// ------------------------------------------------------------------- sketches

describe("sweep path", () => {
  /** A line, a quarter arc and a line in a row, a line that branches off, and one apart. */
  function paths(): { store: DocumentStore; id: string; e: Record<string, string> } {
    const store = new DocumentStore(createDocument());
    const s = sketch(store, XZ, (b) => {
      const first = createLine(b, { x: 0, y: -10 }, { x: 0, y: 0 });
      const arc = createArcCenter(b, { x: 10, y: 0 }, first.points[1]!, { x: 10, y: 10 }, false);
      const last = createLine(b, arc.points[2]!, { x: 30, y: 10 });
      const fork = createLine(b, last.points[1]!, { x: 40, y: 20 });
      const fork2 = createLine(b, last.points[1]!, { x: 40, y: 0 });
      const apart = createLine(b, { x: 0, y: 40 }, { x: 10, y: 40 });
      // Ends at the start of `apart` without sharing its point.
      const touching = createLine(b, { x: -10, y: 40 }, { x: 0, y: 40 });
      const circle = createCircle(b, { x: 60, y: 60 }, 5);
      const spline = createSpline(b, "control", [
        { x: 10, y: 40 },
        { x: 15, y: 50 },
        { x: 20, y: 40 },
      ]);
      return {
        first: first.entities[0]!,
        arc: arc.entities[0]!,
        last: last.entities[0]!,
        fork: fork.entities[0]!,
        fork2: fork2.entities[0]!,
        apart: apart.entities[0]!,
        touching: touching.entities[0]!,
        circle: circle.entities[0]!,
        spline: spline.entities[0]!,
        point: first.points[0]!,
      };
    });
    return { store, id: s.id, e: s.made };
  }

  it("selects the chain a curve belongs to, up to a branch", () => {
    const { store, id, e } = paths();
    const s = sketchOf(store.document, id);
    const chain = sorted([e.first, e.arc, e.last]);
    expect(sorted(pathChain(s, e.arc!))).toEqual(chain);
    expect(sorted(pathChain(s, e.first!))).toEqual(chain);
    expect(sorted(pathChain(s, e.last!))).toEqual(chain);
    // Three curves meet at the far end of `last`: the chain of a fork is the fork.
    expect(pathChain(s, e.fork!)).toEqual([e.fork]);
  });

  it("joins curves whose ends coincide, whatever their kind", () => {
    const { store, id, e } = paths();
    const s = sketchOf(store.document, id);
    const chain = sorted([e.touching, e.apart, e.spline]);
    expect(sorted(pathChain(s, e.apart!))).toEqual(chain);
    expect(sorted(pathChain(s, e.spline!))).toEqual(chain);
  });

  it("takes a closed curve by itself and refuses points", () => {
    const { store, id, e } = paths();
    const s = sketchOf(store.document, id);
    expect(pathChain(s, e.circle!)).toEqual([e.circle]);
    expect(pathChain(s, e.point!)).toEqual([]);
    expect(pathChain(s, "nothing")).toEqual([]);
  });

  it("says why curves make no path", () => {
    const { store, id, e } = paths();
    const s = sketchOf(store.document, id);
    expect(pathProblem(s, [])).toBe("Select a path");
    expect(pathProblem(s, [e.first!, e.arc!, e.last!])).toBeNull();
    expect(pathProblem(s, [e.last!, e.first!, e.arc!])).toBeNull();
    expect(pathProblem(s, [e.circle!])).toBeNull();
    expect(pathProblem(s, [e.first!, e.last!])).toMatch(/not connected/);
    expect(pathProblem(s, [e.last!, e.fork!, e.fork2!])).toMatch(/branches/);
    expect(pathProblem(s, [e.circle!, e.first!])).toMatch(/closed curve/);
    expect(pathProblem(s, [e.point!])).toMatch(/no longer exists/);
  });

  it("picks the chain, takes it out again and toggles single curves with Shift", () => {
    const { store, id, e } = paths();
    const doc = store.document;
    const at = (entityId: string): Picked => ({ kind: "entity", sketchId: id, entityId });
    let d: SweepDialog = { ...SWEEP, picking: "path" };
    d = pick(d, at(e.arc!), doc);
    expect(d.pathSketchId).toBe(id);
    expect(sorted(d.path)).toEqual(sorted([e.first, e.arc, e.last]));
    // Another chain replaces the path, so that it stays one chain.
    d = pick(d, at(e.fork!), doc);
    expect(d.path).toEqual([e.fork]);
    d = pick(d, at(e.fork!), doc);
    expect(d.path).toEqual([]);
    d = pick(d, at(e.arc!), doc);
    d = pick(d, at(e.first!), doc, true);
    expect(sorted(d.path)).toEqual(sorted([e.arc, e.last]));
    d = pick(d, at(e.first!), doc, true);
    expect(sorted(d.path)).toEqual(sorted([e.arc, e.last, e.first]));
    // A point is not a path, and the profile input takes no curves.
    expect(applyPick(d, at(e.point!), { doc })).toBeNull();
    expect(applyPick({ ...d, picking: "profile" }, at(e.arc!), { doc })).toBeNull();
  });
});

describe("sketch points", () => {
  it("finds the points that stand by themselves", () => {
    const store = new DocumentStore(createDocument());
    const s = sketch(store, XY, (b) => {
      createLine(b, { x: 0, y: 0 }, { x: 10, y: 0 });
      createCircle(b, { x: 20, y: 20 }, 3);
      return [createPoint(b, { x: 5, y: 5 }).points[0]!, createPoint(b, { x: 8, y: 5 }).points[0]!];
    });
    expect(freePoints(sketchOf(store.document, s.id))).toEqual(s.made);
  });
});

// -------------------------------------------------------------------- picking

describe("what a dialog asks for", () => {
  it("depends on the active input", () => {
    expect(dialogWants(HOLE)).toEqual({ sketchPoints: true });
    expect(dialogWants({ ...HOLE, picking: "body" })).toEqual({ bodies: true });
    expect(dialogWants(PATTERN)).toEqual({ features: true, faces: "any" });
    expect(dialogWants({ ...PATTERN, sourceKind: "bodies" })).toEqual({ bodies: true });
    expect(dialogWants({ ...PATTERN, picking: "direction2" })).toEqual({
      edges: "linear",
      sketchLines: true,
    });
    expect(dialogWants({ ...MIRROR, picking: "plane" })).toEqual({
      faces: "planar",
      originPlanes: true,
    });
    expect(dialogWants({ ...MOVE, mode: "rotate", picking: "axis" })).toEqual({
      edges: "axis",
      sketchLines: true,
    });
    expect(dialogWants({ ...MOVE, mode: "point-to-point", picking: "to" })).toEqual({
      vertices: true,
      sketchPoints: true,
    });
    // An input of another type of move takes nothing.
    expect(dialogWants({ ...MOVE, mode: "translate", picking: "axis" })).toEqual({});
    expect(dialogWants({ ...SPLIT, picking: "tool" })).toEqual({ faces: "planar", originPlanes: true });
    expect(dialogWants(SWEEP)).toEqual({ profiles: true });
    expect(dialogWants({ ...SWEEP, picking: "path" })).toEqual({ sketchCurves: true });
    expect(dialogWants(LOFT)).toEqual({ profiles: true, faces: "planar" });
  });

  it("tells the feature dialogs from the others", () => {
    expect(isSolidDialog(HOLE)).toBe(true);
    expect(isSolidDialog(LOFT)).toBe(true);
    expect(isSolidDialog({ type: "parameters" })).toBe(false);
    expect(isSolidDialog(null)).toBe(false);
  });

  it("moves on to the first input that is still empty", () => {
    expect(nextPicking({ ...HOLE, points: ["p"], sketchId: "s" }).picking).toBe("body");
    expect(nextPicking({ ...HOLE, points: ["p"], sketchId: "s", bodyId: "b" }).picking).toBe("points");
    expect(nextPicking({ ...PATTERN, featureIds: ["f"] }).picking).toBe("direction");
    expect(nextPicking({ ...MIRROR, bodyIds: ["b"] }).picking).toBe("plane");
    expect(nextPicking({ ...MOVE, bodyIds: ["b"], mode: "rotate" }).picking).toBe("axis");
    expect(nextPicking({ ...MOVE, bodyIds: ["b"], mode: "point-to-point" }).picking).toBe("from");
    expect(nextPicking({ ...SPLIT, bodyId: "b" }).picking).toBe("tool");
    expect(nextPicking({ ...SWEEP, profiles: [{ entityIds: [], point: { x: 0, y: 0 } }] }).picking).toBe("path");
  });
});

describe("hole picks", () => {
  function plate(): { store: DocumentStore; bodyId: string; a: { id: string; made: string[] }; b: { id: string; made: string[] } } {
    const store = new DocumentStore(createDocument());
    const p = block(store, { x: 0, y: 0 }, { x: 100, y: 80 }, "10");
    const points = (at: Vec2[]) => (b: SketchBuilder) => at.map((q) => createPoint(b, q).points[0]!);
    const a = sketch(store, XY, points([{ x: 20, y: 20 }, { x: 50, y: 40 }]));
    const b = sketch(store, XY, points([{ x: 80, y: 60 }]));
    return { store, bodyId: p.bodyId, a, b };
  }

  it("adds points, removes a point picked again, and starts anew in another sketch", () => {
    const { store, bodyId, a, b } = plate();
    const doc = store.document;
    const at = (sketchId: string, entityId: string): Picked => ({ kind: "entity", sketchId, entityId });
    let d = pick(HOLE, at(a.id, a.made[0]!), doc);
    // The only body there is becomes the body to drill.
    expect(d).toMatchObject({ sketchId: a.id, points: [a.made[0]], bodyId });
    d = pick(d, at(a.id, a.made[1]!), doc);
    expect(d.points).toEqual(a.made);
    d = pick(d, at(a.id, a.made[0]!), doc);
    expect(d.points).toEqual([a.made[1]]);
    d = pick(d, at(b.id, b.made[0]!), doc);
    expect(d).toMatchObject({ sketchId: b.id, points: b.made });
  });

  it("takes points only, and a body only when asked for one", () => {
    const { store, bodyId, a } = plate();
    const doc = store.document;
    const line = Object.values(sketchOf(doc, doc.timeline[0]!).entities).find((e) => e.type === "line")!;
    expect(applyPick(HOLE, { kind: "entity", sketchId: doc.timeline[0]!, entityId: line.id }, { doc })).toBeNull();
    expect(applyPick(HOLE, { kind: "body", bodyId }, { doc })).toBeNull();
    const d = pick({ ...HOLE, picking: "body" }, { kind: "body", bodyId }, doc);
    expect(d).toMatchObject({ bodyId, bodyAuto: false, picking: "points" });
    expect(applyPick({ ...HOLE, picking: "body" }, { kind: "body", bodyId: "gone" }, { doc })).toBeNull();
    // A body chosen by hand stays when the points change to another sketch.
    const other = pick({ ...d, bodyId: "chosen" }, { kind: "entity", sketchId: a.id, entityId: a.made[0]! }, doc);
    expect(other.bodyId).toBe("chosen");
  });

  it("finds the body of the face a sketch lies on", () => {
    const store = new DocumentStore(createDocument());
    const first = block(store, { x: 0, y: 0 }, { x: 10, y: 10 }, "10");
    const second = block(store, { x: 50, y: 0 }, { x: 60, y: 10 }, "10");
    const onFace = sketch(
      store,
      {
        type: "face",
        bodyId: second.bodyId,
        hint: { x: 55, y: 5, z: 10 },
        plane: {
          origin: { x: 0, y: 0, z: 10 },
          normal: { x: 0, y: 0, z: 1 },
          xDir: { x: 1, y: 0, z: 0 },
          yDir: { x: 0, y: 1, z: 0 },
        },
      },
      (b) => createPoint(b, { x: 55, y: 5 }).points[0]!,
    );
    expect(holeBody(store.document, onFace.id)).toBe(second.bodyId);
    // Two bodies and a sketch on a plane: there is no telling which one is meant.
    expect(holeBody(store.document, first.sketchId)).toBeNull();
    expect(holeBody(store.document, null)).toBeNull();
  });
});

describe("source, direction and plane picks", () => {
  function model(): { store: DocumentStore; a: ReturnType<typeof block>; b: ReturnType<typeof block> } {
    const store = new DocumentStore(createDocument());
    const a = block(store, { x: 0, y: 0 }, { x: 10, y: 10 }, "10");
    const b = block(store, { x: 50, y: 0 }, { x: 60, y: 10 }, "10");
    return { store, a, b };
  }
  const face = (bodyId: string, featureId: string | null, planar = true): Picked => ({
    kind: "face",
    bodyId,
    faceIndex: 0,
    ref: { kind: "face", point: { x: 0, y: 0, z: 0 } },
    planar,
    featureId,
  });

  it("finds the feature that made a face", () => {
    const names = { faces: [{ feature: "extrude1" }, { feature: "hole2" }] };
    expect(featureOfFace(names, 1)).toBe("hole2");
    expect(featureOfFace(names, 5)).toBeNull();
    expect(featureOfFace(undefined, 0)).toBeNull();
  });

  it("picks features through their faces or the timeline, and bodies", () => {
    const { store, a, b } = model();
    const doc = store.document;
    let d = pick(PATTERN, face(a.bodyId, a.featureId), doc);
    expect(d.featureIds).toEqual([a.featureId]);
    d = pick(d, { kind: "feature", featureId: b.featureId }, doc);
    expect(d.featureIds).toEqual([a.featureId, b.featureId]);
    d = pick(d, face(a.bodyId, a.featureId), doc);
    expect(d.featureIds).toEqual([b.featureId]);
    // Sketches cannot be repeated, and bodies are not features.
    expect(applyPick(d, { kind: "feature", featureId: a.sketchId }, { doc })).toBeNull();
    expect(applyPick(d, { kind: "body", bodyId: a.bodyId }, { doc })).toBeNull();

    let bodies: RectangularPatternDialog = { ...PATTERN, sourceKind: "bodies" };
    bodies = pick(bodies, { kind: "body", bodyId: a.bodyId }, doc);
    bodies = pick(bodies, { kind: "body", bodyId: b.bodyId }, doc);
    bodies = pick(bodies, { kind: "body", bodyId: a.bodyId }, doc);
    expect(bodies.bodyIds).toEqual([b.bodyId]);
    expect(bodies.featureIds).toEqual([]);
    expect(applyPick(bodies, face(a.bodyId, a.featureId), { doc })).toBeNull();
  });

  it("offers only features that come before the one being edited", () => {
    const { store, a, b } = model();
    const doc = store.document;
    expect(canRepeatFeature(doc, { editing: null }, b.featureId)).toBe(true);
    expect(canRepeatFeature(doc, { editing: b.featureId }, a.featureId)).toBe(true);
    expect(canRepeatFeature(doc, { editing: a.featureId }, b.featureId)).toBe(false);
    expect(canRepeatFeature(doc, { editing: a.featureId }, a.featureId)).toBe(false);
    expect(canRepeatFeature(doc, { editing: null }, "gone")).toBe(false);
  });

  it("takes straight edges and sketch lines as a direction, circles as an axis only", () => {
    const { store, a } = model();
    const doc = store.document;
    const ref = { kind: "edge" as const, point: { x: 0, y: 0, z: 5 } };
    const edge = (curve: "line" | "circle" | "other"): Picked => ({
      kind: "edge",
      bodyId: a.bodyId,
      ref,
      curve,
    });
    const direction: RectangularPatternDialog = { ...PATTERN, picking: "direction" };
    expect(pick(direction, edge("line"), doc).direction).toEqual({ type: "edge", bodyId: a.bodyId, ref });
    expect(applyPick(direction, edge("circle"), { doc })).toBeNull();
    expect(applyPick(direction, edge("other"), { doc })).toBeNull();
    const second = pick({ ...PATTERN, picking: "direction2" }, edge("line"), doc);
    expect(second.direction).toBeNull();
    expect(second.direction2).toEqual({ type: "edge", bodyId: a.bodyId, ref });

    const rotate: MoveDialog = { ...MOVE, mode: "rotate", picking: "axis" };
    expect(pick(rotate, edge("circle"), doc).axis).toEqual({ type: "edge", bodyId: a.bodyId, ref });

    const entities = Object.values(sketchOf(doc, a.sketchId).entities);
    const line = entities.find((e) => e.type === "line")!;
    const point = entities.find((e) => e.type === "point")!;
    const at = (entityId: string): Picked => ({ kind: "entity", sketchId: a.sketchId, entityId });
    expect(pick(direction, at(line.id), doc).direction).toEqual({
      type: "sketch-line",
      sketchId: a.sketchId,
      entityId: line.id,
    });
    expect(applyPick(direction, at(point.id), { doc })).toBeNull();
  });

  it("takes origin planes and flat faces as a plane", () => {
    const { store, a } = model();
    const doc = store.document;
    const plane: MirrorDialog = { ...MIRROR, picking: "plane" };
    expect(pick(plane, { kind: "origin-plane", plane: "YZ" }, doc).plane).toEqual({
      type: "origin-plane",
      plane: "YZ",
    });
    expect(pick(plane, face(a.bodyId, a.featureId), doc).plane).toMatchObject({
      type: "face",
      bodyId: a.bodyId,
    });
    expect(applyPick(plane, face(a.bodyId, a.featureId, false), { doc })).toBeNull();
    // Split: the body first, then the dialog asks for the plane.
    const split = pick(SPLIT, { kind: "body", bodyId: a.bodyId }, doc);
    expect(split).toMatchObject({ bodyId: a.bodyId, picking: "tool" });
    expect(pick(split, { kind: "origin-plane", plane: "XZ" }, doc).tool).toEqual({
      type: "origin-plane",
      plane: "XZ",
    });
  });

  it("fills From and To of Move and Align in turn", () => {
    const { store, a, b } = model();
    const doc = store.document;
    const vertex = (bodyId: string, point: Vec3): Picked => ({
      kind: "vertex",
      ref: { type: "vertex", bodyId, point },
    });
    let move: MoveDialog = { ...MOVE, bodyIds: [a.bodyId], mode: "point-to-point", picking: "from" };
    move = pick(move, vertex(a.bodyId, { x: 0, y: 0, z: 0 }), doc);
    expect(move.picking).toBe("to");
    const point = Object.values(sketchOf(doc, b.sketchId).entities).find((e) => e.type === "point")!;
    move = pick(move, { kind: "entity", sketchId: b.sketchId, entityId: point.id }, doc);
    expect(move.to).toEqual({ type: "sketch-point", sketchId: b.sketchId, entityId: point.id });

    const align: SolidDialog = {
      type: "align",
      editing: null,
      mode: "face-to-face",
      bodyId: null,
      fromFace: null,
      toFace: null,
      fromPoint: null,
      toPoint: null,
      flip: false,
      picking: "from",
    };
    const from = pick(align, face(a.bodyId, a.featureId), doc);
    // The body that moves is the one the first face lies on.
    expect(from).toMatchObject({ bodyId: a.bodyId, picking: "to" });
    expect(solidDialogProblem(from, doc, scopeOf(doc))).toBe("Select the face to align with");
    const same = pick(from, face(a.bodyId, a.featureId), doc);
    expect(solidDialogProblem(same, doc, scopeOf(doc))).toMatch(/another body/);
    const done = pick(from, face(b.bodyId, b.featureId), doc);
    expect(solidDialogProblem(done, doc, scopeOf(doc))).toBeNull();
    expect(applyPick(from, face(b.bodyId, b.featureId, false), { doc })).toBeNull();

    const points = { ...align, mode: "point-to-point" as const };
    const moved = pick(points, vertex(b.bodyId, { x: 50, y: 0, z: 0 }), doc);
    expect(moved).toMatchObject({ bodyId: b.bodyId, picking: "to" });
    // A sketch point does not tell which body moves.
    expect(applyPick(points, { kind: "entity", sketchId: b.sketchId, entityId: point.id }, { doc })).toBeNull();
  });

  it("adds sections to a loft in the order they are picked", () => {
    const { store, a, b } = model();
    const doc = store.document;
    const profile: Picked = {
      kind: "profile",
      sketchId: a.sketchId,
      ref: profileAt(doc, a.sketchId, { x: 5, y: 5 }),
    };
    let d = pick(LOFT, profile, doc);
    d = pick(d, face(b.bodyId, b.featureId), doc);
    expect(d.sections.map((s) => s.type)).toEqual(["profile", "face"]);
    expect(applyPick(d, face(b.bodyId, b.featureId, false), { doc })).toBeNull();
    // Picked again, a section goes.
    d = pick(d, profile, doc);
    expect(d.sections.map((s) => s.type)).toEqual(["face"]);
  });
});

describe("what is highlighted", () => {
  it("lists what a dialog refers to", () => {
    const refs = dialogReferences({
      ...PATTERN,
      featureIds: ["hole1"],
      direction: { type: "sketch-line", sketchId: "s1", entityId: "l1" },
      direction2: { type: "origin-axis", axis: "Y" },
    });
    expect(refs.features).toEqual(["hole1"]);
    expect(refs.entities).toEqual([{ sketchId: "s1", entityId: "l1" }]);
    expect(refs.bodies).toEqual([]);

    const hole = { ...HOLE, bodyId: "b1", sketchId: "s2", points: ["p1", "p2"] };
    expect(dialogReferences(hole)).toMatchObject({
      bodies: ["b1"],
      entities: [
        { sketchId: "s2", entityId: "p1" },
        { sketchId: "s2", entityId: "p2" },
      ],
    });
    expect([...dialogSketches(hole)]).toEqual(["s2"]);
    expect(consumedSketches(hole)).toEqual(["s2"]);

    const split = dialogReferences({
      ...SPLIT,
      bodyId: "b1",
      tool: { type: "origin-plane", plane: "XZ" },
    });
    expect(split).toMatchObject({ bodies: ["b1"], originPlanes: ["XZ"] });
    expect(consumedSketches({ ...SWEEP, sketchId: "s1", pathSketchId: "s2" })).toEqual(["s1", "s2"]);
    expect(consumedSketches(PATTERN)).toEqual([]);
  });
});

// ----------------------------------------------------------------- validation

describe("why a dialog cannot be applied", () => {
  const store = new DocumentStore(createDocument());
  store.execute(addParameter({ name: "bolt", expression: "6", unit: "mm" }));
  store.execute(addParameter({ name: "n", expression: "4", unit: "" }));
  const a = block(store, { x: 0, y: 0 }, { x: 100, y: 80 }, "10");
  const points = sketch(store, XY, (b) => createPoint(b, { x: 30, y: 40 }).points[0]!);
  const doc = store.document;
  const scope = scopeOf(doc);
  const problem = (d: SolidDialog): string | null => solidDialogProblem(d, doc, scope);

  it("checks a hole", () => {
    const hole: HoleDialog = { ...HOLE, sketchId: points.id, points: [points.made], bodyId: a.bodyId };
    expect(problem(HOLE)).toBe("Select a sketch point");
    expect(problem({ ...hole, bodyId: null })).toBe("Select the body to drill");
    expect(problem(hole)).toBeNull();
    expect(problem({ ...hole, diameter: "bolt + 0.5" })).toBeNull();
    expect(problem({ ...hole, diameter: "0" })).toBe("Diameter must be greater than zero");
    expect(problem({ ...hole, diameter: "nothing" })).toMatch(/^Diameter: .*nothing/);
    expect(problem({ ...hole, diameter: "30 deg" })).toMatch(/^Diameter: /);
    // The depth only counts when the hole has one.
    expect(problem({ ...hole, depth: "0" })).toBeNull();
    expect(problem({ ...hole, extent: "distance", depth: "0" })).toBe("Depth must be greater than zero");
    expect(problem({ ...hole, holeType: "counterbore", counterboreDiameter: "4" })).toBe(
      "The counterbore must be wider than the hole",
    );
    expect(problem({ ...hole, holeType: "counterbore", counterboreDepth: "-1" })).toBe(
      "Counterbore depth must be greater than zero",
    );
    expect(problem({ ...hole, holeType: "counterbore" })).toBeNull();
    expect(problem({ ...hole, holeType: "countersink", countersinkAngle: "180" })).toBe(
      "Countersink angle must be less than 180 deg",
    );
    expect(problem({ ...hole, holeType: "countersink", countersinkDiameter: "5" })).toBe(
      "The countersink must be wider than the hole",
    );
    // Fields of another type are not looked at.
    expect(problem({ ...hole, holeType: "simple", countersinkAngle: "0", counterboreDepth: "x" })).toBeNull();
  });

  it("checks the patterns and the mirror", () => {
    const pattern: RectangularPatternDialog = {
      ...PATTERN,
      featureIds: [a.featureId],
      direction: { type: "origin-axis", axis: "X" },
    };
    expect(problem(PATTERN)).toBe("Select a feature");
    expect(problem({ ...PATTERN, sourceKind: "bodies" })).toBe("Select a body");
    expect(problem({ ...pattern, direction: null })).toBe("Select a direction");
    expect(problem(pattern)).toBeNull();
    expect(problem({ ...pattern, count: "n" })).toBeNull();
    expect(problem({ ...pattern, count: "0" })).toBe("Count must be at least 1");
    expect(problem({ ...pattern, distance: "0" })).toBe("Distance must not be zero");
    expect(problem({ ...pattern, distance: "-12" })).toBeNull();
    expect(problem({ ...pattern, second: true })).toBe("Select the second direction");
    expect(
      problem({ ...pattern, second: true, direction2: { type: "origin-axis", axis: "X" } }),
    ).toMatch(/directions are the same/);
    expect(
      problem({ ...pattern, second: true, direction2: { type: "origin-axis", axis: "Y" }, count2: "" }),
    ).toMatch(/^Second count: /);
    // A second direction that is switched off is not checked.
    expect(problem({ ...pattern, second: false, count2: "" })).toBeNull();

    const circular: SolidDialog = {
      type: "circular-pattern",
      editing: null,
      sourceKind: "bodies",
      featureIds: [],
      bodyIds: [a.bodyId],
      axis: null,
      count: "n",
      angle: "360",
      flip: false,
      picking: "axis",
    };
    expect(problem(circular)).toBe("Select an axis");
    const axis = { type: "origin-axis" as const, axis: "Z" as const };
    expect(problem({ ...circular, axis })).toBeNull();
    expect(problem({ ...circular, axis, angle: "0" })).toBe("Angle must not be zero");
    expect(problem({ ...circular, axis, angle: "10 mm" })).toMatch(/^Angle: /);

    expect(problem({ ...MIRROR, bodyIds: [a.bodyId] })).toBe("Select a mirror plane");
    expect(problem({ ...MIRROR, bodyIds: ["gone"], plane: { type: "origin-plane", plane: "YZ" } })).toBe(
      "Select a body",
    );
  });

  it("checks move, split, sweep and loft", () => {
    const move: MoveDialog = { ...MOVE, bodyIds: [a.bodyId] };
    expect(problem(MOVE)).toBe("Select a body");
    expect(problem(move)).toBe("Enter a distance");
    expect(problem({ ...move, z: "bolt" })).toBeNull();
    expect(problem({ ...move, x: "-5" })).toBeNull();
    expect(problem({ ...move, y: "?" })).toMatch(/^Y: /);
    expect(problem({ ...move, mode: "rotate" })).toBe("Select an axis");
    expect(problem({ ...move, mode: "rotate", axis: { type: "origin-axis", axis: "Z" }, angle: "-45" })).toBeNull();
    expect(problem({ ...move, mode: "point-to-point" })).toBe("Select the point to move from");
    expect(
      problem({ ...move, mode: "point-to-point", from: { type: "fixed", point: { x: 0, y: 0, z: 0 } } }),
    ).toBe("Select the point to move to");

    expect(problem(SPLIT)).toBe("Select the body to split");
    expect(problem({ ...SPLIT, bodyId: a.bodyId })).toBe("Select a splitting plane");
    const face = { kind: "face" as const, point: { x: 0, y: 0, z: 0 } };
    expect(problem({ ...SPLIT, bodyId: a.bodyId, tool: { type: "face", bodyId: a.bodyId, ref: face } })).toMatch(
      /another body/,
    );
    expect(problem({ ...SPLIT, bodyId: a.bodyId, tool: { type: "origin-plane", plane: "YZ" } })).toBeNull();

    const profile = profileAt(doc, a.sketchId, { x: 50, y: 40 });
    const line = Object.values(sketchOf(doc, a.sketchId).entities).find((e) => e.type === "line")!;
    const sweep: SweepDialog = { ...SWEEP, sketchId: a.sketchId, profiles: [profile] };
    expect(problem(SWEEP)).toBe("Select a profile");
    expect(problem(sweep)).toBe("Select a path");
    expect(problem({ ...sweep, pathSketchId: a.sketchId, path: [line.id] })).toBeNull();
    expect(problem({ ...sweep, pathSketchId: a.sketchId, path: [line.id], operation: "cut" })).toBe(
      "Select a target body",
    );

    const section = { type: "profile" as const, sketchId: a.sketchId, profile };
    expect(problem(LOFT)).toBe("Select the sections");
    expect(problem({ ...LOFT, sections: [section] })).toBe("Select a second section");
    expect(problem({ ...LOFT, sections: [section, section] })).toBeNull();
    expect(problem({ ...LOFT, sections: [section, section], operation: "join" })).toBe("Select a target body");
  });
});

// ------------------------------------------------- commands, through the kernel

describe("the command of a dialog", () => {
  let kernel: GeometryKernel;
  const solver = createDefaultSolver();

  beforeAll(async () => {
    kernel = await nodeKernel();
  });

  /** Recompute and write back the body records, as the application does. */
  async function compute(store: DocumentStore, engine: FeatureEngine): Promise<Record<string, string>> {
    const result = await engine.recompute(store.document);
    store.amend(
      syncBodyRecords(
        result.bodies.flatMap((b) => (b.record ? [{ id: b.id, ...b.record }] : [])),
        result.bodies.map((b) => b.id),
      ),
    );
    return Object.fromEntries(
      Object.values(result.features).map((f) => [f.id, f.state === "ok" ? "ok" : `${f.state}: ${f.message}`]),
    );
  }

  const run = (store: DocumentStore, dialog: SolidDialog): string => {
    const out: CreatedRef = {};
    const cmd = solidDialogCommand(dialog, out);
    expect(cmd).not.toBeNull();
    expect(store.execute(cmd!)).toBe(true);
    return dialog.editing ?? out.id!;
  };

  /** Editing a feature and applying the dialog unchanged leaves the feature as it is. */
  const roundTrip = (store: DocumentStore, id: string): void => {
    const before = store.document.features[id]!;
    const dialog = dialogFromFeature(before)!;
    expect(dialog.editing).toBe(id);
    store.execute(solidDialogCommand(dialog)!);
    expect(store.document.features[id]).toEqual(before);
  };

  const feature = <T extends Feature["type"]>(store: DocumentStore, id: string, type: T): Extract<Feature, { type: T }> => {
    const f = store.document.features[id]!;
    expect(f.type).toBe(type);
    return f as Extract<Feature, { type: T }>;
  };

  it("is null while the dialog is incomplete", () => {
    expect(solidDialogCommand(HOLE)).toBeNull();
    expect(solidDialogCommand(PATTERN)).toBeNull();
    expect(solidDialogCommand(MIRROR)).toBeNull();
    expect(solidDialogCommand(MOVE)).toBeNull();
    expect(solidDialogCommand({ ...MOVE, bodyIds: ["b"], mode: "rotate" })).toBeNull();
    expect(solidDialogCommand(SPLIT)).toBeNull();
    expect(solidDialogCommand(SWEEP)).toBeNull();
    expect(solidDialogCommand(LOFT)).toBeNull();
    expect(dialogFromFeature({ type: "fillet" } as Feature)).toBeNull();
  });

  it("drills, repeats and mirrors holes", async () => {
    const store = new DocumentStore(createDocument());
    const engine = new FeatureEngine(kernel, solver);
    const plate = block(store, { x: -50, y: -40 }, { x: 50, y: 40 }, "10");
    const s = sketch(store, XY, (b) => createPoint(b, { x: -35, y: -30 }).points[0]!);
    const area = (d: number): number => (Math.PI * d * d) / 4;

    const holeId = run(store, {
      ...HOLE,
      bodyId: plate.bodyId,
      sketchId: s.id,
      points: [s.made],
      diameter: "8",
    });
    expect(await compute(store, engine)).toMatchObject({ [holeId]: "ok" });
    expect(engine.bodyGeometry(plate.bodyId)!.volume).toBeCloseTo(80000 - area(8) * 10, 3);
    roundTrip(store, holeId);

    // Edited into a counterbore that ends in the plate.
    run(store, {
      ...dialogFromFeature(store.document.features[holeId]!)!,
      type: "hole",
      holeType: "counterbore",
      diameter: "6",
      extent: "distance",
      depth: "8",
      counterboreDiameter: "11",
      counterboreDepth: "3",
    } as HoleDialog);
    expect(feature(store, holeId, "hole")).toMatchObject({ holeType: "counterbore", extent: "distance" });
    await compute(store, engine);
    const bore = area(6) * 8 + (area(11) - area(6)) * 3;
    expect(engine.bodyGeometry(plate.bodyId)!.volume).toBeCloseTo(80000 - bore, 3);

    const patternId = run(store, {
      ...PATTERN,
      featureIds: [holeId],
      direction: { type: "origin-axis", axis: "X" },
      count: "3",
      distance: "30",
      second: true,
      direction2: { type: "origin-axis", axis: "Y" },
      count2: "2",
      distance2: "40",
    });
    expect(await compute(store, engine)).toMatchObject({ [patternId]: "ok" });
    expect(engine.bodyGeometry(plate.bodyId)!.volume).toBeCloseTo(80000 - 6 * bore, 2);
    roundTrip(store, patternId);

    // Without the second direction the feature has none, not an empty one.
    const dialog = dialogFromFeature(store.document.features[patternId]!) as RectangularPatternDialog;
    expect(dialog).toMatchObject({ second: true, count2: "2", distance2: "40" });
    run(store, { ...dialog, second: false });
    const single = feature(store, patternId, "rectangular-pattern");
    expect(single.direction2).toBeUndefined();
    expect(single.count2).toBeUndefined();
    await compute(store, engine);
    expect(engine.bodyGeometry(plate.bodyId)!.volume).toBeCloseTo(80000 - 3 * bore, 2);
    expect(store.undo()).toBe(true);
    expect(feature(store, patternId, "rectangular-pattern").count2).toBe("2");

    const mirrorId = run(store, {
      ...MIRROR,
      sourceKind: "features",
      featureIds: [holeId],
      plane: { type: "origin-plane", plane: "XZ" },
    });
    expect(await compute(store, engine)).toMatchObject({ [mirrorId]: "ok" });
    expect(engine.bodyGeometry(plate.bodyId)!.volume).toBeCloseTo(80000 - 7 * bore, 2);
    roundTrip(store, mirrorId);
  });

  it("moves, copies, patterns and splits bodies", async () => {
    const store = new DocumentStore(createDocument());
    const engine = new FeatureEngine(kernel, solver);
    const p = block(store, { x: 0, y: 0 }, { x: 10, y: 20 }, "30");
    const higher = block(store, { x: 200, y: 0 }, { x: 210, y: 10 }, "12");

    const moveId = run(store, { ...MOVE, bodyIds: [p.bodyId], x: "5", z: "-2" });
    await compute(store, engine);
    expect(engine.bodyGeometry(p.bodyId)!.bounds.min).toMatchObject({ x: 5, y: 0, z: -2 });
    roundTrip(store, moveId);

    // Turned into a copy that is rotated instead.
    const edit = dialogFromFeature(store.document.features[moveId]!) as MoveDialog;
    run(store, { ...edit, mode: "rotate", axis: { type: "origin-axis", axis: "Z" }, angle: "90", copy: true });
    expect(feature(store, moveId, "move").transform).toEqual({
      type: "rotate",
      axis: { type: "origin-axis", axis: "Z" },
      angle: "90",
    });
    await compute(store, engine);
    const copy = `${moveId}:${p.bodyId}:1`;
    expect(Object.keys(store.document.bodies)).toEqual([p.bodyId, higher.bodyId, copy]);
    expect(engine.bodyGeometry(p.bodyId)!.bounds.min).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(engine.bodyGeometry(copy)!.bounds.min.x).toBeCloseTo(-20, 6);
    roundTrip(store, moveId);

    const patternId = run(store, {
      ...PATTERN,
      sourceKind: "bodies",
      bodyIds: [p.bodyId],
      direction: { type: "origin-axis", axis: "X" },
      count: "4",
      distance: "25",
    });
    await compute(store, engine);
    // The instances get their records from the recompute.
    expect(Object.keys(store.document.bodies)).toHaveLength(6);
    const third = `${patternId}:${p.bodyId}:3`;
    expect(store.document.bodies[third]).toMatchObject({ createdBy: patternId, visible: true });
    expect(engine.bodyGeometry(third)!.bounds.min.x).toBeCloseTo(75, 6);

    const splitId = run(store, {
      ...SPLIT,
      bodyId: third,
      tool: { type: "origin-plane", plane: "XY" },
      picking: "tool",
    });
    // The plane z = 0 is the bottom of the body: it does not cut it.
    expect((await compute(store, engine))[splitId]).toMatch(/does not cut/);
    const g = engine.bodyGeometry(higher.bodyId)!;
    const top = g.faces.findIndex((f) => Math.abs(f.center.z - 12) < 1e-6);
    const ref = makeFaceRef({ geometry: g, names: engine.bodyNames(higher.bodyId)! }, top)!;
    run(store, {
      ...(dialogFromFeature(store.document.features[splitId]!) as SplitDialog),
      tool: { type: "face", bodyId: higher.bodyId, ref },
    });
    expect(await compute(store, engine)).toMatchObject({ [splitId]: "ok" });
    // The face looks up: above it is the positive side, which the body keeps.
    expect(engine.bodyGeometry(third)!.volume).toBeCloseTo(10 * 20 * 18, 3);
    expect(engine.bodyGeometry(`${splitId}:${third}:1`)!.volume).toBeCloseTo(10 * 20 * 12, 3);
    run(store, {
      ...(dialogFromFeature(store.document.features[splitId]!) as SplitDialog),
      keep: "negative",
    });
    await compute(store, engine);
    expect(engine.bodyGeometry(third)!.volume).toBeCloseTo(10 * 20 * 12, 3);
    expect(store.document.bodies[`${splitId}:${third}:1`]).toBeUndefined();
    roundTrip(store, splitId);
  });

  it("aligns a body with a face of another", async () => {
    const store = new DocumentStore(createDocument());
    const engine = new FeatureEngine(kernel, solver);
    const fixed = block(store, { x: 0, y: 0 }, { x: 40, y: 40 }, "10");
    const loose = block(store, { x: 100, y: 0 }, { x: 110, y: 20 }, "30");
    await compute(store, engine);
    const named = (bodyId: string) => ({
      geometry: engine.bodyGeometry(bodyId)!,
      names: engine.bodyNames(bodyId)!,
    });
    const faceAt = (bodyId: string, c: Vec3): Picked => {
      const body = named(bodyId);
      const faceIndex = body.geometry.faces.findIndex(
        (f) => Math.hypot(f.center.x - c.x, f.center.y - c.y, f.center.z - c.z) < 1e-6,
      );
      return {
        kind: "face",
        bodyId,
        faceIndex,
        ref: makeFaceRef(body, faceIndex)!,
        planar: true,
        featureId: body.names.faces[faceIndex]!.feature,
      };
    };
    const ctx = {
      doc: store.document,
      faceIndexOf: (bodyId: string, ref: Parameters<typeof resolveFaceRef>[0]) =>
        resolveFaceRef(ref, named(bodyId))?.index ?? -1,
    };
    let d: SolidDialog = {
      type: "align",
      editing: null,
      mode: "face-to-face",
      bodyId: null,
      fromFace: null,
      toFace: null,
      fromPoint: null,
      toPoint: null,
      flip: false,
      picking: "from",
    };
    d = { ...d, ...applyPick(d, faceAt(loose.bodyId, { x: 105, y: 10, z: 30 }), ctx) } as SolidDialog;
    d = { ...d, ...applyPick(d, faceAt(fixed.bodyId, { x: 40, y: 20, z: 5 }), ctx) } as SolidDialog;
    expect(solidDialogProblem(d, store.document, scopeOf(store.document))).toBeNull();
    const alignId = run(store, d);
    expect(await compute(store, engine)).toMatchObject({ [alignId]: "ok" });
    // The top of the loose block lies on the side of the fixed one.
    expect(engine.bodyGeometry(loose.bodyId)!.bounds.min.x).toBeCloseTo(40, 6);
    expect(engine.bodyGeometry(loose.bodyId)!.bounds.max.x).toBeCloseTo(70, 6);
    roundTrip(store, alignId);

    // The edge of a body as the axis of a move, by its name.
    const g = engine.bodyGeometry(fixed.bodyId)!;
    const edge = g.edges.findIndex((e) => Math.hypot(e.midpoint.x, e.midpoint.y, e.midpoint.z - 5) < 1e-6);
    const moveId = run(store, {
      ...MOVE,
      bodyIds: [fixed.bodyId],
      mode: "rotate",
      axis: { type: "edge", bodyId: fixed.bodyId, ref: makeEdgeRef(named(fixed.bodyId), edge)! },
      angle: "90",
    });
    expect(await compute(store, engine)).toMatchObject({ [moveId]: "ok" });
    expect(engine.bodyGeometry(fixed.bodyId)!.volume).toBeCloseTo(16000, 3);
    expect(engine.bodyGeometry(fixed.bodyId)!.bounds.min.z).toBeCloseTo(0, 6);
    expect(engine.bodyGeometry(fixed.bodyId)!.bounds.max.z).toBeCloseTo(10, 6);
  });

  it("sweeps and lofts", async () => {
    const store = new DocumentStore(createDocument());
    const engine = new FeatureEngine(kernel, solver);
    const profile = sketch(store, XY, (b) => createCircle(b, { x: 0, y: 0 }, 2).entities[0]!);
    const path = sketch(store, XZ, (b) => createLine(b, { x: 0, y: 0 }, { x: 0, y: 25 }).entities[0]!);
    const doc = store.document;
    let sweep: SweepDialog = pick(
      SWEEP,
      { kind: "profile", sketchId: profile.id, ref: profileAt(doc, profile.id, { x: 0, y: 0 }) },
      doc,
    );
    sweep = pick({ ...sweep, picking: "path" }, { kind: "entity", sketchId: path.id, entityId: path.made }, doc);
    expect(solidDialogProblem(sweep, doc, scopeOf(doc))).toBeNull();
    const sweepId = run(store, sweep);
    expect(await compute(store, engine)).toMatchObject({ [sweepId]: "ok" });
    const swept = feature(store, sweepId, "sweep").bodyId;
    expect(engine.bodyGeometry(swept)!.volume).toBeCloseTo(Math.PI * 4 * 25, 4);
    roundTrip(store, sweepId);

    const low = sketch(store, XY, (b) => createRectangle2Point(b, { x: 40, y: -5 }, { x: 60, y: 5 }).entities);
    const high = sketch(
      store,
      {
        type: "custom",
        plane: {
          origin: { x: 0, y: 0, z: 30 },
          normal: { x: 0, y: 0, z: 1 },
          xDir: { x: 1, y: 0, z: 0 },
          yDir: { x: 0, y: 1, z: 0 },
        },
      },
      (b) => createRectangle2Point(b, { x: 45, y: -2.5 }, { x: 55, y: 2.5 }).entities,
    );
    const section = (id: string): Picked => ({
      kind: "profile",
      sketchId: id,
      ref: profileAt(store.document, id, { x: 50, y: 0 }),
    });
    let loft = pick(LOFT, section(high.id), store.document);
    loft = pick(loft, section(low.id), store.document);
    // The order of the sections is the order of the picks; here it is turned round by hand.
    loft = { ...loft, sections: loft.sections.slice().reverse() };
    const loftId = run(store, loft);
    expect(await compute(store, engine)).toMatchObject({ [loftId]: "ok" });
    const lofted = feature(store, loftId, "loft");
    expect(lofted.sections.map((s) => (s.type === "profile" ? s.sketchId : ""))).toEqual([low.id, high.id]);
    expect(engine.bodyGeometry(lofted.bodyId)!.volume).toBeCloseTo((30 / 6) * (200 + 4 * 15 * 7.5 + 50), 3);
    roundTrip(store, loftId);

    // Cutting the swept body with the loft instead: the loft has no body of its own any more.
    run(store, {
      ...(dialogFromFeature(store.document.features[loftId]!) as LoftDialog),
      operation: "cut",
      targetBodyIds: [swept],
    });
    expect(feature(store, loftId, "loft")).toMatchObject({ bodyId: "", targetBodyIds: [swept] });
    expect(store.document.bodies[lofted.bodyId]).toBeUndefined();
  });
});
