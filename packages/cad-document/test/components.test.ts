import { describe, expect, it } from "vitest";
import { createRectangle2Point, detectProfiles, editSketch, profileRefOf } from "@fabcad/sketch";
import { ROOT_INSTANCE_ID, quaternionFromAngles } from "@fabcad/assembly";
import {
  type CreatedComponent,
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addBoolean,
  addExtrude,
  addFillet,
  addSketch,
  addSplit,
  componentContents,
  createComponent,
  createDocument,
  createInstance,
  deserializeDocument,
  duplicateInstances,
  listInstances,
  moveToComponent,
  type MoveFeature,
  type MovedToComponent,
  relativePlacement,
  removeComponents,
  separationProblem,
  removeInstances,
  renameComponent,
  serializeDocument,
  setComponentVisible,
  setInstanceTransform,
  setInstancesVisible,
  updateSketch,
} from "../src";

/** A sketch with a rectangle at `x` and its extrusion, in `componentId` (the root by default). */
function box(store: DocumentStore, x: number, componentId?: string) {
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s, componentId));
  store.execute(
    updateSketch(s.id!, "Rectangle", (sk) =>
      editSketch(sk, (b) => {
        createRectangle2Point(b, { x, y: 0 }, { x: x + 10, y: 10 });
      }),
    ),
  );
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const e: CreatedRef = {};
  store.execute(
    addExtrude({ sketchId: s.id!, profiles: [profileRefOf(detectProfiles(sketch)[0]!)], distance: "5" }, e),
  );
  return { sketchId: s.id!, extrudeId: e.id!, bodyId: e.bodyId! };
}

/** A sketch with a rectangle on a face of `bodyId` (at z = `z`), extruded with `input`. */
function onFace(
  store: DocumentStore,
  bodyId: string,
  z: number,
  input: { operation?: "new" | "join" | "cut"; targetBodyIds?: string[] } = {},
) {
  const s: CreatedRef = {};
  const plane = {
    origin: { x: 0, y: 0, z },
    normal: { x: 0, y: 0, z: 1 },
    xDir: { x: 1, y: 0, z: 0 },
    yDir: { x: 0, y: 1, z: 0 },
  };
  const owner = store.document.bodies[bodyId]!.componentId;
  store.execute(addSketch({ type: "face", bodyId, hint: { x: 1, y: 1, z }, plane }, s, owner));
  store.execute(
    updateSketch(s.id!, "Rectangle", (sk) =>
      editSketch(sk, (b) => {
        createRectangle2Point(b, { x: 1, y: 1 }, { x: 4, y: 4 });
      }),
    ),
  );
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const e: CreatedRef = {};
  store.execute(
    addExtrude({ sketchId: s.id!, profiles: [profileRefOf(detectProfiles(sketch)[0]!)], distance: "2", ...input }, e),
  );
  return { sketchId: s.id!, extrudeId: e.id!, bodyId: e.bodyId! };
}

