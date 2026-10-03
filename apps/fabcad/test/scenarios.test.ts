import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import {
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addExtrude,
  addFillet,
  addSketch,
  createDocument,
  updateSketch,
} from "@fabcad/cad-document";
import type { CadBody } from "@fabcad/fabrication-core";
import { FeatureEngine, makeEdgeRef, solveSketchWithParameters } from "@fabcad/features";
import {
  type Sketch,
  createCircle,
  createPolyline,
  createRectangle2Point,
  createSpline,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { renderSheetSvg } from "@fabcad/svg";
import { renderSheetDxf } from "@fabcad/dxf";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import { doublyCurvedFaces, goreTessellation } from "@fabcad/fabrication-laser";
import { compileFabrication } from "../src/fabrication/pipeline";
import { defaultFabricationSettings } from "../src/fabrication/settingsModel";

/**
 * The milestone scenarios end to end, with the real OpenCASCADE kernel:
 * sketch → solver → profile → extrude → B-Rep → topology → fabrication compiler → SVG.
 */

let kernel: GeometryKernel;
const solver = createDefaultSolver();

beforeAll(async () => {
  kernel = await nodeKernel();
});

async function model(
  draw: (sketch: Sketch) => Sketch,
  pick: { x: number; y: number },
  distance: string,
): Promise<CadBody> {
  const store = new DocumentStore(createDocument());
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  store.execute(
    updateSketch(s.id!, "Draw", (sketch) => {
      const info = solveSketchWithParameters(draw(sketch), solver, () => undefined);
      expect(info.converged).toBe(true);
      return info.sketch;
    }),
  );
  const sketch = (store.document.features[s.id!] as SketchFeature).sketch;
  const region = regionAtPoint(detectProfiles(sketch), pick)!;
  expect(region).toBeDefined();
  const e: CreatedRef = {};
  store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance }, e));
  const engine = new FeatureEngine(kernel, solver);
  const result = await engine.recompute(store.document);
  expect(result.features[e.id!]!.state).toBe("ok");
  return { id: e.bodyId!, name: "Body001", topology: engine.bodyTopology(e.bodyId!)! };
}

const star = (outer: number, inner: number) => (sketch: Sketch): Sketch =>
  editSketch(sketch, (b) => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 === 0 ? outer : inner;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
    const made = createPolyline(b, pts, true);
    b.dimension("distance", [made.entities[0]!], "75");
  });

