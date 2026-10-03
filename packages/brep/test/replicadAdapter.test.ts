import { beforeAll, describe, expect, it } from "vitest";
import { type Loop2, type Profile2, ORIGIN_PLANES, type Vec2 } from "@fabcad/geometry";
import type { GeometryKernel } from "../src/kernel";
import { faceSilhouettes, pointInBody } from "../src/query";
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

  it("shells a body through a face that has a pocket in it", () => {
    // OpenCASCADE's offset with an opening fails here; the kernel hollows and cuts instead.
    const block = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const pocket = kernel.extrude([rect(60, 40, 20, 20)], ORIGIN_PLANES.XY, 35, 60);
    const body = kernel.boolean("cut", block, [pocket]);
    const t = 2;
    const shelled = kernel.shell(body, [{ point: { x: 5, y: 5, z: 50 }, normal: { x: 0, y: 0, z: 1 } }], t);
    expect(kernel.solidProblem(shelled)).toBeNull();
    const g = kernel.tessellate(shelled);
    // Walls and floor of t all round, the pocket kept as a cup inside.
    expect(g.bounds.min).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(g.bounds.max.z).toBeCloseTo(50, 2);
    expect(pointInBody(g, { x: 1, y: 40, z: 25 })).toBe(true); // outer wall
    expect(pointInBody(g, { x: 50, y: 40, z: 1 })).toBe(true); // floor
    expect(pointInBody(g, { x: 19, y: 40, z: 45 })).toBe(true); // wall of the pocket
    expect(pointInBody(g, { x: 50, y: 40, z: 34 })).toBe(true); // floor of the pocket
    expect(pointInBody(g, { x: 10, y: 40, z: 25 })).toBe(false); // inside
    expect(pointInBody(g, { x: 5, y: 5, z: 49 })).toBe(false); // the opened face
    expect(pointInBody(g, { x: 50, y: 40, z: 45 })).toBe(false); // the pocket itself
    // Far less than the body, more than the outer walls alone.
    const walls = 2 * (100 * 80 + 100 * 50 + 80 * 50) * t;
    expect(g.volume).toBeLessThan(walls);
    expect(g.volume).toBeGreaterThan(walls / 2);
  });

  it("shells a body through a face whose edges are rounded", () => {
    // OpenCASCADE's offset gives a broken solid here without an error; the kernel notices.
    const block = kernel.extrude([rect(100, 80)], ORIGIN_PLANES.XY, 0, 50);
    const rim = [
      { x: 50, y: 0, z: 50 },
      { x: 100, y: 40, z: 50 },
      { x: 50, y: 80, z: 50 },
      { x: 0, y: 40, z: 50 },
    ].map((point) => ({ point }));
    const body = kernel.fillet(block, rim, 3);
    const index = kernel
      .tessellate(body)
      .faces.findIndex((f) => f.surface === "plane" && Math.abs(f.center.z - 50) < 1e-6);
    const shelled = kernel.shell(body, [{ point: { x: 50, y: 40, z: 50 }, normal: { x: 0, y: 0, z: 1 }, index }], 1);
    expect(kernel.solidProblem(shelled)).toBeNull();
    const g = kernel.tessellate(shelled);
    expect(pointInBody(g, { x: 0.5, y: 40, z: 25 })).toBe(true); // wall
    expect(pointInBody(g, { x: 1.23, y: 40, z: 48.77 })).toBe(true); // the rounded rim
    expect(pointInBody(g, { x: 50, y: 40, z: 25 })).toBe(false); // inside
    expect(pointInBody(g, { x: 50, y: 40, z: 49.5 })).toBe(false); // the opening
    expect(g.volume).toBeLessThan(2 * (100 * 80 + 100 * 50 + 80 * 50));
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

describe("faceSilhouettes", () => {
  it("finds the sides of a cylinder seen from the side, exactly", () => {
    const g = kernel.tessellate(
      kernel.extrude([{ outer: circleLoop(0, 0, 20), holes: [] }], ORIGIN_PLANES.XY, 0, 30),
    );
    const curved = g.faces.flatMap((f, i) => (f.surface === "cylinder" ? [i] : []));
    expect(curved.length).toBeGreaterThan(0);
    // Seen along X, the silhouettes are the lines y = ±20, 0 ≤ z ≤ 30.
    const lines = curved.flatMap((i) => faceSilhouettes(g, i, { x: 1, y: 0, z: 0 }));
    expect(lines).toHaveLength(2);
    const ys = lines.map((l) => l[0]!.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-20, 4);
    expect(ys[1]).toBeCloseTo(20, 4);
    for (const l of lines) {
      for (const p of l) {
        expect(Math.abs(p.x)).toBeLessThan(1e-4);
        expect(Math.abs(Math.abs(p.y) - 20)).toBeLessThan(1e-4);
      }
      const zs = l.map((p) => p.z);
      expect(Math.min(...zs)).toBeCloseTo(0, 4);
      expect(Math.max(...zs)).toBeCloseTo(30, 4);
    }
    // Seen along its axis a cylinder has no silhouette: its circles are the outline.
    expect(curved.flatMap((i) => faceSilhouettes(g, i, { x: 0, y: 0, z: 1 }))).toEqual([]);
    // Flat faces have none.
    const flat = g.faces.findIndex((f) => f.surface === "plane");
    expect(faceSilhouettes(g, flat, { x: 1, y: 0, z: 0 })).toEqual([]);
  });

  it("finds the outline of a sphere as a closed curve on the sphere", () => {
    const half: Profile2 = {
      outer: {
        curves: [
          { type: "arc", center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI },
          { type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
        ],
      },
      holes: [],
    };
    const g = kernel.tessellate(
      kernel.revolve([half], ORIGIN_PLANES.XY, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 360),
    );
    const d = { x: 0.3, y: 0.5, z: 0.8 };
    const n = Math.hypot(d.x, d.y, d.z);
    const points = g.faces
      .flatMap((f, i) => (f.surface === "sphere" ? faceSilhouettes(g, i, d) : []))
      .flat();
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(10, 3);
      expect((p.x * d.x + p.y * d.y + p.z * d.z) / n).toBeCloseTo(0, 3);
    }
  });
});

describe("pointInBody", () => {
  it("tells points inside a body from points outside it and in its holes", () => {
    const profile: Profile2 = { ...rect(100, 80), holes: [circleLoop(50, 40, 10, false)] };
    const g = kernel.tessellate(kernel.extrude([profile], ORIGIN_PLANES.XY, 0, 10));
    expect(pointInBody(g, { x: 20, y: 20, z: 5 })).toBe(true);
    expect(pointInBody(g, { x: 50, y: 40, z: 5 })).toBe(false);
    expect(pointInBody(g, { x: 20, y: 20, z: 11 })).toBe(false);
    expect(pointInBody(g, { x: 20, y: 20, z: -1 })).toBe(false);
    expect(pointInBody(g, { x: 99.5, y: 0.5, z: 9.5 })).toBe(true);
  });
});
