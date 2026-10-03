import { describe, expect, it } from "vitest";
import {
  type CreatedRef,
  DocumentStore,
  addBoolean,
  addExtrude,
  addImport,
  addSketch,
  createDocument,
  deserializeDocument,
  updateSketch,
} from "@fabcad/cad-document";
import { FeatureEngine } from "@fabcad/features";
import { createRectangle2Point, detectProfiles, editSketch, profileRefOf } from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import { historyLog, meshPieces } from "../src/app/historyLog";

describe("history log", () => {
  it("lists the steps with their status, the bodies, and the project to load again", async () => {
    const store = new DocumentStore(createDocument());
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Rect", (k) =>
        editSketch(k, (b) => {
          createRectangle2Point(b, { x: 0, y: 0 }, { x: 30, y: 20 });
        }),
      ),
    );
    const sketch = store.document.features[s.id!];
    if (sketch?.type !== "sketch") throw new Error("no sketch");
    const region = detectProfiles(sketch.sketch)[0]!;
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "5" }));
    const engine = new FeatureEngine(await nodeKernel(), createDefaultSolver());
    const result = await engine.recompute(store.document);
    const bodyId = Object.keys(store.document.bodies)[0]!;
    const geometry = engine.bodyGeometry(bodyId)!;
    expect(meshPieces(geometry)).toBe(1);

    const statuses = result.features;
    const log = historyLog(store.document, statuses, { [bodyId]: { geometry } }, {
      version: "1.2.3",
      date: new Date("2026-10-02T00:00:00Z"),
    });
    expect(log).toContain("FabCAD history log · 1.2.3 · 2026-10-02T00:00:00.000Z");
    expect(log).toMatch(/1\. Sketch001 \[sketch\] .* — ok/);
    expect(log).toContain("plane XY · 5 point, 4 line");
    expect(log).toMatch(/2\. Extrude001 \[extrude\] .* — ok/);
    expect(log).toContain("distance 5");
    expect(log).toContain("volume 3000 mm³");
    expect(log).toContain("6 faces (6 plane)");
    expect(log).toContain("1 separate pieces");
    // The project at the end loads again as it was.
    const json = log.slice(log.indexOf("Project (JSON):\n") + "Project (JSON):\n".length);
    expect(deserializeDocument(json).features).toEqual(store.document.features);
  });

  it("gives the size of a long value, such as an imported file, instead of the value", () => {
    const store = new DocumentStore(createDocument());
    const data = "A".repeat(50_000);
    store.execute(addImport({ format: "step", fileName: "part.step", data }));
    const log = historyLog(store.document, {}, {}, { version: "", date: new Date(0), project: false });
    expect(log).toContain("fileName part.step");
    expect(log).toContain("data (50000 characters)");
    expect(log.length).toBeLessThan(1000);
  });

  it("says which step used a body up", () => {
    const store = new DocumentStore(createDocument());
    const a: CreatedRef = {};
    const b: CreatedRef = {};
    store.execute(addImport({ format: "step", fileName: "a.step", data: "x" }, a));
    store.execute(addImport({ format: "step", fileName: "b.step", data: "x" }, b));
    store.execute(addBoolean({ operation: "union", targetBodyId: a.bodyId!, toolBodyIds: [b.bodyId!] }));
    const log = historyLog(store.document, {}, {}, { version: "", date: new Date(0), project: false });
    expect(log).toContain(`- b (${b.bodyId}): used up by Combine001`);
    expect(log).toContain(`- a (${a.bodyId}): no result`);
  });
});
