import { beforeAll, describe, expect, it } from "vitest";
import { type BodyGeometry, type GeometryKernel, edgePolyline } from "@fabcad/brep";
import {
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addChamfer,
  addExtrude,
  addFillet,
  addParameter,
  addShell,
  addSketch,
  command,
  createDocument,
  deserializeDocument,
  serializeDocument,
  updateParameter,
  updateSketch,
} from "@fabcad/cad-document";
import { ORIGIN_PLANES, type Vec3 } from "@fabcad/geometry";
import {
  type Sketch,
  addProjection,
  createCircle,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
  projectPolyline,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../brep/test/nodeKernel";
import {
  type BodyNames,
  FeatureEngine,
  makeEdgeRef,
  makeFaceRef,
  resolveDocumentSketches,
  resolveEdgeRef,
  resolveFaceRef,
  solveSketchWithParameters,
} from "../src";

let kernel: GeometryKernel;
const solver = createDefaultSolver();

beforeAll(async () => {
  kernel = await nodeKernel();
});

const run = (store: DocumentStore, cmd: ReturnType<typeof command>): void => {
  store.execute(
    command(cmd.label, (doc) => {
      const next = cmd.apply(doc);
      return next.parameters !== doc.parameters ? resolveDocumentSketches(next, solver) : next;
    }),
  );
};

interface Box {
  store: DocumentStore;
  engine: FeatureEngine;
  sketchId: string;
  extrudeId: string;
  bodyId: string;
  /** Sketch lines: bottom (y = 0), right (x = width), top, left. */
  lines: string[];
  setWidth(value: number): Promise<void>;
  body(): { geometry: BodyGeometry; names: BodyNames };
}

/** width × 80 × 50 box with its corner fixed at the origin; `width` is a parameter. */
async function box(): Promise<Box> {
  const store = new DocumentStore(createDocument());
  run(store, addParameter({ name: "width", expression: "100", unit: "mm" }));
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  let lines: string[] = [];
  store.execute(
    updateSketch(s.id!, "Rectangle", (sk) => {
      const edited = editSketch(sk, (b) => {
        const r = createRectangle2Point(b, { x: 0, y: 0 }, { x: 100, y: 80 });
        lines = r.entities;
        b.dimension("distance", [r.entities[0]!], "width");
        b.dimension("distance", [r.entities[1]!], "80");
        b.constrain("fix", r.points[0]!);
      });
      return solveSketchWithParameters(edited, solver, () => ({ value: 100, kind: "length" })).sketch;
    }),
  );
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const e: CreatedRef = {};
  store.execute(
    addExtrude({ sketchId: s.id!, profiles: [profileRefOf(detectProfiles(sketch)[0]!)], distance: "50" }, e),
  );
  const engine = new FeatureEngine(kernel, solver);
  await engine.recompute(store.document);
  return {
    store,
    engine,
    sketchId: s.id!,
    extrudeId: e.id!,
    bodyId: e.bodyId!,
    lines,
    async setWidth(value) {
      const p = store.document.parameters[0]!;
      run(store, updateParameter(p.id, { expression: String(value) }));
      const result = await engine.recompute(store.document);
      for (const f of Object.values(result.features)) expect(f.state, f.message).toBe("ok");
    },
    body: () => ({
      geometry: engine.bodyGeometry(e.bodyId!)!,
      names: engine.bodyNames(e.bodyId!)!,
    }),
  };
}

const near = (a: Vec3, b: Vec3, tol = 1e-6): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol;

const edgeAt = (g: BodyGeometry, midpoint: Vec3): number =>
  g.edges.findIndex((e) => near(e.midpoint, midpoint, 1e-4));

const faceAt = (g: BodyGeometry, center: Vec3): number =>
  g.faces.findIndex((f) => near(f.center, center, 1e-4));

/** True when the body has a sharp vertical edge through (x, y). */
const hasVerticalEdge = (g: BodyGeometry, x: number, y: number): boolean =>
  g.edges.some(
    (e) =>
      e.curve === "line" &&
      Math.abs(e.from.x - x) < 1e-4 &&
      Math.abs(e.from.y - y) < 1e-4 &&
      Math.abs(e.to.x - x) < 1e-4 &&
      Math.abs(e.to.y - y) < 1e-4,
  );

describe("names", () => {
  it("names the faces of an extrude after their role and their sketch line", async () => {
    const b = await box();
    const { geometry, names } = b.body();
    const keys = names.faces.map((n) => n.key).sort();
    expect(keys).toEqual(
      [
        `${b.extrudeId}:end`,
        `${b.extrudeId}:start`,
        ...b.lines.map((l) => `${b.extrudeId}:side(${b.sketchId}/${l})`),
      ].sort(),
    );
    // Start is the face in the sketch plane, end the one 50 mm above it.
    expect(names.faces[faceAt(geometry, { x: 50, y: 40, z: 0 })]!.role).toBe("start");
    expect(names.faces[faceAt(geometry, { x: 50, y: 40, z: 50 })]!.role).toBe("end");
    // The face at x = 100 comes from the right-hand line of the rectangle.
    expect(names.faces[faceAt(geometry, { x: 100, y: 40, z: 25 })]!.entity).toBe(b.lines[1]);
    // Edges are named by the faces that meet there; every name is unique.
    expect(new Set(names.edges.map((n) => n.key)).size).toBe(12);
    const corner = names.edges[edgeAt(geometry, { x: 100, y: 0, z: 25 })]!;
    expect(corner.faces).toEqual(
      [`${b.extrudeId}:side(${b.sketchId}/${b.lines[0]})`, `${b.extrudeId}:side(${b.sketchId}/${b.lines[1]})`].sort(),
    );
  });

  it("keeps the names when the size changes", async () => {
    const b = await box();
    const before = b.body().names.faces.map((n) => n.key).sort();
    await b.setWidth(37);
    expect(b.body().names.faces.map((n) => n.key).sort()).toEqual(before);
    const { geometry, names } = b.body();
    expect(names.faces[faceAt(geometry, { x: 37, y: 40, z: 25 })]!.entity).toBe(b.lines[1]);
  });

  it("hands names on through cuts, and names what the cut adds", async () => {
    const b = await box();
    const s: CreatedRef = {};
    b.store.execute(addSketch({ type: "origin", plane: "XY" }, s));
    let circle = "";
    b.store.execute(
      updateSketch(s.id!, "Circle", (sk) =>
        editSketch(sk, (builder) => {
          circle = createCircle(builder, { x: 30, y: 40 }, 10).entities[0]!;
        }),
      ),
    );
    const region = regionAtPoint(
      detectProfiles((b.store.document.features[s.id!] as SketchFeature).sketch),
      { x: 30, y: 40 },
    )!;
    const cut: CreatedRef = {};
    b.store.execute(
      addExtrude(
        { sketchId: s.id!, profiles: [profileRefOf(region)], distance: "50", operation: "cut", targetBodyIds: [b.bodyId] },
        cut,
      ),
    );
    await b.engine.recompute(b.store.document);
    const { names } = b.body();
    const keys = names.faces.map((n) => n.key);
    // The six faces of the box are still there under their own names …
    expect(keys).toContain(`${b.extrudeId}:end`);
    expect(keys).toContain(`${b.extrudeId}:side(${b.sketchId}/${b.lines[1]})`);
    // … and the wall of the hole belongs to the cut and to the circle it was drawn with.
    const wall = names.faces.filter((n) => n.feature === cut.id);
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.every((n) => n.role === "side" && n.entity === circle)).toBe(true);
  });
});

