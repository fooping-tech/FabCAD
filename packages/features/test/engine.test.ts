import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import {
  type CadDocument,
  type CreatedRef,
  DocumentStore,
  type ExtrudeFeature,
  type FilletFeature,
  type ShellFeature,
  type SketchFeature,
  addBoolean,
  addChamfer,
  addExtrude,
  addFillet,
  addParameter,
  addShell,
  addSketch,
  command,
  createDocument,
  deserializeDocument,
  removeFeatures,
  serializeDocument,
  setFeatureSuppressed,
  setTimelineCursor,
  updateFeature,
  updateParameter,
  updateSketch,
} from "@fabcad/cad-document";
import {
  type Sketch,
  createCircle,
  createPolyline,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../brep/test/nodeKernel";
import { FeatureEngine, resolveDocumentSketches, solveSketchWithParameters } from "../src";

let kernel: GeometryKernel;
const solver = createDefaultSolver();

beforeAll(async () => {
  kernel = await nodeKernel();
});

/** Mirror of what the app does: parameter changes re-solve sketches inside the same command. */
function run(store: DocumentStore, cmd: ReturnType<typeof command>): void {
  store.execute(
    command(cmd.label, (doc) => {
      const next = cmd.apply(doc);
      return next.parameters !== doc.parameters ? resolveDocumentSketches(next, solver) : next;
    }),
  );
}

function sketchOf(doc: CadDocument, id: string): Sketch {
  return (doc.features[id] as SketchFeature).sketch;
}

function solvedEdit(store: DocumentStore, id: string, edit: (s: Sketch) => Sketch): void {
  store.execute(
    updateSketch(id, "Edit sketch", (s) => {
      const info = solveSketchWithParameters(edit(s), solver, () => undefined);
      expect(info.converged).toBe(true);
      return info.sketch;
    }),
  );
}

/** Scenario A: rectangle, H/V constraints, 100 × 80 dimensions, extrude 50. */
function scenarioA(store: DocumentStore): { sketchId: string; extrudeId: string; bodyId: string } {
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  const sketchId = s.id!;
  solvedEdit(store, sketchId, (sk) =>
    editSketch(sk, (b) => {
      // Drawn sloppily on purpose: the dimensions drive the size.
      const r = createRectangle2Point(b, { x: 3, y: 2 }, { x: 95, y: 71 });
      b.dimension("distance", [r.entities[0]!], "100");
      b.dimension("distance", [r.entities[1]!], "80");
      b.constrain("fix", r.points[0]!);
    }),
  );
  const region = detectProfiles(sketchOf(store.document, sketchId))[0]!;
  const e: CreatedRef = {};
  store.execute(addExtrude({ sketchId, profiles: [profileRefOf(region)], distance: "50" }, e));
  return { sketchId, extrudeId: e.id!, bodyId: e.bodyId! };
}

describe("feature engine", () => {
  it("Scenario A: sketch → constraints → dimensions → extrude → body", async () => {
    const store = new DocumentStore(createDocument());
    const { sketchId, extrudeId, bodyId } = scenarioA(store);
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);

    expect(result.features[sketchId]!.state).toBe("ok");
    expect(result.features[extrudeId]!.state).toBe("ok");
    expect(result.sketches[sketchId]).toMatchObject({
      status: "fully-constrained",
      degreesOfFreedom: 0,
      regionCount: 1,
    });
    expect(result.bodies).toHaveLength(1);
    const g = result.bodies[0]!.geometry!;
    expect(result.bodies[0]!.id).toBe(bodyId);
    expect(g.volume).toBeCloseTo(100 * 80 * 50, 2);
    expect(g.faces).toHaveLength(6);
    expect(g.bounds.max.x - g.bounds.min.x).toBeCloseTo(100, 5);
    expect(g.bounds.max.y - g.bounds.min.y).toBeCloseTo(80, 5);
    expect(g.bounds.max.z).toBeCloseTo(50, 5);
    expect(engine.bodyTopology(bodyId)!.faces).toHaveLength(6);
  });

  it("recomputes only what a change affects", async () => {
    const store = new DocumentStore(createDocument());
    const { extrudeId, bodyId } = scenarioA(store);
    const f: CreatedRef = {};
    store.execute(
      addFillet({ bodyId, edges: [{ point: { x: 3, y: 2, z: 25 } }], radius: "5" }, f),
    );
    const engine = new FeatureEngine(kernel, solver);
    const first = await engine.recompute(store.document);
    expect(engine.lastEvaluated).toEqual([extrudeId, f.id]);
    expect(first.bodies[0]!.geometry!.faces).toHaveLength(7);

    // Nothing changed: everything is served from the cache and no geometry is re-sent.
    const again = await engine.recompute(store.document, {
      known: { [bodyId]: first.bodies[0]!.hash },
    });
    expect(engine.lastEvaluated).toEqual([]);
    expect(again.features[extrudeId]!.cached).toBe(true);
    expect(again.bodies[0]!.geometry).toBeNull();

    // Changing only the fillet leaves the extrude cached.
    store.execute(updateFeature<FilletFeature>(f.id!, { radius: "8" }));
    const third = await engine.recompute(store.document);
    expect(engine.lastEvaluated).toEqual([f.id]);
    expect(third.bodies[0]!.hash).not.toBe(first.bodies[0]!.hash);

    // Changing the extrude recomputes the fillet downstream of it.
    store.execute(updateFeature<ExtrudeFeature>(extrudeId, { distance: "60" }));
    const fourth = await engine.recompute(store.document);
    expect(engine.lastEvaluated).toEqual([extrudeId, f.id]);
    expect(fourth.bodies[0]!.geometry!.bounds.max.z).toBeCloseTo(60, 5);
  });

  it("drives geometry from parameters", async () => {
    const store = new DocumentStore(createDocument());
    run(store, addParameter({ name: "width", expression: "100 mm", unit: "mm" }));
    run(store, addParameter({ name: "depth", expression: "width * 0.8", unit: "mm" }));
    run(store, addParameter({ name: "height", expression: "depth / 2 + 10", unit: "mm" }));
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Rectangle", (sk) => {
        const edited = editSketch(sk, (b) => {
          const r = createRectangle2Point(b, { x: 0, y: 0 }, { x: 50, y: 50 });
          b.dimension("distance", [r.entities[0]!], "width");
          b.dimension("distance", [r.entities[1]!], "depth");
          b.constrain("fix", r.points[0]!);
        });
        return edited;
      }),
    );
    // The sketch is still 50 × 50 in the document; a parameter change re-solves it.
    const region = detectProfiles(sketchOf(store.document, s.id!))[0]!;
    const e: CreatedRef = {};
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "height" }, e));

    const engine = new FeatureEngine(kernel, solver);
    let g = (await engine.recompute(store.document)).bodies[0]!.geometry!;
    expect(g.volume).toBeCloseTo(100 * 80 * 50, 2);

    const width = store.document.parameters.find((p) => p.name === "width")!;
    run(store, updateParameter(width.id, { expression: "150" }));
    // The document itself now holds the re-solved sketch.
    const bounds = detectProfiles(sketchOf(store.document, s.id!))[0]!;
    expect(bounds.area).toBeCloseTo(150 * 120, 4);
    g = (await engine.recompute(store.document)).bodies[0]!.geometry!;
    expect(g.volume).toBeCloseTo(150 * 120 * 70, 1);

    store.undo();
    g = (await engine.recompute(store.document)).bodies[0]!.geometry!;
    expect(g.volume).toBeCloseTo(100 * 80 * 50, 2);
  });

  it("joins, cuts and intersects with extrudes and keeps profiles with holes", async () => {
    const store = new DocumentStore(createDocument());
    const { bodyId } = scenarioA(store);
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Circles", (sk) =>
        editSketch(sk, (b) => {
          createCircle(b, { x: 50, y: 40 }, 20);
          createCircle(b, { x: 50, y: 40 }, 10);
        }),
      ),
    );
    const regions = detectProfiles(sketchOf(store.document, s.id!));
    expect(regions).toHaveLength(2);
    const ring = regionAtPoint(regions, { x: 65, y: 40 })!;
    const disc = regionAtPoint(regions, { x: 50, y: 40 })!;

    const cut: CreatedRef = {};
    store.execute(
      addExtrude(
        {
          sketchId: s.id!,
          profiles: [profileRefOf(ring)],
          distance: "60",
          operation: "cut",
          targetBodyIds: [bodyId],
        },
        cut,
      ),
    );
    const join: CreatedRef = {};
    store.execute(
      addExtrude(
        {
          sketchId: s.id!,
          profiles: [profileRefOf(disc)],
          distance: "70",
          operation: "join",
          targetBodyIds: [bodyId],
        },
        join,
      ),
    );
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);
    expect(result.features[cut.id!]!.state).toBe("ok");
    expect(result.features[join.id!]!.state).toBe("ok");
    expect(result.bodies).toHaveLength(1);
    const ringArea = Math.PI * (400 - 100);
    const expected = 100 * 80 * 50 - ringArea * 50 + Math.PI * 100 * 20;
    expect(result.bodies[0]!.geometry!.volume).toBeCloseTo(expected, 0);
    // Only one body record exists: modifying operations do not create bodies.
    expect(Object.keys(store.document.bodies)).toEqual([bodyId]);
  });

  it("combines bodies, chamfers and shells", async () => {
    const store = new DocumentStore(createDocument());
    const { bodyId } = scenarioA(store);
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Rectangle", (sk) =>
        editSketch(sk, (b) => {
          createRectangle2Point(b, { x: 80, y: 2 }, { x: 140, y: 82 });
        }),
      ),
    );
    const region = detectProfiles(sketchOf(store.document, s.id!))[0]!;
    const tool: CreatedRef = {};
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "50" }, tool));
    const c: CreatedRef = {};
    store.execute(
      addBoolean({ operation: "union", targetBodyId: bodyId, toolBodyIds: [tool.bodyId!] }, c),
    );
    const ch: CreatedRef = {};
    store.execute(
      addChamfer({ bodyId, edges: [{ point: { x: 3, y: 42, z: 50 } }], distance: "4" }, ch),
    );
    const sh: CreatedRef = {};
    store.execute(
      addShell(
        {
          bodyId,
          faces: [{ point: { x: 70, y: 40, z: 50 }, normal: { x: 0, y: 0, z: 1 } }],
          thickness: "2",
        },
        sh,
      ),
    );
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);
    for (const id of [c.id!, ch.id!, sh.id!]) expect(result.features[id]!.state).toBe("ok");
    // The tool body was consumed by the union.
    expect(result.bodies.map((b) => b.id)).toEqual([bodyId]);
    const g = result.bodies[0]!.geometry!;
    expect(g.bounds.max.x - g.bounds.min.x).toBeCloseTo(137, 4);
    expect(g.volume).toBeLessThan(137 * 80 * 50 * 0.2);

    // A shell that cannot be built is reported instead of silently returning the input.
    store.execute(updateFeature<ShellFeature>(sh.id!, { thickness: "45" }));
    const failed = await engine.recompute(store.document);
    expect(failed.features[sh.id!]!.state).toBe("error");
  });

  it("reports errors per feature and carries on", async () => {
    const store = new DocumentStore(createDocument());
    const { sketchId, extrudeId, bodyId } = scenarioA(store);
    const f: CreatedRef = {};
    store.execute(
      addFillet({ bodyId, edges: [{ point: { x: 3, y: 2, z: 25 } }], radius: "500" }, f),
    );
    const engine = new FeatureEngine(kernel, solver);
    let result = await engine.recompute(store.document);
    expect(result.features[f.id!]).toMatchObject({ state: "error" });
    expect(result.features[extrudeId]!.state).toBe("ok");
    // The body survives in its state before the failed feature.
    expect(result.bodies[0]!.geometry!.faces).toHaveLength(6);

    store.execute(updateFeature<ExtrudeFeature>(extrudeId, { distance: "unknownParam * 2" }));
    result = await engine.recompute(store.document);
    expect(result.features[extrudeId]).toMatchObject({ state: "error" });
    expect(result.features[extrudeId]!.message).toMatch(/unknownParam/);
    expect(result.bodies).toHaveLength(0);
    store.undo();

    store.execute(removeFeatures([sketchId]));
    result = await engine.recompute(store.document);
    expect(result.features[extrudeId]!.message).toMatch(/sketch/i);
  });

  it("honours suppression and the history marker", async () => {
    const store = new DocumentStore(createDocument());
    const { extrudeId, bodyId } = scenarioA(store);
    const f: CreatedRef = {};
    store.execute(
      addFillet({ bodyId, edges: [{ point: { x: 3, y: 2, z: 25 } }], radius: "5" }, f),
    );
    const engine = new FeatureEngine(kernel, solver);
    store.execute(setFeatureSuppressed(f.id!, true));
    let result = await engine.recompute(store.document);
    expect(result.features[f.id!]!.state).toBe("suppressed");
    expect(result.bodies[0]!.geometry!.faces).toHaveLength(6);

    store.execute(setFeatureSuppressed(f.id!, false));
    store.execute(setTimelineCursor(1));
    result = await engine.recompute(store.document);
    expect(result.features[extrudeId]!.state).toBe("rolled-back");
    expect(result.bodies).toHaveLength(0);

    store.execute(setTimelineCursor(null));
    result = await engine.recompute(store.document);
    expect(result.bodies[0]!.geometry!.faces).toHaveLength(7);
  });

  it("Scenario B (CAD part): a star sketch extrudes into a prism with 12 faces", async () => {
    const store = new DocumentStore(createDocument());
    const s: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    store.execute(
      updateSketch(s.id!, "Star", (sk) =>
        editSketch(sk, (b) => {
          const pts = Array.from({ length: 10 }, (_, i) => {
            const r = i % 2 === 0 ? 50 : 20;
            const a = Math.PI / 2 + (i * Math.PI) / 5;
            return { x: r * Math.cos(a), y: r * Math.sin(a) };
          });
          createPolyline(b, pts, true);
        }),
      ),
    );
    const regions = detectProfiles(sketchOf(store.document, s.id!));
    expect(regions).toHaveLength(1);
    const e: CreatedRef = {};
    store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(regions[0]!)], distance: "30" }, e));
    const engine = new FeatureEngine(kernel, solver);
    const result = await engine.recompute(store.document);
    expect(result.features[e.id!]!.state).toBe("ok");
    const topology = engine.bodyTopology(e.bodyId!)!;
    expect(topology.faces).toHaveLength(12);
    expect(topology.edges).toHaveLength(30);
    expect(topology.edges.every((edge) => edge.faces.length === 2)).toBe(true);
  });

  it("rebuilds the same model after save and load", async () => {
    const store = new DocumentStore(createDocument("Saved"));
    const { bodyId } = scenarioA(store);
    store.execute(
      addFillet({ bodyId, edges: [{ point: { x: 3, y: 2, z: 25 } }], radius: "5" }),
    );
    const engine = new FeatureEngine(kernel, solver);
    const before = (await engine.recompute(store.document)).bodies[0]!.geometry!;

    const loaded = deserializeDocument(serializeDocument(store.document));
    const fresh = new FeatureEngine(kernel, solver);
    const after = (await fresh.recompute(loaded)).bodies[0]!.geometry!;
    expect(after.volume).toBeCloseTo(before.volume, 6);
    expect(after.faces).toHaveLength(before.faces.length);
  });

  it("exports STEP and STL", async () => {
    const store = new DocumentStore(createDocument());
    const { bodyId } = scenarioA(store);
    const engine = new FeatureEngine(kernel, solver);
    await engine.recompute(store.document);
    const step = await engine.exportSTEP([{ id: bodyId, name: "Body001" }]);
    expect(new TextDecoder().decode(step.slice(0, 16))).toContain("ISO-10303-21");
    const stl = await engine.exportSTL([bodyId]);
    expect(stl.length).toBe(84 + 12 * 50);
    await expect(engine.exportSTL(["missing"])).rejects.toThrow(/no body/);
  });
});
