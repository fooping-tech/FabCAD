import { instanceMatrix, quaternionFromAngles, transformPoint } from "@fabcad/assembly";
import {
  type CadDocument,
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
import { createRectangle2Point, detectProfiles, editSketch, profileRefOf } from "@fabcad/sketch";
import { describe, expect, it } from "vitest";
import { defaultExportChoice, exportItems, instanceSteps } from "../src/app/exportModel";

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

function model(): { doc: CadDocument; rootBody: string; frameBody: string; frame: string; second: string } {
  const store = new DocumentStore(createDocument("Test"));
  const rootBody = box(store);
  const frame: CreatedComponent = {};
  store.execute(createComponent({ name: "Frame" }, frame));
  const frameBody = box(store, frame.id);
  const second: { id?: string } = {};
  store.execute(
    createInstance(frame.id!, second, { position: [100, 0, 0], rotation: quaternionFromAngles(0, 0, 90) }),
  );
  return { doc: store.document, rootBody, frameBody, frame: frame.id!, second: second.id! };
}

describe("3D model export", () => {
  it("starts with what is shown, or with the selection", () => {
    const m = model();
    const computed = new Set([m.rootBody, m.frameBody]);
    expect(defaultExportChoice(m.doc, [], computed)).toEqual({
      bodyIds: [m.rootBody, m.frameBody],
      placement: { [m.frame]: "instances" },
    });
    expect(defaultExportChoice(m.doc, [{ kind: "instance", instanceId: m.second }], computed).bodyIds).toEqual([
      m.frameBody,
    ]);
    // A body without geometry (behind the history marker …) cannot be written.
    expect(defaultExportChoice(m.doc, [], new Set([m.rootBody])).bodyIds).toEqual([m.rootBody]);
  });

  it("writes component bodies at every visible instance, or once at the origin", () => {
    const m = model();
    const choice = { bodyIds: [m.rootBody, m.frameBody], placement: { [m.frame]: "instances" as const } };
    const items = exportItems(m.doc, choice);
    expect(items.map((i) => i.name)).toEqual(["Body001", "Frame:1/Body002", "Frame:2/Body002"]);
    expect(items[0]!.steps).toBeUndefined();
    expect(items[1]!.steps).toEqual([]);
    expect(exportItems(m.doc, { ...choice, placement: { [m.frame]: "origin" } }).map((i) => i.name)).toEqual([
      "Body001",
      "Frame/Body002",
    ]);
    const hidden = { ...m.doc, assembly: setInstancesVisible([m.second], false).apply(m.doc).assembly };
    expect(exportItems(hidden, choice).map((i) => i.name)).toEqual(["Body001", "Frame:1/Body002"]);
  });

  it("places a copy like the instance: the turn about the origin, then the move", () => {
    const t = { position: [100, 5, -3] as [number, number, number], rotation: quaternionFromAngles(30, -20, 90) };
    const p = { x: 3, y: 4, z: 5 };
    let q = { ...p };
    for (const s of instanceSteps(t)) {
      if (s.type === "translate") q = { x: q.x + s.vector.x, y: q.y + s.vector.y, z: q.z + s.vector.z };
      else if (s.type === "rotate") {
        // Rodrigues about an axis through the origin.
        const a = (s.angle * Math.PI) / 180;
        const k = s.axis;
        const dot = k.x * q.x + k.y * q.y + k.z * q.z;
        const cross = { x: k.y * q.z - k.z * q.y, y: k.z * q.x - k.x * q.z, z: k.x * q.y - k.y * q.x };
        q = {
          x: q.x * Math.cos(a) + cross.x * Math.sin(a) + k.x * dot * (1 - Math.cos(a)),
          y: q.y * Math.cos(a) + cross.y * Math.sin(a) + k.y * dot * (1 - Math.cos(a)),
          z: q.z * Math.cos(a) + cross.z * Math.sin(a) + k.z * dot * (1 - Math.cos(a)),
        };
      }
    }
    const expected = transformPoint(instanceMatrix(t), p);
    expect(q.x).toBeCloseTo(expected.x);
    expect(q.y).toBeCloseTo(expected.y);
    expect(q.z).toBeCloseTo(expected.z);
  });
});
