import { describe, expect, it } from "vitest";
import {
  createCircle,
  createLine,
  createPoint,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
} from "@fabcad/sketch";
import {
  type CreatedRef,
  DocumentStore,
  FEATURE_LABELS,
  type Feature,
  type HoleFeature,
  type MoveFeature,
  type RectangularPatternFeature,
  type SketchFeature,
  type SplitFeature,
  type SweepFeature,
  addAlign,
  addCircularPattern,
  addExtrude,
  addFillet,
  addHole,
  addLoft,
  addMirror,
  addMove,
  addParameter,
  addRectangularPattern,
  addSketch,
  addSplit,
  addSweep,
  affectedFeatures,
  buildDependencyGraph,
  createDocument,
  deserializeDocument,
  dynamicBodyId,
  featureCreatedBodies,
  featureExpressions,
  featureInputBodies,
  featureInputFeatures,
  featureInputSketches,
  featureOutputBodies,
  parseDynamicBodyId,
  pruneBodies,
  removeBody,
  removeFeatures,
  renameParameter,
  serializeDocument,
  setFeatureExpression,
  syncBodyRecords,
  topologicalOrder,
  updateFeature,
  updateSketch,
} from "../src";

interface Built {
  store: DocumentStore;
  sketchId: string;
  extrudeId: string;
  bodyId: string;
  /** Sketch with two points and a line. */
  pointsId: string;
  points: string[];
  line: string;
}

function build(): Built {
  const store = new DocumentStore(createDocument("Test"));
  store.execute(addParameter({ name: "n", expression: "4", unit: "" }));
  store.execute(addParameter({ name: "pitch", expression: "20", unit: "mm" }));
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  store.execute(
    updateSketch(s.id!, "Rectangle", (sk) =>
      editSketch(sk, (b) => {
        createRectangle2Point(b, { x: 0, y: 0 }, { x: 100, y: 80 });
      }),
    ),
  );
  const region = detectProfiles((store.document.features[s.id!] as SketchFeature).sketch)[0]!;
  const e: CreatedRef = {};
  store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "10" }, e));
  const p: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, p));
  let points: string[] = [];
  let line = "";
  store.execute(
    updateSketch(p.id!, "Points", (sk) =>
      editSketch(sk, (b) => {
        points = [
          createPoint(b, { x: 20, y: 20 }).points[0]!,
          createPoint(b, { x: 40, y: 20 }).points[0]!,
        ];
        line = createLine(b, { x: 0, y: 0 }, { x: 0, y: 50 }).entities[0]!;
      }),
    ),
  );
  return { store, sketchId: s.id!, extrudeId: e.id!, bodyId: e.bodyId!, pointsId: p.id!, points, line };
}

const feature = <T extends Feature>(b: Built, id: string): T => b.store.document.features[id] as T;

describe("dynamic body ids", () => {
  it("are built from the feature, the source body and the instance", () => {
    expect(dynamicBodyId("pattern-7", "body-3", 2)).toBe("pattern-7:body-3:2");
    expect(parseDynamicBodyId("pattern-7:body-3:2")).toEqual({
      featureId: "pattern-7",
      sourceBodyId: "body-3",
      instance: "2",
    });
    expect(parseDynamicBodyId("pattern-7:body-3:1.2")!.instance).toBe("1.2");
    // The source may be a derived body itself.
    const nested = dynamicBodyId("mirror-9", "pattern-7:body-3:2", 1);
    expect(parseDynamicBodyId(nested)).toEqual({
      featureId: "mirror-9",
      sourceBodyId: "pattern-7:body-3:2",
      instance: "1",
    });
    // Ids from the document counter are not derived ids.
    expect(parseDynamicBodyId("body-3")).toBeNull();
    expect(parseDynamicBodyId("a:b")).toBeNull();
    expect(parseDynamicBodyId(":b:1")).toBeNull();
    expect(parseDynamicBodyId("a:b:")).toBeNull();
  });
});

