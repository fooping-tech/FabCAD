import { describe, expect, it } from "vitest";
import { createRectangle2Point, editSketch, profileRefOf, detectProfiles } from "@fabcad/sketch";
import {
  DocumentStore,
  type CadDocument,
  type CreatedRef,
  type ExtrudeFeature,
  type SketchFeature,
  addBoolean,
  addExtrude,
  addFillet,
  addParameter,
  addSketch,
  affectedFeatures,
  buildDependencyGraph,
  consumedBodies,
  createDocument,
  deserializeDocument,
  downstream,
  featureNode,
  listBodies,
  paramNode,
  removeFeatures,
  renameParameter,
  serializeDocument,
  setExtension,
  setTimelineCursor,
  applySketchEdit,
  updateFeature,
  updateParameter,
  updateSketch,
} from "../src";

function buildBox(store: DocumentStore): { sketchId: string; extrudeId: string; bodyId: string } {
  store.execute(addParameter({ name: "width", expression: "100", unit: "mm" }));
  store.execute(addParameter({ name: "depth", expression: "width * 0.8", unit: "mm" }));
  store.execute(addParameter({ name: "height", expression: "50", unit: "mm" }));
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  const sketchId = s.id!;
  let lines: string[] = [];
  store.execute(
    updateSketch(sketchId, "Rectangle", (sk) =>
      editSketch(sk, (b) => {
        const r = createRectangle2Point(b, { x: 0, y: 0 }, { x: 100, y: 80 });
        lines = r.entities;
        b.dimension("distance", [lines[0]!], "width");
        b.dimension("distance", [lines[1]!], "depth");
      }),
    ),
  );
  const sketch = (store.document.features[sketchId] as SketchFeature).sketch;
  const region = detectProfiles(sketch)[0]!;
  const e: CreatedRef = {};
  store.execute(
    addExtrude({ sketchId, profiles: [profileRefOf(region)], distance: "height" }, e),
  );
  return { sketchId, extrudeId: e.id!, bodyId: e.bodyId! };
}

