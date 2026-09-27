import { beforeAll, describe, expect, it } from "vitest";
import type { GeometryKernel } from "@fabcad/brep";
import { type Loop2, ORIGIN_PLANES, type Profile2, type Vec2 } from "@fabcad/geometry";
import {
  compilePrintJob,
  meshBounds,
  openEdges,
  weldMesh,
  write3mf,
  writeBinaryStl,
} from "@fabcad/fabrication-print";
import { createDocument, setExtension } from "@fabcad/cad-document";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import {
  PRINT_EXTENSION_KEY,
  defaultPrintWorkspaceSettings,
  normalizePrintSettings,
  readPrintSettings,
  toPrintSettings,
} from "../src/print/settingsModel";

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await nodeKernel();
});

const loop = (pts: Vec2[]): Loop2 => ({
  curves: pts.map((p, i) => ({ type: "line" as const, a: p, b: pts[(i + 1) % pts.length]! })),
});
const rect = (x0: number, y0: number, x1: number, y1: number): Profile2 => ({
  outer: loop([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]),
  holes: [],
});

describe("3D printing with kernel geometry", () => {
  it("turns a table upside down, places it and exports closed meshes", async () => {
    // Table: a leg with a wide top, modelled standing on its leg.
    const leg = kernel.extrude([rect(15, 15, 25, 25)], ORIGIN_PLANES.XY, 0, 30);
    const top = kernel.extrude([rect(0, 0, 40, 40)], ORIGIN_PLANES.XY, 30, 35);
    const table = kernel.boolean("union", leg, [top]);
    // A plate with a round hole.
    const plate = kernel.extrude(
      [
        {
          ...rect(0, 0, 80, 60),
          holes: [
            {
              curves: [
                { type: "arc", center: { x: 30, y: 30 }, radius: 10, startAngle: 0, sweep: -2 * Math.PI },
              ],
            },
          ],
        },
      ],
      ORIGIN_PLANES.XY,
      0,
      6,
    );
    const bodies = [
      ["table", table],
      ["plate", plate],
    ].map(([name, shape]) => {
      const g = kernel.tessellate(shape as never);
      return { id: name as string, name: name as string, mesh: { positions: g.positions, indices: g.indices }, volume: g.volume };
    });
    // What the kernel tessellates is a closed surface once welded.
    for (const b of bodies) expect(openEdges(weldMesh(b.mesh))).toBe(0);

    const settings = toPrintSettings(defaultPrintWorkspaceSettings());
    const job = compilePrintJob(bodies, settings);
    expect(job.parts).toHaveLength(2);
    expect(job.parts.every((p) => p.placed)).toBe(true);

    const t = job.parts.find((p) => p.bodyId === "table")!;
    expect(t.down.z).toBeCloseTo(1, 6);
    expect(t.overhangArea).toBeCloseTo(0, 3);
    expect(t.contactArea).toBeCloseTo(1600, 1);
    expect(t.size.z).toBeCloseTo(35, 3);
    expect(t.estimate.volume).toBeCloseTo(10 * 10 * 30 + 40 * 40 * 5, 1);

    const p = job.parts.find((q) => q.bodyId === "plate")!;
    expect(p.size.z).toBeCloseTo(6, 3);
    // The hole is a polygon inside the true circle: the mesh is larger by a hair.
    expect(Math.abs(p.estimate.volume / bodies[1]!.volume - 1)).toBeLessThan(1e-3);
    expect(job.warnings).toEqual([]);
    expect(job.total.mass).toBeGreaterThan(0);
    expect(job.total.layers).toBe(175);

    // As designed, the table needs support.
    const standing = compilePrintJob(bodies, { ...settings, orientations: { table: "-z" } });
    expect(standing.parts.find((q) => q.bodyId === "table")!.overhangArea).toBeCloseTo(1500, 0);
    expect(standing.warnings.some((w) => w.partId === "table")).toBe(true);

    const triangles = job.parts.reduce((n, q) => n + q.mesh.indices.length / 3, 0);
    expect(writeBinaryStl(job.parts.map((q) => q.mesh)).length).toBe(84 + triangles * 50);
    const threeMf = new TextDecoder().decode(write3mf(job.parts.map((q) => ({ name: q.name, mesh: q.mesh }))));
    expect(threeMf).toContain('unit="millimeter"');
    expect((threeMf.match(/<object /g) ?? []).length).toBe(2);
    for (const q of job.parts) {
      const b = meshBounds(q.mesh);
      expect(b.min.z).toBeCloseTo(0, 4);
      expect(b.max.x).toBeLessThanOrEqual(settings.printer.bed.width);
    }
  });
});

describe("print settings", () => {
  it("fills defaults and rejects values out of range", () => {
    expect(normalizePrintSettings(undefined)).toEqual(defaultPrintWorkspaceSettings());
    const s = normalizePrintSettings({
      materialId: "unobtainium",
      infill: 250,
      walls: 3.4,
      printer: { bed: { width: 300, depth: "x", height: -5 }, nozzle: 0.6 },
      bodyIds: ["a", 5],
      orientations: { a: "+x", b: "sideways", c: { down: { x: 0, y: 0, z: 0 } }, d: { down: { x: 1, y: 1, z: 0 } } },
    });
    expect(s.materialId).toBe("pla");
    expect(s.infill).toBe(15);
    expect(s.walls).toBe(3);
    expect(s.printer.bed).toEqual({ width: 300, depth: 220, height: 250 });
    expect(s.printer.nozzle).toBe(0.6);
    expect(s.bodyIds).toEqual(["a"]);
    expect(Object.keys(s.orientations)).toEqual(["a", "d"]);
    expect(toPrintSettings(s).infill).toBeCloseTo(0.15);
  });

  it("round-trips through the document", () => {
    const doc = setExtension(PRINT_EXTENSION_KEY, {
      ...defaultPrintWorkspaceSettings(),
      materialId: "petg",
      infill: 40,
    }).apply(createDocument());
    expect(readPrintSettings(doc)).toMatchObject({ materialId: "petg", infill: 40 });
    expect(readPrintSettings(JSON.parse(JSON.stringify(doc)))).toEqual(readPrintSettings(doc));
  });
});
