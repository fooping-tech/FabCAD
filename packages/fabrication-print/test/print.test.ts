import { describe, expect, it } from "vitest";
import {
  type PrintBody,
  type PrintMesh,
  analyzeOverhangs,
  autoOrient,
  compilePrintJob,
  crc32,
  defaultPrintSettings,
  estimatePrint,
  meshArea,
  meshBounds,
  meshVolume,
  openEdges,
  orientMesh,
  weldMesh,
  write3mf,
  writeBinaryStl,
} from "../src";

/** Axis-aligned box as a kernel would tessellate it: every face has its own four vertices. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PrintMesh {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const q of quads) {
    const base = positions.length / 3;
    for (const v of q) positions.push(...c[v]!);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/**
 * Prism along Y from a polygon in the X–Z plane (counter-clockwise seen from −Y) and its
 * triangulation. One closed surface with shared vertices.
 */
function prism(outline: [number, number][], triangles: number[][], depth: number): PrintMesh {
  const n = outline.length;
  const positions: number[] = [];
  for (const [x, z] of outline) positions.push(x, 0, z);
  for (const [x, z] of outline) positions.push(x, depth, z);
  const indices: number[] = [];
  for (const [a, b, c] of triangles as [number, number, number][]) {
    indices.push(a, b, c); // front, facing −Y
    indices.push(n + a, n + c, n + b); // back, facing +Y
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, n + i, n + j, i, n + j, j);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

const body = (id: string, mesh: PrintMesh): PrintBody => ({ id, name: id, mesh });

/**
 * A table with a T-shaped cross-section: a 40 × 5 top on a 10 × 30 leg, 40 deep. Standing on
 * the leg, the underside of the top overhangs; upside down nothing does.
 */
const table = prism(
  [[15, 0], [25, 0], [25, 30], [40, 30], [40, 35], [0, 35], [0, 30], [15, 30]],
  [[0, 1, 2], [0, 2, 7], [5, 6, 7], [5, 7, 2], [5, 2, 3], [5, 3, 4]],
  40,
);

describe("meshes", () => {
  it("measures volume, area and bounds", () => {
    const m = box(0, 0, 0, 100, 80, 50);
    expect(meshVolume(m)).toBeCloseTo(400000, 3);
    expect(meshArea(m)).toBeCloseTo(2 * (100 * 80 + 100 * 50 + 80 * 50), 3);
    expect(meshBounds(m).max).toEqual({ x: 100, y: 80, z: 50 });
  });

  it("welds the vertices that a kernel repeats along shared edges", () => {
    const m = box(0, 0, 0, 10, 10, 10);
    expect(m.positions.length / 3).toBe(24);
    expect(openEdges(m)).toBeGreaterThan(0);
    const w = weldMesh(m);
    expect(w.positions.length / 3).toBe(8);
    expect(w.indices.length / 3).toBe(12);
    expect(openEdges(w)).toBe(0);
    expect(meshVolume(w)).toBeCloseTo(1000, 4);
  });

  it("orients a body onto the bed without changing it", () => {
    const m = box(5, 5, 5, 105, 85, 55);
    for (const down of [
      { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    ]) {
      const o = orientMesh(m, down);
      const b = meshBounds(o);
      expect([b.min.x, b.min.y, b.min.z]).toEqual([0, 0, 0]);
      expect(meshVolume(o)).toBeCloseTo(400000, 1);
      const height = down.z !== 0 ? 50 : down.x !== 0 ? 100 : 80;
      expect(b.max.z).toBeCloseTo(height, 4);
    }
    const tilted = orientMesh(m, { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 });
    expect(meshVolume(tilted)).toBeCloseTo(400000, 0);
    expect(meshBounds(tilted).max.z).toBeCloseTo((100 + 50) * Math.SQRT1_2, 3);
  });
});

describe("overhangs", () => {
  it("finds the underside of the table top, not the face on the bed", () => {
    const standing = analyzeOverhangs(orientMesh(table, { x: 0, y: 0, z: -1 }), 45);
    expect(meshVolume(table)).toBeCloseTo((10 * 30 + 40 * 5) * 40, 3);
    expect(openEdges(table)).toBe(0);
    expect(standing.area).toBeCloseTo((40 - 10) * 40, 3);
    expect(standing.contactArea).toBeCloseTo(10 * 40, 3);
    const flipped = analyzeOverhangs(orientMesh(table, { x: 0, y: 0, z: 1 }), 45);
    expect(flipped.area).toBeCloseTo(0, 3);
    expect(flipped.contactArea).toBeCloseTo(1600, 3);
  });

  it("respects the angle", () => {
    // A wedge whose sloping underside leans 30° from vertical.
    const h = 20;
    const run = h * Math.tan((30 * Math.PI) / 180);
    const positions = Float32Array.from([
      0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0,
      -run, 0, h, 10, 0, h, 10, 10, h, -run, 10, h,
    ]);
    const indices = Uint32Array.from([
      0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]);
    const wedge = { positions, indices };
    expect(meshVolume(wedge)).toBeGreaterThan(0);
    expect(analyzeOverhangs(orientMesh(wedge, { x: 0, y: 0, z: -1 }), 45).area).toBeCloseTo(0, 6);
    const strict = analyzeOverhangs(orientMesh(wedge, { x: 0, y: 0, z: -1 }), 20);
    expect(strict.area).toBeCloseTo(10 * Math.hypot(run, h), 3);
  });

  it("chooses the orientation with the least overhang", () => {
    const down = autoOrient(table, 45);
    expect(down.z).toBeCloseTo(1, 6);
    // A plain box lies on its largest face.
    const flat = autoOrient(box(0, 0, 0, 100, 80, 5), 45);
    expect(Math.abs(flat.z)).toBeCloseTo(1, 6);
    const standingBox = autoOrient(box(0, 0, 0, 5, 80, 100), 45);
    expect(Math.abs(standingBox.x)).toBeCloseTo(1, 6);
  });
});

describe("print job", () => {
  it("estimates plastic, mass and filament", () => {
    const s = defaultPrintSettings();
    const solid = estimatePrint(1000, 600, 10, { ...s, infill: 1 });
    expect(solid.plastic).toBeCloseTo(1000, 6);
    expect(solid.mass).toBeCloseTo(1.24, 6);
    expect(solid.filament).toBeCloseTo(1000 / (Math.PI * 0.875 * 0.875) / 1000, 6);
    expect(solid.layers).toBe(50);
    const light = estimatePrint(400000, 34000, 50, s);
    expect(light.plastic).toBeLessThan(400000 * 0.35);
    expect(light.plastic).toBeGreaterThan(400000 * 0.15);
    // A thin shell is all skin: never more plastic than the body has volume.
    expect(estimatePrint(10, 1000, 1, s).plastic).toBeCloseTo(10, 6);
  });

  it("orients, places and totals several bodies", () => {
    const s = defaultPrintSettings();
    const job = compilePrintJob(
      [body("a", box(0, 0, 0, 100, 80, 50)), body("b", table), body("c", box(0, 0, 0, 60, 60, 20))],
      s,
    );
    expect(job.parts).toHaveLength(3);
    expect(job.parts.every((p) => p.placed)).toBe(true);
    for (const p of job.parts) {
      const b = meshBounds(p.mesh);
      expect(b.min.z).toBeCloseTo(0, 5);
      expect(b.min.x).toBeGreaterThanOrEqual(-1e-4);
      expect(b.max.x).toBeLessThanOrEqual(s.printer.bed.width + 1e-4);
      expect(b.max.y).toBeLessThanOrEqual(s.printer.bed.depth + 1e-4);
      expect(b.min.x).toBeCloseTo(p.position.x, 4);
    }
    // No two parts overlap on the bed.
    for (const p of job.parts) {
      for (const q of job.parts) {
        if (p === q) continue;
        const apart =
          p.position.x + p.size.x <= q.position.x + 1e-6 ||
          q.position.x + q.size.x <= p.position.x + 1e-6 ||
          p.position.y + p.size.y <= q.position.y + 1e-6 ||
          q.position.y + q.size.y <= p.position.y + 1e-6;
        expect(apart).toBe(true);
      }
    }
    expect(job.total.mass).toBeCloseTo(job.parts.reduce((n, p) => n + p.estimate.mass, 0), 9);
    // The table was turned upside down automatically: no overhang warning.
    expect(job.warnings.filter((w) => w.partId === "b")).toEqual([]);
  });

  it("warns about overhangs, size, contact and open meshes", () => {
    const s = defaultPrintSettings();
    const forced = compilePrintJob([body("t", table)], { ...s, orientations: { t: "-z" } });
    expect(forced.parts[0]!.overhangArea).toBeCloseTo(1200, 2);
    expect(forced.warnings.some((w) => /overhang/.test(w.message))).toBe(true);
    // Standing on an edge, a box hardly touches the bed.
    const onEdge = compilePrintJob([body("e", box(0, 0, 0, 30, 30, 30))], {
      ...s,
      orientations: { e: { down: { x: 1, y: 0, z: -1 } } },
    });
    expect(onEdge.warnings.some((w) => /brim/.test(w.message))).toBe(true);

    const big = compilePrintJob([body("big", box(0, 0, 0, 300, 100, 20))], s);
    expect(big.warnings.some((w) => w.code === "part-too-large" && w.severity === "error")).toBe(true);
    expect(big.parts[0]!.placed).toBe(false);

    const open = box(0, 0, 0, 10, 10, 10);
    const holed = { positions: open.positions, indices: open.indices.slice(6) };
    const broken = compilePrintJob([body("open", holed)], s);
    expect(broken.parts).toHaveLength(0);
    expect(broken.warnings[0]!.message).toMatch(/not a closed solid/);
  });
});

describe("export", () => {
  it("writes binary STL", () => {
    const stl = writeBinaryStl([weldMesh(box(0, 0, 0, 10, 20, 30))]);
    expect(stl.length).toBe(84 + 12 * 50);
    const view = new DataView(stl.buffer);
    expect(view.getUint32(80, true)).toBe(12);
    expect(new TextDecoder().decode(stl.slice(0, 6))).toBe("FabCAD");
    // First triangle: bottom face, normal −Z.
    expect(view.getFloat32(84 + 8, true)).toBeCloseTo(-1);
    let maxZ = 0;
    for (let t = 0; t < 12; t++) {
      for (let k = 0; k < 3; k++) maxZ = Math.max(maxZ, view.getFloat32(84 + t * 50 + 12 + k * 12 + 8, true));
    }
    expect(maxZ).toBe(30);
  });

  it("writes 3MF as a ZIP archive in millimetres", () => {
    const file = write3mf([
      { name: "Body <1>", mesh: weldMesh(box(0, 0, 0, 10, 20, 30)) },
      { name: "Body2", mesh: weldMesh(box(20, 0, 0, 30, 10, 10)) },
    ]);
    const view = new DataView(file.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // End of central directory: three entries.
    expect(view.getUint32(file.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(file.length - 22 + 10, true)).toBe(3);
    const text = new TextDecoder().decode(file);
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("3D/3dmodel.model");
    expect(text).toContain('unit="millimeter"');
    expect(text).toContain('name="Body &lt;1&gt;"');
    expect((text.match(/<vertex /g) ?? []).length).toBe(16);
    expect((text.match(/<triangle /g) ?? []).length).toBe(24);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