describe("commands", () => {
  it("name the features after their kind", () => {
    expect(FEATURE_LABELS).toMatchObject({
      hole: "Hole",
      "rectangular-pattern": "Rectangular Pattern",
      "circular-pattern": "Circular Pattern",
      mirror: "Mirror",
      move: "Move",
      align: "Align",
      split: "Split Body",
      sweep: "Sweep",
      loft: "Loft",
    });
  });

  it("add a hole with defaults that fit its diameter", () => {
    const b = build();
    const h: CreatedRef = {};
    expect(
      b.store.execute(
        addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: [...b.points, b.points[0]!], diameter: "6" }, h),
      ),
    ).toBe(true);
    const hole = feature<HoleFeature>(b, h.id!);
    expect(hole).toMatchObject({
      type: "hole",
      name: "Hole001",
      bodyId: b.bodyId,
      sketchId: b.pointsId,
      points: b.points,
      holeType: "simple",
      extent: "through-all",
      diameter: "6",
      countersinkAngle: "90",
    });
    expect(h.bodyId).toBe(b.bodyId);
    expect(b.store.document.timeline.at(-1)).toBe(h.id);
    // No body of its own.
    expect(Object.keys(b.store.document.bodies)).toEqual([b.bodyId]);

    // Points that are no points, bodies and sketches that do not exist.
    expect(b.store.execute(addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: [b.line], diameter: "6" }))).toBe(false);
    expect(b.store.execute(addHole({ bodyId: "nope", sketchId: b.pointsId, points: b.points, diameter: "6" }))).toBe(false);
    expect(b.store.execute(addHole({ bodyId: b.bodyId, sketchId: b.extrudeId, points: b.points, diameter: "6" }))).toBe(false);
  });

  it("list only the expressions that are used", () => {
    const b = build();
    const h: CreatedRef = {};
    b.store.execute(
      addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: b.points, diameter: "d", depth: "unused" }, h),
    );
    expect(featureExpressions(feature(b, h.id!))).toEqual([
      { key: "diameter", expression: "d", kind: "length" },
    ]);
    b.store.execute(
      updateFeature<HoleFeature>(h.id!, { extent: "distance", holeType: "countersink" }),
    );
    expect(featureExpressions(feature(b, h.id!)).map((e) => [e.key, e.kind])).toEqual([
      ["diameter", "length"],
      ["depth", "length"],
      ["countersinkDiameter", "length"],
      ["countersinkAngle", "angle"],
    ]);
    b.store.execute(updateFeature<HoleFeature>(h.id!, { holeType: "counterbore" }));
    expect(featureExpressions(feature(b, h.id!)).map((e) => e.key)).toEqual([
      "diameter",
      "depth",
      "counterboreDiameter",
      "counterboreDepth",
    ]);

    const p: CreatedRef = {};
    b.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [h.id!] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "pitch",
        },
        p,
      ),
    );
    // A count has no unit.
    expect(featureExpressions(feature(b, p.id!))).toEqual([
      { key: "count", expression: "n", kind: "none" },
      { key: "distance", expression: "pitch", kind: "length" },
    ]);
    b.store.execute(
      updateFeature<RectangularPatternFeature>(p.id!, {
        direction2: { type: "origin-axis", axis: "Y" },
        count2: "2",
        distance2: "pitch * 2",
      }),
    );
    expect(featureExpressions(feature(b, p.id!)).map((e) => e.key)).toEqual([
      "count",
      "distance",
      "count2",
      "distance2",
    ]);
  });

  it("put the features a pattern repeats in timeline order and drop what does not exist", () => {
    const b = build();
    const h1: CreatedRef = {};
    const h2: CreatedRef = {};
    b.store.execute(addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: [b.points[0]!], diameter: "6" }, h1));
    b.store.execute(addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: [b.points[1]!], diameter: "6" }, h2));
    const p: CreatedRef = {};
    b.store.execute(
      addCircularPattern(
        {
          source: { kind: "features", featureIds: [h2.id!, "gone", h1.id!, b.pointsId, h2.id!] },
          axis: { type: "origin-axis", axis: "Z" },
          count: "n",
        },
        p,
      ),
    );
    expect(feature(b, p.id!)).toMatchObject({
      name: "Circular Pattern001",
      source: { kind: "features", featureIds: [h1.id, h2.id] },
      angle: "360",
    });
    expect(featureInputFeatures(feature(b, p.id!))).toEqual([h1.id, h2.id]);
    for (const source of [
      { kind: "features" as const, featureIds: ["gone"] },
      { kind: "bodies" as const, bodyIds: ["gone"] },
      { kind: "bodies" as const, bodyIds: [] },
    ]) {
      expect(
        b.store.execute(addMirror({ source, plane: { type: "origin-plane", plane: "XY" } })),
      ).toBe(false);
    }
  });

  it("add the records of the bodies a feature is known to create", () => {
    const b = build();
    const m: CreatedRef = {};
    b.store.execute(
      addMirror(
        { source: { kind: "bodies", bodyIds: [b.bodyId] }, plane: { type: "origin-plane", plane: "YZ" } },
        m,
      ),
    );
    const mirrored = `${m.id}:${b.bodyId}:1`;
    expect(m.bodyId).toBe(mirrored);
    expect(featureCreatedBodies(feature(b, m.id!))).toEqual([mirrored]);
    expect(b.store.document.bodies[mirrored]).toEqual({
      id: mirrored,
      name: "Body001 (Mirror001)",
      componentId: b.store.document.assembly.rootComponentId,
      visible: true,
      createdBy: m.id,
    });

    const copy: CreatedRef = {};
    b.store.execute(
      addMove(
        { bodyIds: [b.bodyId, mirrored], copy: true, transform: { type: "translate", x: "1", y: "2", z: "3" } },
        copy,
      ),
    );
    expect(featureCreatedBodies(feature(b, copy.id!))).toEqual([
      `${copy.id}:${b.bodyId}:1`,
      `${copy.id}:${mirrored}:1`,
    ]);
    expect(b.store.document.bodies[`${copy.id}:${mirrored}:1`]).toMatchObject({
      name: "Body001 (Mirror001) (Move001)",
    });
    const move: CreatedRef = {};
    b.store.execute(
      addMove({ bodyIds: [b.bodyId], transform: { type: "translate", x: "1", y: "2", z: "3" } }, move),
    );
    expect(featureCreatedBodies(feature(b, move.id!))).toEqual([]);
    expect(featureOutputBodies(feature(b, move.id!))).toEqual([b.bodyId]);
    expect(move.bodyId).toBe(b.bodyId);

    const split: CreatedRef = {};
    b.store.execute(addSplit({ bodyId: b.bodyId, tool: { type: "origin-plane", plane: "XZ" } }, split));
    const half = `${split.id}:${b.bodyId}:1`;
    expect(feature<SplitFeature>(b, split.id!).keep).toBe("both");
    expect(featureOutputBodies(feature(b, split.id!))).toEqual([b.bodyId, half]);
    expect(b.store.document.bodies[half]).toMatchObject({ createdBy: split.id });

    // A pattern of bodies cannot tell: how many there are is the value of an expression.
    const p: CreatedRef = {};
    b.store.execute(
      addRectangularPattern(
        {
          source: { kind: "bodies", bodyIds: [b.bodyId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "pitch",
        },
        p,
      ),
    );
    expect(featureCreatedBodies(feature(b, p.id!))).toEqual([]);
    expect(featureOutputBodies(feature(b, p.id!))).toEqual([]);
    expect(Object.keys(b.store.document.bodies).filter((id) => id.startsWith(p.id!))).toEqual([]);

    // Deleting a feature deletes its bodies, the derived ones too; undo brings them back.
    const before = b.store.document;
    b.store.execute(removeFeatures([m.id!, split.id!]));
    expect(b.store.document.bodies[mirrored]).toBeUndefined();
    expect(b.store.document.bodies[half]).toBeUndefined();
    expect(b.store.document.bodies[b.bodyId]).toBeDefined();
    b.store.undo();
    expect(b.store.document).toBe(before);
    // Deleting a derived body deletes the feature that made it.
    b.store.execute(removeBody(half));
    expect(b.store.document.features[split.id!]).toBeUndefined();
  });

  it("add align, sweep and loft", () => {
    const b = build();
    const ref = { point: { x: 0, y: 0, z: 0 } };
    expect(
      b.store.execute(
        addAlign({ mode: "face-to-face", bodyId: b.bodyId, from: ref, to: { bodyId: b.bodyId, ref } }),
      ),
      "a body cannot be aligned with itself",
    ).toBe(false);
    const a: CreatedRef = {};
    b.store.execute(
      addAlign(
        {
          mode: "point-to-point",
          bodyId: b.bodyId,
          from: { type: "vertex", bodyId: b.bodyId, point: { x: 0, y: 0, z: 0 } },
          to: { type: "sketch-point", sketchId: b.pointsId, entityId: b.points[0]! },
          flip: true,
        },
        a,
      ),
    );
    expect(feature(b, a.id!)).toMatchObject({ name: "Align001", mode: "point-to-point", flip: true });
    expect(featureInputBodies(feature(b, a.id!))).toEqual([b.bodyId]);
    expect(featureInputSketches(feature(b, a.id!))).toEqual([b.pointsId]);

    const c: CreatedRef = {};
    b.store.execute(addSketch({ type: "origin", plane: "XZ" }, c));
    b.store.execute(
      updateSketch(c.id!, "Circle", (sk) =>
        editSketch(sk, (builder) => {
          createCircle(builder, { x: 0, y: 0 }, 2);
        }),
      ),
    );
    const profile = profileRefOf(detectProfiles((b.store.document.features[c.id!] as SketchFeature).sketch)[0]!);
    const sweep: CreatedRef = {};
    b.store.execute(
      addSweep(
        { sketchId: c.id!, profiles: [profile], path: { sketchId: b.pointsId, entityIds: [b.line, b.line] } },
        sweep,
      ),
    );
    expect(feature<SweepFeature>(b, sweep.id!)).toMatchObject({
      name: "Sweep001",
      operation: "new",
      orientation: "perpendicular",
      path: { sketchId: b.pointsId, entityIds: [b.line] },
      bodyId: sweep.bodyId,
    });
    expect(b.store.document.bodies[sweep.bodyId!]).toMatchObject({ createdBy: sweep.id });
    expect(featureInputSketches(feature(b, sweep.id!))).toEqual([c.id, b.pointsId]);

    // Switching the operation drops and adds the body, as for an extrude.
    b.store.execute(updateFeature<SweepFeature>(sweep.id!, { operation: "cut", targetBodyIds: [b.bodyId] }));
    expect(feature<SweepFeature>(b, sweep.id!).bodyId).toBe("");
    expect(b.store.document.bodies[sweep.bodyId!]).toBeUndefined();
    expect(featureInputBodies(feature(b, sweep.id!))).toEqual([b.bodyId]);
    b.store.execute(updateFeature<SweepFeature>(sweep.id!, { operation: "new" }));
    const again = feature<SweepFeature>(b, sweep.id!);
    expect(again.targetBodyIds).toEqual([]);
    expect(b.store.document.bodies[again.bodyId]).toMatchObject({ createdBy: sweep.id });

    const section = { type: "profile" as const, sketchId: c.id!, profile };
    expect(b.store.execute(addLoft({ sections: [section] }))).toBe(false);
    const loft: CreatedRef = {};
    b.store.execute(
      addLoft(
        {
          sections: [section, { type: "face", bodyId: b.bodyId, ref }],
          operation: "join",
          targetBodyIds: [again.bodyId],
          ruled: true,
        },
        loft,
      ),
    );
    expect(feature(b, loft.id!)).toMatchObject({ name: "Loft001", ruled: true, bodyId: "" });
    expect(featureInputBodies(feature(b, loft.id!))).toEqual([again.bodyId, b.bodyId]);
    expect(featureInputSketches(feature(b, loft.id!))).toEqual([c.id]);
    expect(featureOutputBodies(feature(b, loft.id!))).toEqual([again.bodyId]);
  });

  it("edit and rename the expressions of nested objects", () => {
    const b = build();
    const move: CreatedRef = {};
    b.store.execute(
      addMove(
        { bodyIds: [b.bodyId], transform: { type: "translate", x: "pitch", y: "pitch * n", z: "0" } },
        move,
      ),
    );
    const m = feature<MoveFeature>(b, move.id!);
    expect(featureExpressions(m).map((e) => e.key)).toEqual(["transform.x", "transform.y", "transform.z"]);
    const edited = setFeatureExpression(m, "transform.y", "7") as MoveFeature;
    expect(edited.transform).toEqual({ type: "translate", x: "pitch", y: "7", z: "0" });
    expect(m.transform).toMatchObject({ y: "pitch * n" });
    // Not an expression of the feature: nothing happens.
    expect(setFeatureExpression(m, "transform.type", "rotate")).toBe(m);
    expect(setFeatureExpression(m, "name", "x")).toBe(m);

    b.store.execute(updateFeature<MoveFeature>(move.id!, { "transform.z": "n + 1" } as never));
    expect(feature<MoveFeature>(b, move.id!).transform).toMatchObject({ z: "n + 1" });

    const h: CreatedRef = {};
    b.store.execute(
      addHole(
        {
          bodyId: b.bodyId,
          sketchId: b.pointsId,
          points: b.points,
          diameter: "pitch / 4",
          holeType: "counterbore",
          counterboreDiameter: "pitch / 2",
          counterboreDepth: "2",
          depth: "pitch",
        },
        h,
      ),
    );
    const p: CreatedRef = {};
    b.store.execute(
      addCircularPattern(
        {
          source: { kind: "features", featureIds: [h.id!] },
          axis: { type: "origin-axis", axis: "Z" },
          count: "n",
          angle: "n * 30",
        },
        p,
      ),
    );
    const pitch = b.store.document.parameters.find((q) => q.name === "pitch")!;
    const n = b.store.document.parameters.find((q) => q.name === "n")!;
    b.store.execute(renameParameter(pitch.id, "spacing"));
    b.store.execute(renameParameter(n.id, "count"));
    expect(feature<MoveFeature>(b, move.id!).transform).toEqual({
      type: "translate",
      x: "spacing",
      y: "spacing * count",
      z: "count + 1",
    });
    expect(feature<HoleFeature>(b, h.id!)).toMatchObject({
      diameter: "spacing / 4",
      counterboreDiameter: "spacing / 2",
      // Not in use (the hole goes through all): left as it is.
      depth: "pitch",
    });
    expect(feature(b, p.id!)).toMatchObject({ count: "count", angle: "count * 30" });
    expect(affectedFeatures(b.store.document, { parameters: ["spacing"] })).toEqual([move.id, h.id, p.id]);
  });
});