describe("components", () => {
  it("makes an empty definition with a first instance, and owns what is made in it", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, out));
    const doc = store.document;
    expect(doc.assembly.components[out.id!]).toEqual({ id: out.id, name: "Frame" });
    expect(listInstances(doc).map((i) => [i.name, i.componentId])).toEqual([["Frame:1", out.id]]);

    const made = box(store, 0, out.id);
    const after = store.document;
    expect(after.features[made.sketchId]!.componentId).toBe(out.id);
    // Features take the component of what they are built on.
    expect(after.features[made.extrudeId]!.componentId).toBe(out.id);
    expect(after.bodies[made.bodyId]!.componentId).toBe(out.id);
    expect(componentContents(after, out.id!)).toEqual({
      sketchIds: [made.sketchId],
      featureIds: [made.sketchId, made.extrudeId],
      bodyIds: [made.bodyId],
    });
  });

  it("moves selected bodies into a new definition with the history they depend on", () => {
    const store = new DocumentStore(createDocument());
    const a = box(store, 0);
    const b = box(store, 50);
    store.execute(addFillet({ bodyId: a.bodyId, edges: [{ point: { x: 0, y: 0, z: 2 } }], radius: "1" }));
    const fillet = store.document.timeline.at(-1)!;
    const timeline = store.document.timeline;
    const out: CreatedComponent = {};
    store.execute(createComponent({ bodyIds: [a.bodyId] }, out));
    const doc = store.document;
    expect(out.featureIds).toEqual([a.sketchId, a.extrudeId, fillet]);
    expect(out.bodyIds).toEqual([a.bodyId]);
    // The other box stays in the root.
    expect(doc.features[b.extrudeId]!.componentId).toBe(doc.assembly.rootComponentId);
    expect(doc.bodies[b.bodyId]!.componentId).toBe(doc.assembly.rootComponentId);
    // The timeline is not reordered.
    expect(doc.timeline).toBe(timeline);
  });

  it("takes a body out of a component into a new one, placed like the old one's instances", () => {
    const store = new DocumentStore(createDocument());
    const frame: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, frame));
    const a = box(store, 0, frame.id);
    const b = box(store, 50, frame.id);
    const second: { id?: string } = {};
    store.execute(createInstance(frame.id!, second, { position: [0, 100, 0], rotation: [0, 0, 0, 1] }));
    store.execute(setInstancesVisible([second.id!], false));

    const out: CreatedComponent = {};
    store.execute(createComponent({ bodyIds: [b.bodyId] }, out));
    const doc = store.document;
    expect(out.sourceComponentId).toBe(frame.id);
    expect(doc.bodies[b.bodyId]!.componentId).toBe(out.id);
    expect(doc.features[b.extrudeId]!.componentId).toBe(out.id);
    expect(doc.bodies[a.bodyId]!.componentId).toBe(frame.id);
    expect(
      listInstances(doc, out.id).map((i) => [i.transform.position, i.visible]),
    ).toEqual([
      [[0, 0, 0], true],
      [[0, 100, 0], false],
    ]);
  });

  it("moves a body into an existing component and keeps it where it was seen", () => {
    const store = new DocumentStore(createDocument());
    const frame: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, frame));
    box(store, 0, frame.id);
    store.execute(
      setInstanceTransform(frame.instanceId!, { position: [100, 0, 0], rotation: quaternionFromAngles(0, 0, 90) }),
    );
    const loose = box(store, 20);
    const out: MovedToComponent = {};
    expect(store.execute(moveToComponent({ bodyIds: [loose.bodyId] }, frame.id!, out))).toBe(true);
    const doc = store.document;
    expect(doc.bodies[loose.bodyId]!.componentId).toBe(frame.id);
    expect(doc.features[loose.sketchId]!.componentId).toBe(frame.id);
    // The root is at the origin, Frame at (100, 0, 0) turned by 90°: a Move takes the body back.
    const move = doc.features[out.moveId!] as MoveFeature;
    expect(move.componentId).toBe(frame.id);
    expect(move.bodyIds).toEqual([loose.bodyId]);
    expect(move.transform).toMatchObject({ type: "free", x: "0", y: "100", z: "0", rx: "0", ry: "0", rz: "-90" });
    expect(doc.timeline.at(-1)).toBe(out.moveId);
    store.undo();
    expect(store.document.bodies[loose.bodyId]!.componentId).toBe(store.document.assembly.rootComponentId);
  });

  it("adds no Move when both components are placed alike, and moves bodies back to the root", () => {
    const store = new DocumentStore(createDocument());
    const frame: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, frame));
    const inside = box(store, 0, frame.id);
    const loose = box(store, 20);
    const out: MovedToComponent = {};
    store.execute(moveToComponent({ bodyIds: [loose.bodyId] }, frame.id!, out));
    expect(out.moveId).toBeUndefined();
    const root = store.document.assembly.rootComponentId;
    store.execute(moveToComponent({ bodyIds: [inside.bodyId] }, root));
    expect(store.document.bodies[inside.bodyId]!.componentId).toBe(root);
    // Into the component it already belongs to: nothing to do.
    expect(store.execute(moveToComponent({ bodyIds: [inside.bodyId] }, root))).toBe(false);
  });

  it("separates bodies that only refer to each other's faces", () => {
    const store = new DocumentStore(createDocument());
    const frame: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, frame));
    const base = box(store, 0, frame.id);
    // A lid sketched on a face of the base, and a cut into the base sketched on the lid.
    const lid = onFace(store, base.bodyId, 5);
    const cut = onFace(store, lid.bodyId, 7, { operation: "cut", targetBodyIds: [base.bodyId] });
    expect(separationProblem(store.document, { bodyIds: [lid.bodyId] })).toBeNull();
    const out: CreatedComponent = {};
    store.execute(createComponent({ bodyIds: [lid.bodyId] }, out));
    const doc = store.document;
    expect(out.bodyIds).toEqual([lid.bodyId]);
    expect(out.featureIds).toEqual([lid.sketchId, lid.extrudeId]);
    expect(doc.features[cut.extrudeId]).toBeDefined();
    // The cut changes the base: it stays, with its sketch, which refers to the lid's face.
    expect(doc.features[cut.extrudeId]!.componentId).toBe(frame.id);
    expect(doc.features[cut.sketchId]!.componentId).toBe(frame.id);
    expect(doc.bodies[base.bodyId]!.componentId).toBe(frame.id);
  });

  it("explains which feature ties two bodies together", () => {
    const store = new DocumentStore(createDocument());
    const base = box(store, 0);
    const lid = onFace(store, base.bodyId, 5);
    onFace(store, lid.bodyId, 7, { operation: "join", targetBodyIds: [base.bodyId, lid.bodyId] });
    const problem = separationProblem(store.document, { bodyIds: [lid.bodyId] });
    const tie = store.document.timeline.at(-1)!;
    expect(problem?.ties).toEqual([tie]);
    expect(problem?.bodyIds).toEqual([base.bodyId]);
    expect(problem?.message).toMatch(/^"Extrude003" also changes "Body001", so it would have to move/);
    expect(separationProblem(store.document, { bodyIds: [lid.bodyId, base.bodyId] })).toBeNull();
  });

  it("names the step that ties the selection first, and the chain behind it after", () => {
    const store = new DocumentStore(createDocument());
    const base = box(store, 0);
    const split: CreatedRef = {};
    store.execute(addSplit({ bodyId: base.bodyId, tool: { type: "origin-plane", plane: "YZ" } }, split));
    const lid = onFace(store, base.bodyId, 5);
    onFace(store, lid.bodyId, 7, { operation: "join", targetBodyIds: [base.bodyId, lid.bodyId] });
    const join = store.document.timeline.at(-1)!;
    const problem = separationProblem(store.document, { bodyIds: [lid.bodyId] })!;
    expect(problem.ties).toEqual([join]);
    expect(problem.chain).toEqual([split.id]);
    expect(problem.bodyIds.sort()).toEqual([base.bodyId, split.bodyId!].sort());
    expect(problem.message).toContain('Through it, "Body001 (Split Body001)" would follow as well ("Split Body001").');
  });

  it("takes along bodies that a Combine ties together", () => {
    const store = new DocumentStore(createDocument());
    const a = box(store, 0);
    const b = box(store, 5);
    store.execute(addBoolean({ operation: "union", targetBodyId: a.bodyId, toolBodyIds: [b.bodyId] }));
    const out: CreatedComponent = {};
    store.execute(createComponent({ bodyIds: [a.bodyId] }, out));
    expect(out.bodyIds!.sort()).toEqual([a.bodyId, b.bodyId].sort());
    expect(out.featureIds).toHaveLength(5);
  });

  it("refuses to combine bodies of different components", () => {
    const store = new DocumentStore(createDocument());
    const a = box(store, 0);
    store.execute(createComponent({ bodyIds: [a.bodyId] }));
    const b = box(store, 5);
    expect(store.execute(addBoolean({ operation: "union", targetBodyId: b.bodyId, toolBodyIds: [a.bodyId] }))).toBe(false);
    // Nor joins an extrusion of one component to a body of another.
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Rectangle", (sk) =>
        editSketch(sk, (bd) => {
          createRectangle2Point(bd, { x: 0, y: 0 }, { x: 3, y: 3 });
        }),
      ),
    );
    const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
    const joined = addExtrude({
      sketchId: s.id!,
      profiles: [profileRefOf(detectProfiles(sketch)[0]!)],
      distance: "2",
      operation: "join",
      targetBodyIds: [a.bodyId],
    });
    expect(store.execute(joined)).toBe(false);
  });

  it("places, duplicates, hides and deletes instances without touching the definition", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedComponent = {};
    store.execute(createComponent({ name: "Trigger" }, out));
    const made = box(store, 0, out.id);
    const second: { id?: string } = {};
    store.execute(createInstance(out.id!, second));
    store.execute(
      setInstanceTransform(second.id!, { position: [20, 0, 0], rotation: quaternionFromAngles(0, 0, 90) }),
    );
    const dup: { ids?: string[] } = {};
    store.execute(duplicateInstances([second.id!], dup));
    let doc = store.document;
    const copy = doc.assembly.instances[dup.ids![0]!]!;
    expect(copy.componentId).toBe(out.id);
    expect(copy.transform.position).toEqual([20, 0, 0]);
    expect(listInstances(doc, out.id).map((i) => i.name)).toEqual(["Trigger:1", "Trigger:2", "Trigger:3"]);
    // One definition, no copied history.
    expect(Object.keys(doc.features)).toHaveLength(2);

    store.execute(setInstancesVisible([second.id!], false));
    expect(store.document.assembly.instances[second.id!]!.visible).toBe(false);
    store.execute(setComponentVisible(out.id!, true));
    expect(listInstances(store.document).every((i) => i.visible)).toBe(true);

    store.execute(removeInstances(listInstances(store.document).map((i) => i.id)));
    doc = store.document;
    expect(listInstances(doc)).toEqual([]);
    expect(doc.assembly.components[out.id!]).toBeDefined();
    expect(doc.bodies[made.bodyId]).toBeDefined();
  });

  it("renames instances with their definition", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, out));
    store.execute(createInstance(out.id!));
    store.execute(renameComponent(out.id!, "Base"));
    expect(listInstances(store.document).map((i) => i.name)).toEqual(["Base:1", "Base:2"]);
  });

  it("deletes a definition with its history and instances, and undoes that", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, out));
    const made = box(store, 0, out.id);
    const kept = box(store, 30);
    const before = store.document;
    store.execute(removeComponents([out.id!]));
    const doc = store.document;
    expect(doc.assembly.components[out.id!]).toBeUndefined();
    expect(listInstances(doc)).toEqual([]);
    expect(doc.features[made.extrudeId]).toBeUndefined();
    expect(doc.bodies[made.bodyId]).toBeUndefined();
    expect(doc.bodies[kept.bodyId]).toBeDefined();
    expect(doc.assembly.instances[ROOT_INSTANCE_ID]).toBeDefined();
    store.undo();
    expect(store.document).toBe(before);
  });

  it("keeps definitions and instances through save and load", () => {
    const store = new DocumentStore(createDocument());
    const out: CreatedComponent = {};
    store.execute(createComponent({ name: "Frame" }, out));
    box(store, 0, out.id);
    const second: { id?: string } = {};
    store.execute(createInstance(out.id!, second, { position: [1, 2, 3], rotation: [0, 0, 0, 1] }));
    const loaded = deserializeDocument(serializeDocument(store.document));
    expect(loaded.assembly).toEqual(store.document.assembly);
    expect(loaded.features).toEqual(store.document.features);
    expect(loaded.bodies).toEqual(store.document.bodies);
  });

  it("reads the instance matrices of older files and gives orphans to the root", () => {
    const doc = createDocument();
    const file = JSON.parse(serializeDocument(doc));
    file.document.assembly.instances[ROOT_INSTANCE_ID].transform = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ];
    file.document.assembly.components.c1 = { id: "c1", name: "Old" };
    file.document.assembly.instances.i1 = {
      id: "i1",
      name: "Old:1",
      componentId: "c1",
      parentInstanceId: ROOT_INSTANCE_ID,
      transform: [1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7, 0, 0, 0, 1],
      visible: true,
    };
    file.document.bodies = {
      "body-9": { id: "body-9", name: "B", componentId: "gone", visible: true, createdBy: "x" },
    };
    const loaded = deserializeDocument(JSON.stringify(file));
    expect(loaded.assembly.instances[ROOT_INSTANCE_ID]!.transform).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    });
    expect(loaded.assembly.instances.i1!.transform.position).toEqual([5, 6, 7]);
    expect(loaded.bodies["body-9"]!.componentId).toBe(loaded.assembly.rootComponentId);
  });

  it("places one component as seen from another, at a chosen instance", () => {
    const store = new DocumentStore(createDocument());
    const a: CreatedComponent = {};
    const b: CreatedComponent = {};
    store.execute(createComponent({ name: "A" }, a));
    store.execute(createComponent({ name: "B" }, b));
    store.execute(setInstanceTransform(a.instanceId!, { position: [10, 0, 0], rotation: [0, 0, 0, 1] }));
    store.execute(setInstanceTransform(b.instanceId!, { position: [0, 50, 0], rotation: [0, 0, 0, 1] }));
    const second: { id?: string } = {};
    store.execute(createInstance(b.id!, second, { position: [0, 90, 0], rotation: [0, 0, 0, 1] }));
    const doc = store.document;
    const root = doc.assembly.rootComponentId;
    // B seen from A: B's first instance relative to A's.
    expect(relativePlacement(doc, b.id!, a.id!).position).toEqual([-10, 50, 0]);
    expect(relativePlacement(doc, b.id!, a.id!, second.id!).position).toEqual([-10, 90, 0]);
    // The root is at the origin.
    expect(relativePlacement(doc, root, a.id!).position).toEqual([-10, 0, 0]);
    expect(relativePlacement(doc, a.id!, a.id!).position).toEqual([0, 0, 0]);
  });
});