describe("milestone scenarios", () => {
  it("Scenario A: star → extrude 5.5 → MDF 5.5 mm → one flat part → SVG", async () => {
    const body = await model(star(110, 50), { x: 0, y: 0 }, "5.5");
    expect(body.topology.faces).toHaveLength(12);

    const out = compileFabrication([body], defaultFabricationSettings());
    expect(out.strategyId).toBe("laser.board");
    expect(out.detections).toEqual([
      expect.objectContaining({ kind: "flat-part", supported: true, parts: 1 }),
    ]);
    expect(out.parts).toHaveLength(1);
    const part = out.parts[0]!;
    // The part is the star that was drawn: ten corners, no joints added to it.
    expect(part.outline).toHaveLength(10);
    expect(part.holes).toHaveLength(0);
    expect(part.joints).toHaveLength(0);
    expect(out.connections).toHaveLength(0);
    expect(out.warnings.filter((w) => w.severity === "error")).toHaveLength(0);
    expect(out.layout.placements).toHaveLength(1);

    const svg = renderSheetSvg(out.geometry, { sheet: 0 });
    expect(svg).toContain('<g id="cut"');
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    expect(renderSheetDxf(out.geometry, { sheet: 0 })).toContain("ENTITIES");
  });

  it("a star prism is not made of board: no parts, and the reason is given", async () => {
    const body = await model(star(110, 50), { x: 0, y: 0 }, "40");
    const out = compileFabrication([body], defaultFabricationSettings());
    expect(out.parts).toHaveLength(0);
    expect(out.connections).toHaveLength(0);
    expect(out.detections).toEqual([
      expect.objectContaining({ kind: "unsupported", supported: false, parts: 0 }),
    ]);
    expect(out.detections[0]!.reason ?? "").not.toBe("");
    const error = out.warnings.find((w) => w.code === "unsupported-board-shape");
    expect(error?.severity).toBe("error");
    expect(error?.message).toMatch(/5\.5 mm MDF/);
    expect(out.geometry.paths).toHaveLength(0);
  });

  it("Scenario B: rectangle → extrude → MDF 5.5 mm → panels → tab & slot → SVG", async () => {
    const body = await model(
      (sketch) =>
        editSketch(sketch, (b) => {
          const r = createRectangle2Point(b, { x: 0, y: 0 }, { x: 98, y: 81 });
          b.dimension("distance", [r.entities[0]!], "100");
          b.dimension("distance", [r.entities[1]!], "80");
        }),
      { x: 10, y: 10 },
      "50",
    );
    expect(body.topology.faces).toHaveLength(6);

    const out = compileFabrication([body], defaultFabricationSettings());
    expect(out.material.id).toBe("mdf-5.5");
    expect(out.strategyId).toBe("laser.board");
    expect(out.detections).toEqual([
      expect.objectContaining({ kind: "rectangular-box", supported: true, parts: 6 }),
    ]);
    expect(out.parts).toHaveLength(6);
    expect(out.connections).toHaveLength(12);
    const tabSlot = out.connections.filter((c) => c.joint === "tab-slot");
    expect(tabSlot).toHaveLength(8);
    expect(out.connections.filter((c) => c.joint === "flat")).toHaveLength(4);

    // Every tab has its slot, connection by connection.
    for (const c of tabSlot) {
      const count = (kind: "tab" | "slot"): number =>
        out.parts
          .flatMap((p) => p.joints)
          .filter((j) => j.kind === kind && j.connectionId === c.id)
          .reduce((n, j) => n + ("polygons" in j ? j.polygons.length : 0), 0);
      expect(count("tab")).toBeGreaterThan(0);
      expect(count("slot")).toBe(count("tab"));
    }
    expect(out.warnings.filter((w) => w.severity === "error")).toHaveLength(0);

    const svg = renderSheetSvg(out.geometry, { sheet: 0 });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+mm" height="[\d.]+mm" viewBox="0 0 [\d.]+ [\d.]+"/);
    expect(svg).toContain('<g id="cut"');
    expect((svg.match(/<path/g) ?? []).length).toBe(
      out.geometry.paths.filter((p) => p.sheet === 0).length,
    );
    expect(renderSheetDxf(out.geometry, { sheet: 0 })).toContain("ENTITIES");
  });

  it("Scenario C: rectangle → extrude → paper → unfold → glue tabs → SVG", async () => {
    const body = await model(
      (sketch) =>
        editSketch(sketch, (b) => {
          const r = createRectangle2Point(b, { x: 0, y: 0 }, { x: 58, y: 41 });
          b.dimension("distance", [r.entities[0]!], "60");
          b.dimension("distance", [r.entities[1]!], "40");
        }),
      { x: 10, y: 10 },
      "30",
    );
    const settings = { ...defaultFabricationSettings(), materialId: "paper-0.2" };
    const out = compileFabrication([body], settings);
    expect(out.strategyId).toBe("laser.paper");
    expect(out.parts).toHaveLength(1);
    const net = out.parts[0]!;
    expect(net.sourceFaces).toHaveLength(6);
    expect(net.folds).toHaveLength(5);
    expect(net.joints.filter((j) => j.kind === "glue-tab")).toHaveLength(7);
    expect(out.connections.filter((c) => c.joint === "fold")).toHaveLength(5);
    expect(out.connections.filter((c) => c.joint === "glue-tab")).toHaveLength(7);
    // Unfolded area = surface of the box (tabs excluded): 2·(60·40 + 60·30 + 40·30).
    const svg = renderSheetSvg(out.geometry, { sheet: 0 });
    const fold = /<g id="fold"[\s\S]*?\n {2}<\/g>/.exec(svg)![0];
    expect((fold.match(/<path/g) ?? []).length).toBe(12);
    expect(svg).toContain('<g id="cut"');
  });

  it("curved bodies: a cylinder with a hole is handled generically", async () => {
    const body = await model(
      (sketch) =>
        editSketch(sketch, (b) => {
          createCircle(b, { x: 0, y: 0 }, 30);
          createCircle(b, { x: 0, y: 0 }, 10);
        }),
      { x: 20, y: 0 },
      "25",
    );
    const curved = body.topology.faces.filter((f) => f.surface === "curved");
    expect(curved.length).toBeGreaterThan(16);

    // Board: a tube 25 mm tall is neither a sheet nor a box. Nothing is cut.
    const board = compileFabrication([body], defaultFabricationSettings());
    expect(board.parts).toHaveLength(0);
    expect(board.detections[0]).toMatchObject({ kind: "unsupported", supported: false });
    expect(board.warnings.some((w) => w.code === "unsupported-board-shape")).toBe(true);

    // Paper: every facet is unfolded, without overlaps being produced silently.
    const paper = compileFabrication([body], {
      ...defaultFabricationSettings(),
      materialId: "paper-0.2",
    });
    const faces = paper.parts.reduce((n, p) => n + p.sourceFaces.length, 0);
    expect(faces).toBe(body.topology.faces.length);
  });

  it("a washer of the thickness of the material is one flat part with its hole", async () => {
    const body = await model(
      (sketch) =>
        editSketch(sketch, (b) => {
          createCircle(b, { x: 0, y: 0 }, 30);
          createCircle(b, { x: 0, y: 0 }, 10);
        }),
      { x: 20, y: 0 },
      "5.5",
    );
    const out = compileFabrication([body], defaultFabricationSettings());
    expect(out.detections[0]).toMatchObject({ kind: "flat-part", supported: true, parts: 1 });
    expect(out.parts).toHaveLength(1);
    const part = out.parts[0]!;
    expect(part.holes).toHaveLength(1);
    expect(part.joints).toHaveLength(0);
    // Outline and hole are the circles that were drawn, as the kernel facets them.
    const radius = (loop: { x: number; y: number }[]): number[] => {
      const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
      const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;
      return loop.map((p) => Math.hypot(p.x - cx, p.y - cy));
    };
    for (const r of radius(part.outline)) expect(r).toBeCloseTo(30, 1);
    for (const r of radius(part.holes[0]!)) expect(r).toBeCloseTo(10, 1);
    expect(part.paths.filter((p) => p.role === "outline")).toHaveLength(1);
    expect(part.paths.filter((p) => p.role === "hole")).toHaveLength(1);
  });

  it("the walls of an extruded spline are rolled out whole, not cut into facets", async () => {
    // A wavy closed outline: its walls are surfaces of extrusion, whose facets have vertices
    // inside the face that do not lie quite flat.
    const blob = (sketch: Sketch): Sketch =>
      editSketch(sketch, (b) => {
        const pts = Array.from({ length: 9 }, (_, i) => {
          const a = (i * 2 * Math.PI) / 9;
          const r = 40 + (i % 2 === 0 ? 12 : -8);
          return { x: r * Math.cos(a), y: r * Math.sin(a) };
        });
        createSpline(b, "fit", pts, true);
      });
    const body = await model(blob, { x: 0, y: 0 }, "20");
    expect(body.topology.faces.some((f) => f.surface === "curved" && f.developable)).toBe(true);
    expect(doublyCurvedFaces(body.topology)).toEqual([]);

    for (const doublyCurved of ["reject", "gores"] as const) {
      const out = compileFabrication([body], {
        ...defaultFabricationSettings(),
        materialId: "paper-0.2",
        paper: { doublyCurved, joint: "glue" },
      });
      expect(out.detections[0]).toMatchObject({ kind: "net", supported: true });
      // Top, bottom and the wall: no slivers of facets left over as nets of their own.
      expect(out.parts.length).toBeLessThanOrEqual(3);
      expect(out.parts.flatMap((p) => p.sourceFaces)).toHaveLength(body.topology.faces.length);
      for (const part of out.parts) {
        expect(Math.min(part.bounds.maxX - part.bounds.minX, part.bounds.maxY - part.bounds.minY)).toBeGreaterThan(15);
      }
      expect(out.layout.unplaced).toEqual([]);
    }
  });

  it("a cylinder with a rounded edge is not unfolded: the rounding is curved in two directions", async () => {
    const store = new DocumentStore(createDocument());
    const sk: CreatedRef = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, sk));
    store.execute(
      updateSketch(sk.id!, "Draw", (sketch) =>
        editSketch(sketch, (b) => {
          createCircle(b, { x: 0, y: 0 }, 30);
        }),
      ),
    );
    const sketch = (store.document.features[sk.id!] as SketchFeature).sketch;
    const region = regionAtPoint(detectProfiles(sketch), { x: 0, y: 0 })!;
    const e: CreatedRef = {};
    store.execute(addExtrude({ sketchId: sk.id!, profiles: [profileRefOf(region)], distance: "40" }, e));
    const engine = new FeatureEngine(kernel, solver);
    await engine.recompute(store.document);

    // The plain cylinder is rolled from a sheet.
    const plain: CadBody = { id: e.bodyId!, name: "Body001", topology: engine.bodyTopology(e.bodyId!)! };
    const paperSettings = { ...defaultFabricationSettings(), materialId: "paper-0.2" };
    const rolled = compileFabrication([plain], paperSettings);
    expect(rolled.detections[0]).toMatchObject({ kind: "net", supported: true });
    expect(rolled.parts.length).toBeGreaterThan(0);

    // Round the upper edge.
    const geometry = engine.bodyGeometry(e.bodyId!)!;
    const names = engine.bodyNames(e.bodyId!)!;
    const top = geometry.edges.findIndex((x) => x.curve === "circle" && x.midpoint.z > 39);
    expect(top).toBeGreaterThanOrEqual(0);
    const f: CreatedRef = {};
    store.execute(
      addFillet({ bodyId: e.bodyId!, edges: [makeEdgeRef({ geometry, names }, top)!], radius: "10" }, f),
    );
    const result = await engine.recompute(store.document);
    expect(result.features[f.id!]!.state).toBe("ok");
    const rounded: CadBody = { id: e.bodyId!, name: "Body001", topology: engine.bodyTopology(e.bodyId!)! };

    for (const joint of ["glue", "insert"] as const) {
      const out = compileFabrication([rounded], { ...paperSettings, paper: { joint } });
      expect(out.parts).toHaveLength(0);
      expect(out.geometry.paths).toHaveLength(0);
      expect(out.detections[0]).toMatchObject({ kind: "unsupported", supported: false, parts: 0 });
      // The kernel makes the rounding from two halves.
      expect(out.detections[0]!.reason).toMatch(/2 faces curved in two directions/);
      expect(out.warnings.filter((w) => w.code === "unsupported-paper-shape")).toHaveLength(1);
    }
    // Gores: the body is facetted as coarsely as there are gores, and the rounding is cut
    // into strips. Asking for other facets gives another topology of the same body.
    const bounds = engine.bodyGeometry(e.bodyId!)!.bounds;
    const size = Math.hypot(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    );
    for (const gores of [12, 16]) {
      const coarse: CadBody = {
        id: e.bodyId!,
        name: "Body001",
        topology: engine.bodyTopology(e.bodyId!, goreTessellation(gores, size))!,
      };
      // The flat top is a polygon with as many corners as there are gores.
      const top = coarse.topology.faces.filter((x) => x.surface === "plane");
      expect(top.map((x) => x.loops[0]!.length)).toEqual([gores, gores]);
      for (const joint of ["glue", "insert"] as const) {
        const out = compileFabrication([coarse], {
          ...paperSettings,
          sheet: { width: 600, height: 400, margin: 5, gap: 3 },
          paper: { doublyCurved: "gores", gores, joint },
        });
        expect(out.detections[0]).toMatchObject({ kind: "gores", supported: true });
        expect(out.detections[0]!.label).toBe(`Gores (${gores}, approximation)`);
        expect(out.warnings.filter((w) => w.severity === "error")).toEqual([]);
        // Wall with the bottom and every second gore; the top with the other gores.
        expect(out.parts).toHaveLength(2);
        expect(out.parts.flatMap((p) => p.sourceFaces)).toHaveLength(coarse.topology.faces.length);
        expect(out.layout.unplaced).toEqual([]);
        const svg = renderSheetSvg(out.geometry, { sheet: 0 });
        expect(svg).toContain('<g id="cut"');
      }
      // Without gores the same topology is refused.
      const refused = compileFabrication([coarse], paperSettings);
      expect(refused.parts).toHaveLength(0);
    }
    expect(engine.bodyTopology(e.bodyId!)!.faces.length).toBe(rounded.topology.faces.length);

    // Board refuses it as well, for its own reason.
    const board = compileFabrication([rounded], defaultFabricationSettings());
    expect(board.detections[0]).toMatchObject({ kind: "unsupported", supported: false });
  });
});