describe("body records", () => {
  it("are added and removed to match the bodies that exist", () => {
    const b = build();
    const p: CreatedRef = {};
    b.store.execute(
      addRectangularPattern(
        {
          source: { kind: "bodies", bodyIds: [b.bodyId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "pitch",
        },
        p,
      ),
    );
    const root = b.store.document.assembly.rootComponentId;
    const info = (i: number): Parameters<typeof syncBodyRecords>[0][number] => ({
      id: dynamicBodyId(p.id!, b.bodyId, i),
      createdBy: p.id!,
      sourceBodyId: b.bodyId,
      suggestedName: `Body001 (${i})`,
      componentId: root,
    });
    const ids = [1, 2, 3].map((i) => info(i).id);
    const before = b.store.document;
    expect(b.store.amend(syncBodyRecords([1, 2, 3].map(info), [b.bodyId, ...ids]))).toBe(true);
    expect(Object.keys(b.store.document.bodies)).toEqual([b.bodyId, ...ids]);
    expect(b.store.document.bodies[ids[1]!]).toEqual({
      id: ids[1],
      name: "Body001 (2)",
      componentId: root,
      visible: true,
      createdBy: p.id,
    });
    // Not a user edit: the step that added the pattern now leads to the amended document.
    expect(b.store.undoLabel).toBe("Rectangular pattern");
    b.store.undo();
    b.store.redo();
    expect(Object.keys(b.store.document.bodies)).toEqual([b.bodyId, ...ids]);
    expect(before.bodies).not.toBe(b.store.document.bodies);

    // Nothing to do: the same document.
    const synced = b.store.document;
    expect(syncBodyRecords([], [b.bodyId, ...ids])(synced)).toBe(synced);
    expect(syncBodyRecords([1, 2, 3].map(info), [b.bodyId, ...ids])(synced)).toBe(synced);

    // A name that is taken, a body that is not alive, a feature that does not exist.
    const taken = syncBodyRecords(
      [
        { ...info(4), suggestedName: "Body001" },
        info(5),
        { ...info(6), id: "gone-1:body-1:1", createdBy: "gone-1" },
      ],
      [b.bodyId, ...ids, info(4).id, "gone-1:body-1:1"],
    )(synced);
    expect(taken.bodies[info(4).id]!.name).toBe("Body001 2");
    expect(taken.bodies[info(5).id]).toBeUndefined();
    expect(taken.bodies["gone-1:body-1:1"]).toBeUndefined();

    // The pattern got smaller: the records of the instances that are gone go too.
    const fewer = syncBodyRecords([], [b.bodyId, ids[0]!])(synced);
    expect(Object.keys(fewer.bodies)).toEqual([b.bodyId, ids[0]]);
    // Bodies with a record from a command are none of its business.
    expect(syncBodyRecords([], [])(synced).bodies[b.bodyId]).toBeDefined();
  });

  it("stay while the feature that makes them does not run", () => {
    const b = build();
    const split: CreatedRef = {};
    b.store.execute(addSplit({ bodyId: b.bodyId, tool: { type: "origin-plane", plane: "XZ" } }, split));
    const half = split.bodyId!;
    const doc = b.store.document;
    const named = { ...doc, bodies: { ...doc.bodies, [half]: { ...doc.bodies[half]!, name: "Lid" } } };

    const suppressed: typeof doc = {
      ...named,
      features: { ...named.features, [split.id!]: { ...named.features[split.id!]!, suppressed: true } },
    };
    expect(syncBodyRecords([], [b.bodyId])(suppressed)).toBe(suppressed);
    const rolledBack = { ...named, timelineCursor: named.timeline.indexOf(split.id!) };
    expect(syncBodyRecords([], [b.bodyId])(rolledBack)).toBe(rolledBack);
    // It ran and made no such body.
    expect(syncBodyRecords([], [b.bodyId])(named).bodies[half]).toBeUndefined();
    // Its feature is gone.
    const { [split.id!]: _gone, ...features } = named.features;
    void _gone;
    const orphan = { ...named, features, timeline: named.timeline.filter((id) => id !== split.id) };
    expect(syncBodyRecords([], [b.bodyId])(orphan).bodies[half]).toBeUndefined();
  });

  it("survive pruning as long as their feature exists", () => {
    const b = build();
    const p: CreatedRef = {};
    b.store.execute(
      addRectangularPattern(
        {
          source: { kind: "bodies", bodyIds: [b.bodyId] },
          direction: { type: "origin-axis", axis: "X" },
          count: "n",
          distance: "pitch",
        },
        p,
      ),
    );
    const id = dynamicBodyId(p.id!, b.bodyId, 1);
    b.store.amend(
      syncBodyRecords(
        [{ id, createdBy: p.id!, suggestedName: "Copy", componentId: b.store.document.assembly.rootComponentId }],
        [b.bodyId, id],
      ),
    );
    expect(pruneBodies(b.store.document)).toBe(b.store.document);
    // Turning the extrude into a cut prunes the bodies: the body of the extrude goes, the
    // instance of the pattern stays until a recompute tells what became of it.
    b.store.execute(updateFeature(b.extrudeId, { operation: "cut", targetBodyIds: [] } as never));
    expect(Object.keys(b.store.document.bodies)).toEqual([id]);
    const { [p.id!]: _gone, ...features } = b.store.document.features;
    void _gone;
    expect(pruneBodies({ ...b.store.document, features }).bodies).toEqual({});
  });
});

describe("dependency graph", () => {
  it("connects a pattern with the features it repeats and the bodies they change", () => {
    const b = build();
    const h: CreatedRef = {};
    b.store.execute(addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: b.points, diameter: "6" }, h));
    const p: CreatedRef = {};
    b.store.execute(
      addRectangularPattern(
        {
          source: { kind: "features", featureIds: [h.id!] },
          direction: { type: "sketch-line", sketchId: b.pointsId, entityId: b.line },
          count: "n",
          distance: "pitch",
        },
        p,
      ),
    );
    const f: CreatedRef = {};
    b.store.execute(addFillet({ bodyId: b.bodyId, edges: [{ point: { x: 0, y: 0, z: 5 } }], radius: "2" }, f));
    const doc = b.store.document;
    const pattern = doc.features[p.id!]!;
    const lookup = (id: string): Feature | undefined => doc.features[id];
    // Without the document a pattern of features does not know which bodies it changes.
    expect(featureInputBodies(pattern)).toEqual([]);
    expect(featureInputBodies(pattern, lookup)).toEqual([b.bodyId]);
    expect(featureOutputBodies(pattern, lookup)).toEqual([b.bodyId]);
    expect(featureInputSketches(pattern)).toEqual([b.pointsId]);

    expect(affectedFeatures(doc, { parameters: ["n"] })).toEqual([p.id, f.id]);
    expect(affectedFeatures(doc, { features: [h.id!] })).toEqual([h.id, p.id, f.id]);
    expect(affectedFeatures(doc, { features: [b.pointsId] })).toEqual([b.pointsId, h.id, p.id, f.id]);
    const graph = buildDependencyGraph(doc);
    expect([...graph.dependsOn.get(`feature:${p.id}`)!].sort()).toEqual(
      [`feature:${h.id}`, `feature:${b.pointsId}`, "param:n", "param:pitch"].sort(),
    );
    expect(() => topologicalOrder(graph)).not.toThrow();
  });

  it("finds the feature that made a derived body from the id", () => {
    const b = build();
    const p: CreatedRef = {};
    b.store.execute(
      addCircularPattern(
        {
          source: { kind: "bodies", bodyIds: [b.bodyId] },
          axis: { type: "origin-axis", axis: "Z" },
          count: "n",
        },
        p,
      ),
    );
    const instance = dynamicBodyId(p.id!, b.bodyId, 2);
    b.store.amend(
      syncBodyRecords(
        [{ id: instance, createdBy: p.id!, suggestedName: "Copy", componentId: b.store.document.assembly.rootComponentId }],
        [b.bodyId, instance],
      ),
    );
    const h: CreatedRef = {};
    b.store.execute(addHole({ bodyId: instance, sketchId: b.pointsId, points: b.points, diameter: "6" }, h));
    const m: CreatedRef = {};
    b.store.execute(
      addMirror(
        { source: { kind: "bodies", bodyIds: [instance] }, plane: { type: "face", bodyId: b.bodyId, ref: { point: { x: 0, y: 0, z: 0 } } } },
        m,
      ),
    );
    const doc = b.store.document;
    expect(affectedFeatures(doc, { parameters: ["n"] })).toEqual([p.id, h.id, m.id]);
    // The mirror reads the instance after the hole changed it, and the body of the face.
    expect([...buildDependencyGraph(doc).dependsOn.get(`feature:${m.id}`)!].sort()).toEqual(
      [`feature:${h.id}`, `feature:${b.extrudeId}`].sort(),
    );
    expect(affectedFeatures(doc, { features: [b.extrudeId] })).toEqual([b.extrudeId, p.id, h.id, m.id]);

    // A reference to a feature that comes later is no dependency: there is no cycle.
    const early: CreatedRef = {};
    const rolled = { ...doc, timelineCursor: 2 };
    const withEarly = addRectangularPattern(
      {
        source: { kind: "features", featureIds: [h.id!] },
        direction: { type: "origin-axis", axis: "X" },
        count: "2",
        distance: "5",
      },
      early,
    ).apply(rolled);
    expect(withEarly.timeline.indexOf(early.id!)).toBeLessThan(withEarly.timeline.indexOf(h.id!));
    expect(() => topologicalOrder(buildDependencyGraph(withEarly))).not.toThrow();
    expect(affectedFeatures(withEarly, { features: [h.id!] })).not.toContain(early.id);
  });
});

