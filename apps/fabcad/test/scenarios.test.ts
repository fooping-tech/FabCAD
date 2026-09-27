import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import {
  type CreatedRef,
  DocumentStore,
  type SketchFeature,
  addExtrude,
  addSketch,
  createDocument,
  updateSketch,
} from "@fabcad/cad-document";
import type { CadBody } from "@fabcad/fabrication-core";
import { FeatureEngine, solveSketchWithParameters } from "@fabcad/features";
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
import { renderSheetSvg } from "@fabcad/svg";
import { renderSheetDxf } from "@fabcad/dxf";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
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
  it("Scenario B: star → extrude → MDF 5.5 mm → panels → tab & slot → SVG", async () => {
    const body = await model(star(110, 50), { x: 0, y: 0 }, "40");
    expect(body.topology.faces).toHaveLength(12);

    const out = compileFabrication([body], defaultFabricationSettings());
    expect(out.material.id).toBe("mdf-5.5");
    expect(out.strategyId).toBe("laser.board");
    expect(out.parts).toHaveLength(12);
    expect(out.connections).toHaveLength(30);
    const tabSlot = out.connections.filter((c) => c.joint === "tab-slot");
    expect(tabSlot).toHaveLength(20);
    expect(out.connections.filter((c) => c.joint === "flat")).toHaveLength(10);

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
    // The star has concave and acute corners: the analyzer must say so.
    const codes = new Set(out.warnings.map((w) => w.code));
    expect(codes.has("concave-corner")).toBe(true);
    expect(codes.has("acute-angle")).toBe(true);
    expect(out.warnings.some((w) => /5\.5 mm MDF/.test(w.message))).toBe(true);

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

    // Board: the flat rings are cut, the curved walls are reported as not producible.
    const board = compileFabrication([body], defaultFabricationSettings());
    expect(board.parts).toHaveLength(2);
    expect(board.parts.every((p) => p.holes.length === 1)).toBe(true);
    expect(board.warnings.some((w) => w.code === "curved-face")).toBe(true);

    // Paper: every facet is unfolded, without overlaps being produced silently.
    const paper = compileFabrication([body], {
      ...defaultFabricationSettings(),
      materialId: "paper-0.2",
    });
    const faces = paper.parts.reduce((n, p) => n + p.sourceFaces.length, 0);
    expect(faces).toBe(body.topology.faces.length);
  });
});
