import { beforeAll, describe, expect, it } from "vitest";
import { type Loop2, type Profile2, ORIGIN_PLANES, type Vec2 } from "@fabcad/geometry";
import type { GeometryKernel } from "../src/kernel";
import { nodeKernel } from "./nodeKernel";

const polygonLoop = (pts: Vec2[]): Loop2 => ({
  curves: pts.map((p, i) => ({ type: "line" as const, a: p, b: pts[(i + 1) % pts.length]! })),
});

const rect = (w: number, h: number, x = 0, y = 0): Profile2 => ({
  outer: polygonLoop([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]),
  holes: [],
});

const circleLoop = (cx: number, cy: number, r: number, ccw = true): Loop2 => ({
  curves: [
    {
      type: "arc",
      center: { x: cx, y: cy },
      radius: r,
      startAngle: 0,
      sweep: ccw ? 2 * Math.PI : -2 * Math.PI,
    },
  ],
});

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await nodeKernel();
});

describe("replicad adapter", () => {
  it("extrudes a rectangle into a box", () => {
    const box = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const g = kernel.tessellate(box);
    expect(g.volume).toBeCloseTo(100 * 80 * 50, 3);
    expect(g.faces).toHaveLength(6);
    expect(g.edges).toHaveLength(12);
    expect(g.vertices.length / 3).toBe(8);
    expect(g.bounds.max).toMatchObject({ x: 100, y: 80, z: 50 });
    expect(g.faces.every((f) => f.surface === "plane")).toBe(true);
    // Face groups must line up with the B-Rep faces: every triangle lies on its face plane.
    for (const f of g.faces) {
      for (let k = f.start; k < f.start + f.count; k++) {
        const v = g.indices[k]!;
        const d =
          (g.positions[v * 3]! - f.center.x) * f.normal.x +
          (g.positions[v * 3 + 1]! - f.center.y) * f.normal.y +
          (g.positions[v * 3 + 2]! - f.center.z) * f.normal.z;
        expect(Math.abs(d)).toBeLessThan(1e-4);
      }
    }
  });

  it("extrudes on other planes and in both directions", () => {
    const a = kernel.tessellate(kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XZ, 0, 5));
    expect(a.bounds.min.y).toBeCloseTo(-5, 6);
    expect(a.bounds.max.z).toBeCloseTo(20, 6);
    const b = kernel.tessellate(kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, -4, 4));
    expect(b.bounds.min.z).toBeCloseTo(-4, 6);
    expect(b.bounds.max.z).toBeCloseTo(4, 6);
    expect(b.volume).toBeCloseTo(10 * 20 * 8, 3);
  });

  it("supports profiles with holes and arcs", () => {
    const profile: Profile2 = { ...rect(100, 80), holes: [circleLoop(50, 40, 10, false)] };
    const g = kernel.tessellate(kernel.extrude([profile], ORIGIN_PLANES.XY, 0, 10));
    expect(g.volume).toBeCloseTo((100 * 80 - Math.PI * 100) * 10, 0);
    expect(g.faces.some((f) => f.surface === "cylinder")).toBe(true);
  });

  it("produces polyhedral topology for manufacturing", () => {
    const box = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const t = kernel.topology(box);
    expect(t.faces).toHaveLength(6);
    expect(t.edges).toHaveLength(12);
    expect(t.vertices).toHaveLength(8);
    expect(t.edges.every((e) => e.faces.length === 2)).toBe(true);
    expect(t.faces.every((f) => f.loops.length === 1 && f.loops[0]!.length === 4)).toBe(true);

    const cyl = kernel.extrude(
      [{ outer: circleLoop(0, 0, 20), holes: [] }],
      ORIGIN_PLANES.XY,
      0,
      30,
    );
    const ct = kernel.topology(cyl);
    const planar = ct.faces.filter((f) => f.surface === "plane");
    const curved = ct.faces.filter((f) => f.surface === "curved");
    expect(planar).toHaveLength(2);
    expect(curved.length).toBeGreaterThan(8);
    expect(curved.every((f) => f.loops[0]!.length === 4)).toBe(true);
    expect(ct.edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it("runs booleans, fillet, chamfer and shell", () => {
    const box = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const tool = kernel.extrude([rect(20, 20, 40, 30)], ORIGIN_PLANES.XY, 0, 50);
    const cut = kernel.boolean("cut", box, [tool]);
    expect(kernel.tessellate(cut).volume).toBeCloseTo(100 * 80 * 50 - 20 * 20 * 50, 2);
    const common = kernel.boolean("intersect", box, [tool]);
    expect(kernel.tessellate(common).volume).toBeCloseTo(20 * 20 * 50, 2);
    const other = kernel.extrude([rect(100, 80, 50, 0)], ORIGIN_PLANES.XY, 0, 50);
    const union = kernel.boolean("union", box, [other]);
    expect(kernel.tessellate(union).volume).toBeCloseTo(150 * 80 * 50, 2);

    const filleted = kernel.fillet(box, [{ point: { x: 0, y: 0, z: 25 } }], 5);
    const fg = kernel.tessellate(filleted);
    expect(fg.faces).toHaveLength(7);
    expect(fg.volume).toBeCloseTo(100 * 80 * 50 - (25 - (Math.PI * 25) / 4) * 50, 1);

    const chamfered = kernel.chamfer(box, [{ point: { x: 50, y: 0, z: 50 } }], 4);
    expect(kernel.tessellate(chamfered).volume).toBeCloseTo(100 * 80 * 50 - 8 * 100, 2);

    const shelled = kernel.shell(
      box,
      [{ point: { x: 50, y: 40, z: 50 }, normal: { x: 0, y: 0, z: 1 } }],
      2,
    );
    expect(kernel.tessellate(shelled).volume).toBeCloseTo(
      100 * 80 * 50 - 96 * 76 * 48,
      1,
    );
  });

  it("revolves a profile", () => {
    const solid = kernel.revolve(
      [rect(10, 20, 5, 0)],
      ORIGIN_PLANES.XZ,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      360,
    );
    expect(kernel.tessellate(solid).volume).toBeCloseTo(Math.PI * (15 * 15 - 5 * 5) * 20, 0);
  });

  it("round-trips STEP and writes STL", async () => {
    const box = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const step = await kernel.exportSTEP([{ shape: box, name: "Box" }]);
    expect(new TextDecoder().decode(step.slice(0, 20))).toContain("ISO-10303-21");
    const back = await kernel.importSTEP(step);
    expect(back).toHaveLength(1);
    expect(kernel.tessellate(back[0]!).volume).toBeCloseTo(100 * 80 * 50, 2);
    const stl = await kernel.exportSTL([box]);
    // Binary STL: 80 byte header + uint32 count + 50 bytes per triangle.
    expect(stl.length).toBe(84 + 12 * 50);
  });

  it("reports failures as KernelError", () => {
    const box = kernel.extrude([rect(10, 10)], ORIGIN_PLANES.XY, 0, 10);
    expect(() => kernel.fillet(box, [{ point: { x: 0, y: 0, z: 5 } }], 50)).toThrow(/Fillet/);
    expect(() => kernel.extrude([rect(10, 10)], ORIGIN_PLANES.XY, 0, 0)).toThrow(/zero/);
  });
});
