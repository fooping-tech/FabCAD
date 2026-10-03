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
  componentContents,
  createComponent,
  createDocument,
  createInstance,
  deserializeDocument,
  duplicateInstances,
  listInstances,
  removeComponents,
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
});
