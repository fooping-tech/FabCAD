import { quaternionFromAngles } from "@fabcad/assembly";
import {
  type CreatedComponent,
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addExtrude,
  addSketch,
  createComponent,
  createDocument,
  createInstance,
  setInstancesVisible,
  updateSketch,
} from "@fabcad/cad-document";
import { compilePrintJob } from "@fabcad/fabrication-print";
import { createRectangle2Point, detectProfiles, editSketch, profileRefOf } from "@fabcad/sketch";
import { describe, expect, it } from "vitest";
import { copyId, printBodies, printChoices, sourceBodyId, withCopyOrientations } from "../src/print/bodies";
import { defaultPrintWorkspaceSettings, toPrintSettings } from "../src/print/settingsModel";

function box(store: DocumentStore, componentId?: string): string {
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s, componentId));
  store.execute(
    updateSketch(s.id!, "Rectangle", (sk) =>
      editSketch(sk, (b) => {
        createRectangle2Point(b, { x: 0, y: 0 }, { x: 10, y: 10 });
      }),
    ),
  );
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const e: CreatedRef = {};
  store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(detectProfiles(sketch)[0]!)], distance: "5" }, e));
  return e.bodyId!;
}

/** A closed 10 × 10 × 5 box as a mesh (8 vertices, 12 triangles). */
function cube(): { positions: Float32Array; indices: Uint32Array } {
  const p = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}

function model() {
  const store = new DocumentStore(createDocument());
  const rootBody = box(store);
  const frame: CreatedComponent = {};
  store.execute(createComponent({ name: "Frame" }, frame));
  const frameBody = box(store, frame.id);
  const second: { id?: string } = {};
  store.execute(createInstance(frame.id!, second, { position: [50, 0, 0], rotation: quaternionFromAngles(0, 0, 30) }));
  return { store, rootBody, frameBody, frame: frame.id!, second: second.id! };
}

describe("3D printing of components", () => {
  it("prints a component's bodies once per visible instance, or once", () => {
    const m = model();
    const computed = new Set([m.rootBody, m.frameBody]);
    const settings = defaultPrintWorkspaceSettings();
    const choices = printChoices(m.store.document, settings, computed);
    expect(choices.map((c) => [c.id, c.included, c.copies])).toEqual([
      [m.rootBody, true, 1],
      [m.frameBody, true, 2],
    ]);
    const once = printChoices(m.store.document, { ...settings, copies: { [m.frame]: "once" } }, computed);
    expect(once[1]!.copies).toBe(1);
    m.store.execute(setInstancesVisible([m.second], false));
    expect(printChoices(m.store.document, settings, computed)[1]!.copies).toBe(1);
  });

  it("gives every copy an id and a name of its own, and the orientation of its body", () => {
    const m = model();
    const doc = m.store.document;
    const settings = { ...defaultPrintWorkspaceSettings(), orientations: { [m.frameBody]: "+z" as const } };
    const choices = printChoices(doc, settings, new Set([m.rootBody, m.frameBody]));
    const meshes = { [m.rootBody]: cube(), [m.frameBody]: cube() };
    const bodies = printBodies(doc, choices, meshes);
    expect(bodies.map((b) => [b.id, b.name])).toEqual([
      [m.rootBody, "Body001"],
      [m.frameBody, "Frame:1/Body002"],
      [copyId(m.frameBody, 1), "Frame:2/Body002"],
    ]);
    expect(sourceBodyId(copyId(m.frameBody, 1))).toBe(m.frameBody);
    const printSettings = withCopyOrientations(toPrintSettings(settings), bodies);
    expect(printSettings.orientations[copyId(m.frameBody, 1)]).toBe("+z");
    // The job lays out every copy.
    const job = compilePrintJob(bodies, printSettings);
    expect(job.parts.map((p) => p.bodyId)).toEqual(bodies.map((b) => b.id));
  });
});