describe("save and load", () => {
  it("round-trip the new features and the records of derived bodies", () => {
    const b = build();
    const ref = { name: "extrude-1:end", point: { x: 50, y: 40, z: 10 }, normal: { x: 0, y: 0, z: 1 } };
    b.store.execute(
      addHole({ bodyId: b.bodyId, sketchId: b.pointsId, points: b.points, diameter: "6", holeType: "countersink", flip: true }),
    );
    const hole = b.store.document.timeline.at(-1)!;
    b.store.execute(
      addRectangularPattern({
        source: { kind: "features", featureIds: [hole] },
        direction: { type: "edge", bodyId: b.bodyId, ref },
        count: "n",
        distance: "pitch",
        direction2: { type: "sketch-line", sketchId: b.pointsId, entityId: b.line },
        flip2: true,
      }),
    );
    b.store.execute(
      addCircularPattern({
        source: { kind: "bodies", bodyIds: [b.bodyId] },
        axis: { type: "edge", bodyId: b.bodyId, ref },
        count: "n",
        angle: "180",
        flip: true,
      }),
    );
    const pattern = b.store.document.timeline.at(-1)!;
    b.store.execute(
      addMirror({ source: { kind: "bodies", bodyIds: [b.bodyId] }, plane: { type: "face", bodyId: b.bodyId, ref } }),
    );
    b.store.execute(
      addMove({
        bodyIds: [b.bodyId],
        copy: true,
        transform: { type: "rotate", axis: { type: "origin-axis", axis: "Y" }, angle: "45" },
      }),
    );
    const copy = Object.keys(b.store.document.bodies).at(-1)!;
    b.store.execute(
      addAlign({ mode: "face-to-face", bodyId: copy, from: ref, to: { bodyId: b.bodyId, ref } }),
    );
    b.store.execute(addSplit({ bodyId: b.bodyId, tool: { type: "face", bodyId: copy, ref }, keep: "negative" }));
    const profile = profileRefOf(
      detectProfiles((b.store.document.features[b.sketchId] as SketchFeature).sketch)[0]!,
    );
    b.store.execute(
      addSweep({ sketchId: b.sketchId, profiles: [profile], path: { sketchId: b.pointsId, entityIds: [b.line] } }),
    );
    b.store.execute(
      addLoft({
        sections: [
          { type: "profile", sketchId: b.sketchId, profile },
          { type: "face", bodyId: b.bodyId, ref },
        ],
      }),
    );
    const instance = dynamicBodyId(pattern, b.bodyId, 1);
    b.store.amend(
      syncBodyRecords(
        [{ id: instance, createdBy: pattern, suggestedName: "Copy", componentId: b.store.document.assembly.rootComponentId }],
        [...Object.keys(b.store.document.bodies), instance],
      ),
    );

    const doc = b.store.document;
    expect(new Set(Object.values(doc.features).map((f) => f.type))).toEqual(
      new Set([
        "sketch",
        "extrude",
        "hole",
        "rectangular-pattern",
        "circular-pattern",
        "mirror",
        "move",
        "align",
        "split",
        "sweep",
        "loft",
      ]),
    );
    const loaded = deserializeDocument(serializeDocument(doc));
    expect(loaded).toEqual(doc);
    expect(loaded.bodies[instance]).toMatchObject({ name: "Copy", createdBy: pattern });
    expect(loaded.timeline).toEqual(doc.timeline);
    // What is read is as good as what was written: commands work on it.
    const store = new DocumentStore(loaded);
    expect(store.execute(removeFeatures([pattern]))).toBe(true);
    expect(store.document.bodies[instance]).toBeUndefined();
  });
});