describe("document store", () => {
  it("builds a timeline with bodies", () => {
    const store = new DocumentStore(createDocument("Test"));
    const { sketchId, extrudeId, bodyId } = buildBox(store);
    const doc = store.document;
    expect(doc.timeline).toEqual([sketchId, extrudeId]);
    expect(doc.features[sketchId]!.name).toBe("Sketch001");
    expect(doc.features[extrudeId]!.name).toBe("Extrude001");
    expect(doc.bodies[bodyId]).toMatchObject({ name: "Body001", createdBy: extrudeId });
    expect(doc.features[extrudeId]!.componentId).toBe(doc.assembly.rootComponentId);
  });

  it("undoes and redoes every kind of change", () => {
    const store = new DocumentStore(createDocument());
    const initial = store.document;
    const { extrudeId, bodyId } = buildBox(store);
    const built = store.document;

    store.execute(updateParameter(built.parameters[0]!.id, { expression: "120" }));
    store.execute(updateFeature<ExtrudeFeature>(extrudeId, { distance: "75" }));
    store.execute(addFillet({ bodyId, edges: [{ point: { x: 0, y: 0, z: 10 } }], radius: "3" }));
    store.execute(removeFeatures([extrudeId]));
    expect(store.document.bodies[bodyId]).toBeUndefined();
    expect(store.document.timeline).toHaveLength(2);

    store.undo();
    expect(store.document.bodies[bodyId]).toBeDefined();
    store.undo();
    store.undo();
    expect((store.document.features[extrudeId] as ExtrudeFeature).distance).toBe("height");
    store.undo();
    expect(store.document).toBe(built);
    expect(store.undoLabel).toBe("Extrude");
    while (store.canUndo) store.undo();
    expect(store.document).toBe(initial);

    while (store.canRedo) store.redo();
    expect(store.document.timeline).toHaveLength(2);
    expect(store.document.parameters[0]!.expression).toBe("120");
  });

  it("clears redo after a new command and ignores no-ops", () => {
    const store = new DocumentStore(createDocument());
    store.execute(addParameter({ name: "a", expression: "1", unit: "" }));
    store.execute(addParameter({ name: "b", expression: "2", unit: "" }));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.execute(addParameter({ name: "c", expression: "3", unit: "" }));
    expect(store.canRedo).toBe(false);
    expect(store.execute(addParameter({ name: "c", expression: "4", unit: "" }))).toBe(false);
    expect(store.execute(addParameter({ name: "mm", expression: "4", unit: "" }))).toBe(false);
    expect(store.document.parameters.map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("collapses a transaction into one undo step", () => {
    const store = new DocumentStore(createDocument());
    const { sketchId } = buildBox(store);
    const before = store.document;
    let notifications = 0;
    const off = store.subscribe(() => notifications++);
    store.begin("Drag");
    const pointId = Object.keys((before.features[sketchId] as SketchFeature).sketch.entities)[0]!;
    for (let i = 1; i <= 5; i++) {
      store.update((d) =>
        applySketchEdit(d, sketchId, (s) => editSketch(s, (b) => b.movePoint(pointId, { x: i, y: i }))),
      );
    }
    expect(store.inTransaction).toBe(true);
    store.commit();
    off();
    expect(notifications).toBeGreaterThanOrEqual(5);
    expect(store.undoLabel).toBe("Drag");
    store.undo();
    expect(store.document).toBe(before);

    store.begin("Cancelled");
    store.update((d) => ({ ...d, name: "changed" }));
    store.cancel();
    expect(store.document).toBe(before);
    expect(store.undoLabel).not.toBe("Cancelled");
  });

  it("tracks the saved state", () => {
    const store = new DocumentStore(createDocument());
    expect(store.dirty).toBe(false);
    store.execute(addParameter({ name: "a", expression: "1", unit: "" }));
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
    store.undo();
    expect(store.dirty).toBe(true);
  });

  it("inserts new features at the history marker", () => {
    const store = new DocumentStore(createDocument());
    const { sketchId, extrudeId } = buildBox(store);
    store.execute(setTimelineCursor(1));
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XZ" }, s));
    expect(store.document.timeline).toEqual([sketchId, s.id, extrudeId]);
    expect(store.document.timelineCursor).toBe(2);
  });
});

describe("dependency graph", () => {
  const setup = (): { doc: CadDocument; sketchId: string; extrudeId: string; filletId: string } => {
    const store = new DocumentStore(createDocument());
    const { sketchId, extrudeId, bodyId } = buildBox(store);
    const f: CreatedRef = {};
    store.execute(
      addFillet({ bodyId, edges: [{ point: { x: 0, y: 0, z: 10 } }], radius: "3" }, f),
    );
    return { doc: store.document, sketchId, extrudeId, filletId: f.id! };
  };

  it("links parameters, sketches and features", () => {
    const { doc, sketchId, extrudeId, filletId } = setup();
    const g = buildDependencyGraph(doc);
    expect([...g.dependsOn.get(paramNode("depth"))!]).toEqual([paramNode("width")]);
    expect(g.dependsOn.get(featureNode(sketchId))).toEqual(
      new Set([paramNode("width"), paramNode("depth")]),
    );
    expect(g.dependsOn.get(featureNode(extrudeId))).toEqual(
      new Set([paramNode("height"), featureNode(sketchId)]),
    );
    expect(g.dependsOn.get(featureNode(filletId))).toEqual(new Set([featureNode(extrudeId)]));
    expect(downstream(g, [paramNode("width")])).toContain(featureNode(filletId));
  });

  it("computes the features affected by a change", () => {
    const { doc, sketchId, extrudeId, filletId } = setup();
    expect(affectedFeatures(doc, { parameters: ["width"] })).toEqual([
      sketchId,
      extrudeId,
      filletId,
    ]);
    expect(affectedFeatures(doc, { parameters: ["height"] })).toEqual([extrudeId, filletId]);
    expect(affectedFeatures(doc, { features: [filletId] })).toEqual([filletId]);
  });

  it("rewrites expressions when a parameter is renamed", () => {
    const store = new DocumentStore(setup().doc);
    const id = store.document.parameters.find((q) => q.name === "width")!.id;
    store.execute(renameParameter(id, "w"));
    const doc = store.document;
    expect(doc.parameters.find((q) => q.name === "depth")!.expression).toBe("w * 0.8");
    const sketch = Object.values(doc.features).find((f) => f.type === "sketch") as SketchFeature;
    expect(Object.values(sketch.sketch.dimensions).map((d) => d.expression)).toEqual([
      "w",
      "depth",
    ]);
  });
});

describe("save / load", () => {
  it("round-trips a document through JSON", () => {
    const store = new DocumentStore(createDocument("Round trip"));
    buildBox(store);
    store.execute(setExtension("fabrication", { materialId: "mdf-5.5" }));
    const json = serializeDocument(store.document);
    const loaded = deserializeDocument(json);
    expect(loaded).toEqual(store.document);
    expect(JSON.parse(json).format).toBe("fabcad");
  });

  it("rejects foreign and newer files", () => {
    expect(() => deserializeDocument("not json")).toThrow(/JSON/);
    expect(() => deserializeDocument("{}")).toThrow(/not a FabCAD/);
    expect(() =>
      deserializeDocument(JSON.stringify({ format: "fabcad", formatVersion: 99, document: {} })),
    ).toThrow(/newer/);
  });
});

describe("bodies at the history marker", () => {
  function block(store: DocumentStore, x: number): string {
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Rectangle", (sk) =>
        editSketch(sk, (b) => void createRectangle2Point(b, { x, y: 0 }, { x: x + 10, y: 10 })),
      ),
    );
    const region = detectProfiles((store.document.features[s.id!] as SketchFeature).sketch)[0]!;
    const e: CreatedRef = {};
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "5" }, e));
    return e.bodyId!;
  }

  it("leaves out the bodies that Combine joined into another", () => {
    const store = new DocumentStore(createDocument("Join"));
    const a = block(store, 0);
    const b = block(store, 5);
    const c: CreatedRef = {};
    store.execute(addBoolean({ operation: "union", targetBodyId: a, toolBodyIds: [b] }, c));
    expect(listBodies(store.document).map((x) => x.id)).toEqual([a]);
    expect(consumedBodies(store.document)).toEqual(new Map([[b, c.id]]));
    // The record stays: before the Combine, or with it suppressed, both bodies are there.
    expect(store.document.bodies[b]).toBeDefined();
    const at = store.document.timeline.indexOf(c.id!);
    store.execute(setTimelineCursor(at));
    expect(listBodies(store.document).map((x) => x.id)).toEqual([a, b]);
    store.execute(setTimelineCursor(null));
    store.execute(updateFeature(c.id!, { suppressed: true }));
    expect(listBodies(store.document).map((x) => x.id)).toEqual([a, b]);
    // Keeping the tools keeps them listed.
    store.execute(updateFeature(c.id!, { suppressed: false, keepTools: true }));
    expect(listBodies(store.document).map((x) => x.id)).toEqual([a, b]);
  });
});