describe("references survive a change of size", () => {
  it("Fillet stays on the same logical edge", async () => {
    const b = await box();
    const body = b.body();
    const ref = makeEdgeRef(body, edgeAt(body.geometry, { x: 100, y: 0, z: 25 }))!;
    expect(ref.name).toBeDefined();
    const f: CreatedRef = {};
    b.store.execute(addFillet({ bodyId: b.bodyId, edges: [ref], radius: "8" }, f));
    await b.engine.recompute(b.store.document);
    expect(hasVerticalEdge(b.body().geometry, 100, 0)).toBe(false);

    // The corner moves 50 mm away. A reference by position would now hit another edge.
    await b.setWidth(150);
    let g = b.body().geometry;
    expect(g.faces.filter((x) => x.surface === "cylinder")).toHaveLength(1);
    expect(hasVerticalEdge(g, 150, 0)).toBe(false);
    for (const [x, y] of [[0, 0], [0, 80], [150, 80]] as const) {
      expect(hasVerticalEdge(g, x, y)).toBe(true);
    }
    expect(g.volume).toBeCloseTo(150 * 80 * 50 - (64 - (Math.PI * 64) / 4) * 50, 1);
    // The bottom edge that a nearest-point search would have picked is still a sharp edge.
    expect(edgeAt(g, { x: 71, y: 0, z: 0 })).toBeGreaterThanOrEqual(0);

    await b.setWidth(30);
    g = b.body().geometry;
    expect(hasVerticalEdge(g, 30, 0)).toBe(false);
    expect(hasVerticalEdge(g, 0, 0)).toBe(true);
    // The fillet face knows which edge it replaced.
    const fillet = b.body().names.faces.find((n) => n.feature === f.id)!;
    expect(fillet.role).toBe("fillet");
    expect(fillet.of).toEqual([ref.name]);
  });

  it("Chamfer stays on the same logical edge", async () => {
    const b = await box();
    const body = b.body();
    // The top edge above the right-hand sketch line.
    const ref = makeEdgeRef(body, edgeAt(body.geometry, { x: 100, y: 40, z: 50 }))!;
    b.store.execute(addChamfer({ bodyId: b.bodyId, edges: [ref], distance: "5" }));
    await b.engine.recompute(b.store.document);
    await b.setWidth(160);
    const g = b.body().geometry;
    expect(g.volume).toBeCloseTo(160 * 80 * 50 - 12.5 * 80, 2);
    // The chamfer face lies at the right-hand end, wherever that is now.
    const chamfer = g.faces.find((x) => Math.abs(x.normal.x - Math.SQRT1_2) < 1e-6)!;
    expect(chamfer.center.x).toBeCloseTo(157.5, 4);
    expect(edgeAt(g, { x: 0, y: 40, z: 50 })).toBeGreaterThanOrEqual(0);
  });

  it("Shell keeps removing the same face", async () => {
    const b = await box();
    const body = b.body();
    const ref = makeFaceRef(body, faceAt(body.geometry, { x: 100, y: 40, z: 25 }))!;
    expect(ref.sourceEntityId).toBe(b.lines[1]);
    const sh: CreatedRef = {};
    b.store.execute(addShell({ bodyId: b.bodyId, faces: [ref], thickness: "2" }, sh));
    await b.engine.recompute(b.store.document);
    await b.setWidth(140);
    const { geometry, names } = b.body();
    // Open towards +X: no outer face at x = 140, the opposite wall is intact.
    expect(names.faces.some((n) => n.key === ref.name)).toBe(false);
    expect(faceAt(geometry, { x: 0, y: 40, z: 25 })).toBeGreaterThanOrEqual(0);
    expect(geometry.volume).toBeCloseTo(140 * 80 * 50 - 138 * 76 * 46, 1);
    // Inner walls are named after the outer face they follow.
    const inner = names.faces.filter((n) => n.feature === sh.id && n.role === "shell");
    expect(inner.some((n) => n.of?.[0] === `${b.extrudeId}:end`)).toBe(true);
    expect(names.faces.find((n) => n.role === "rim")?.of).toEqual([ref.name]);
  });

  it("projected geometry follows its edge, even when the body gains edges", async () => {
    const b = await box();
    const body = b.body();
    const index = edgeAt(body.geometry, { x: 100, y: 40, z: 50 });
    const edge = body.geometry.edges[index]!;
    const p: CreatedRef = {};
    b.store.execute(addSketch({ type: "origin", plane: "XY" }, p));
    b.store.execute(
      updateSketch(p.id!, "Project", (sk: Sketch) => {
        const shape = projectPolyline(ORIGIN_PLANES.XY, edgePolyline(body.geometry, edge))!;
        return addProjection(sk, shape, {
          bodyId: b.bodyId,
          source: "edge",
          hint: edge.midpoint,
          index,
          count: body.geometry.edges.length,
          ref: makeEdgeRef(body, index)!,
        })!.sketch;
      }),
    );
    // A fillet before the sketch changes the number and the order of the edges.
    const far = makeEdgeRef(body, edgeAt(body.geometry, { x: 0, y: 0, z: 25 }))!;
    b.store.execute(addFillet({ bodyId: b.bodyId, edges: [far], radius: "5" }));
    b.store.execute(
      command("Reorder", (doc) => {
        const timeline = doc.timeline.filter((id) => id !== p.id);
        return { ...doc, timeline: [...timeline, p.id!] };
      }),
    );
    const p0 = b.store.document.parameters[0]!;
    run(b.store, updateParameter(p0.id, { expression: "130" }));
    const result = await b.engine.recompute(b.store.document);
    const sketch = result.sketchUpdates[p.id!]!;
    const xs = Object.values(sketch.entities).flatMap((e) => (e.type === "point" && e.id !== sketch.originId ? [[e.x, e.y]] : []));
    expect(xs.sort((m, n) => m[1]! - n[1]!)).toEqual([
      [130, 0],
      [130, 80],
    ]);
  });

  it("a sketch on a face moves with the face", async () => {
    const b = await box();
    const body = b.body();
    const top = faceAt(body.geometry, { x: 50, y: 40, z: 50 });
    const s: CreatedRef = {};
    b.store.execute(
      addSketch(
        {
          type: "face",
          bodyId: b.bodyId,
          hint: body.geometry.faces[top]!.center,
          plane: { origin: { x: 0, y: 0, z: 50 }, xDir: { x: 1, y: 0, z: 0 }, yDir: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
          ref: makeFaceRef(body, top)!,
        },
        s,
      ),
    );
    b.store.execute(
      command("Taller", (doc) => ({
        ...doc,
        features: {
          ...doc.features,
          [b.extrudeId]: { ...doc.features[b.extrudeId]!, distance: "70" } as never,
        },
      })),
    );
    const result = await b.engine.recompute(b.store.document);
    const plane = result.sketchUpdates[s.id!]!.plane;
    expect(plane.type === "face" && plane.plane.origin.z).toBeCloseTo(70, 9);
  });
});

describe("resolution order", () => {
  it("prefers the name, then provenance, then the signature, then the position", async () => {
    const b = await box();
    const body = b.body();
    const index = edgeAt(body.geometry, { x: 100, y: 0, z: 25 });
    const ref = makeEdgeRef(body, index)!;
    expect(resolveEdgeRef(ref, body)).toEqual({ index, by: "name" });
    // A misleading position does not matter as long as the name is known.
    expect(resolveEdgeRef({ ...ref, point: { x: 0, y: 80, z: 25 } }, body)).toEqual({ index, by: "name" });
    // Without the name, the faces that meet at the edge identify it.
    const { name: _n, ...unnamed } = ref;
    void _n;
    expect(resolveEdgeRef({ ...unnamed, point: { x: 0, y: 80, z: 25 } }, body)).toEqual({ index, by: "provenance" });
    // Without any provenance, the signature (a vertical line 50 mm long near the point).
    const bySignature = resolveEdgeRef({ kind: "edge", point: ref.point, signature: ref.signature! }, body)!;
    expect(bySignature).toEqual({ index, by: "signature" });
    // Files from before names existed: position only.
    expect(resolveEdgeRef({ point: { x: 99, y: 1, z: 20 } }, body)).toEqual({ index, by: "proximity" });

    const face = faceAt(body.geometry, { x: 100, y: 40, z: 25 });
    const faceRef = makeFaceRef(body, face)!;
    expect(resolveFaceRef(faceRef, body)).toEqual({ index: face, by: "name" });
    expect(
      resolveFaceRef({ ...faceRef, name: "gone", point: { x: 0, y: 0, z: 0 } }, body),
    ).toEqual({ index: face, by: "provenance" });
    expect(resolveFaceRef({ point: { x: 99, y: 40, z: 25 } }, body)!.index).toBe(face);
  });

  it("references are plain data and survive save and load", async () => {
    const b = await box();
    const body = b.body();
    const ref = makeEdgeRef(body, edgeAt(body.geometry, { x: 100, y: 0, z: 25 }))!;
    b.store.execute(addFillet({ bodyId: b.bodyId, edges: [ref], radius: "8" }));
    const loaded = deserializeDocument(serializeDocument(b.store.document));
    const p = loaded.parameters[0]!;
    const changed = resolveDocumentSketches(updateParameter(p.id, { expression: "150" }).apply(loaded), solver);
    const fresh = new FeatureEngine(kernel, solver);
    const result = await fresh.recompute(changed);
    const g = result.bodies[0]!.geometry!;
    expect(hasVerticalEdge(g, 150, 0)).toBe(false);
    expect(hasVerticalEdge(g, 0, 0)).toBe(true);
    expect(result.bodies[0]!.names!.faces).toHaveLength(7);
  });
});
