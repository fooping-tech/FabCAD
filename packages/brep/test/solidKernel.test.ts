import { beforeAll, describe, expect, it } from "vitest";
import { type Loop2, ORIGIN_PLANES, type Plane3, type Profile2, type Vec2 } from "@fabcad/geometry";
import { type GeometryKernel, KernelError } from "../src/kernel";
import { circleAxis, edgePolyline } from "../src/query";
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

const circle = (r: number, cx = 0, cy = 0): Profile2 => ({
  outer: {
    curves: [
      { type: "arc", center: { x: cx, y: cy }, radius: r, startAngle: 0, sweep: 2 * Math.PI },
    ],
  },
  holes: [],
});

const planeAt = (z: number): Plane3 => ({ ...ORIGIN_PLANES.XY, origin: { x: 0, y: 0, z } });

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await nodeKernel();
});

const volume = (shape: Parameters<GeometryKernel["tessellate"]>[0]): number =>
  kernel.tessellate(shape).volume;

describe("hole tool", () => {
  const down = { x: 0, y: 0, z: -1 };
  const at = { x: 10, y: 20, z: 30 };

  it("makes a cylinder that starts at the position and runs along the direction", () => {
    const g = kernel.tessellate(kernel.hole([{ position: at, direction: down, diameter: 8, depth: 12 }]));
    expect(g.volume).toBeCloseTo(Math.PI * 16 * 12, 6);
    expect(g.bounds.max.z).toBeCloseTo(30, 6);
    expect(g.bounds.min.z).toBeCloseTo(18, 6);
    expect(g.bounds.min.x).toBeCloseTo(6, 6);
    expect(g.faces.map((f) => f.surface).sort()).toEqual(["cylinder", "plane", "plane"]);
  });

  it("adds a counterbore", () => {
    const g = kernel.tessellate(
      kernel.hole([
        {
          position: at,
          direction: down,
          diameter: 6,
          depth: 20,
          counterbore: { diameter: 11, depth: 4 },
        },
      ]),
    );
    expect(g.volume).toBeCloseTo(Math.PI * 9 * 20 + Math.PI * (5.5 ** 2 - 9) * 4, 6);
    expect(g.faces.filter((f) => f.surface === "cylinder")).toHaveLength(2);
  });

  it("adds a countersink with the included angle", () => {
    const g = kernel.tessellate(
      kernel.hole([
        {
          position: at,
          direction: down,
          diameter: 6,
          depth: 20,
          countersink: { diameter: 12, angle: 90 },
        },
      ]),
    );
    // 90° included: the cone is as high as the radius grows, 3 mm.
    const cone = (Math.PI * 3 * (36 + 18 + 9)) / 3;
    expect(g.volume).toBeCloseTo(cone + Math.PI * 9 * 17, 6);
    expect(g.faces.some((f) => f.surface === "cone")).toBe(true);
  });

  it("joins several holes into one tool", () => {
    const g = kernel.tessellate(
      kernel.hole([
        { position: { x: 0, y: 0, z: 0 }, direction: down, diameter: 4, depth: 5 },
        { position: { x: 20, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, diameter: 4, depth: 5 },
      ]),
    );
    expect(g.volume).toBeCloseTo(2 * Math.PI * 4 * 5, 6);
  });

  it("rejects sizes that make no hole", () => {
    const base = { position: at, direction: down, diameter: 6, depth: 10 };
    expect(() => kernel.hole([])).toThrow(KernelError);
    expect(() => kernel.hole([{ ...base, diameter: 0 }])).toThrow(/diameter/);
    expect(() => kernel.hole([{ ...base, depth: -1 }])).toThrow(/depth/);
    expect(() => kernel.hole([{ ...base, counterbore: { diameter: 5, depth: 2 } }])).toThrow(
      /larger than the hole diameter/,
    );
    expect(() => kernel.hole([{ ...base, counterbore: { diameter: 9, depth: 12 } }])).toThrow(
      /less deep/,
    );
    expect(() => kernel.hole([{ ...base, countersink: { diameter: 40, angle: 20 } }])).toThrow(
      /deeper than the hole/,
    );
    expect(() => kernel.hole([{ ...base, countersink: { diameter: 9, angle: 180 } }])).toThrow(
      /angle/,
    );
  });
});

describe("transform", () => {
  it("translates, rotates and mirrors a copy and leaves the source alone", () => {
    const box = kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, 0, 30);
    const moved = kernel.tessellate(
      kernel.transform(box, [{ type: "translate", vector: { x: 5, y: -2, z: 1 } }]),
    );
    expect(moved.volume).toBeCloseTo(6000, 6);
    expect(moved.bounds.min).toMatchObject({ x: 5, y: -2, z: 1 });

    const turned = kernel.tessellate(
      kernel.transform(box, [
        { type: "rotate", origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, angle: 90 },
      ]),
    );
    expect(turned.bounds.min.x).toBeCloseTo(-20, 6);
    expect(turned.bounds.max.y).toBeCloseTo(10, 6);

    const mirrored = kernel.tessellate(
      kernel.transform(box, [
        { type: "mirror", origin: { x: -5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
      ]),
    );
    expect(mirrored.volume).toBeCloseTo(6000, 6);
    expect(mirrored.bounds.min.x).toBeCloseTo(-20, 6);
    expect(mirrored.bounds.max.x).toBeCloseTo(-10, 6);
    // Every face of the mirror image still looks out of the solid.
    for (const f of mirrored.faces) {
      const centre = { x: -15, y: 10, z: 15 };
      const out =
        (f.center.x - centre.x) * f.normal.x +
        (f.center.y - centre.y) * f.normal.y +
        (f.center.z - centre.z) * f.normal.z;
      expect(out).toBeGreaterThan(0);
    }

    expect(kernel.tessellate(box).bounds.min).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it("applies the steps in order and keeps the order of the faces", () => {
    const box = kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, 0, 30);
    const before = kernel.tessellate(box);
    const after = kernel.tessellate(
      kernel.transform(box, [
        { type: "rotate", origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, angle: 90 },
        { type: "translate", vector: { x: 100, y: 0, z: 0 } },
      ]),
    );
    expect(after.bounds.min.x).toBeCloseTo(80, 6);
    expect(after.faces).toHaveLength(before.faces.length);
    expect(after.edges).toHaveLength(before.edges.length);
    before.faces.forEach((f, i) => {
      // (x, y) → (−y, x) + (100, 0)
      expect(after.faces[i]!.center.x).toBeCloseTo(100 - f.center.y, 6);
      expect(after.faces[i]!.center.y).toBeCloseTo(f.center.x, 6);
      expect(after.faces[i]!.area).toBeCloseTo(f.area, 6);
    });
  });

  it("gives back a shape of its own when there is nothing to do", () => {
    const box = kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, 0, 30);
    const copy = kernel.transform(box, []);
    expect(copy).not.toBe(box);
    kernel.dispose(copy);
    expect(volume(box)).toBeCloseTo(6000, 6);
  });
});

describe("split", () => {
  it("cuts a shape in two along a plane", () => {
    const box = kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, 0, 30);
    const { positive, negative } = kernel.split(box, planeAt(10));
    expect(positive && negative).toBeTruthy();
    const up = kernel.tessellate(positive!);
    const low = kernel.tessellate(negative!);
    expect(up.volume).toBeCloseTo(4000, 6);
    expect(low.volume).toBeCloseTo(2000, 6);
    expect(up.bounds.min.z).toBeCloseTo(10, 6);
    expect(low.bounds.max.z).toBeCloseTo(10, 6);
    expect(volume(box)).toBeCloseTo(6000, 6);
  });

  it("reports the side on which nothing lies", () => {
    const box = kernel.extrude([rect(10, 20)], ORIGIN_PLANES.XY, 0, 30);
    const above = kernel.split(box, planeAt(100));
    expect(above.positive).toBeNull();
    expect(volume(above.negative!)).toBeCloseTo(6000, 6);
    // A plane that only touches a face cuts nothing off either.
    const touching = kernel.split(box, planeAt(30));
    expect(touching.positive).toBeNull();
  });
});

describe("sweep", () => {
  it("moves a circle along a line", () => {
    const g = kernel.tessellate(
      kernel.sweep([circle(2)], ORIGIN_PLANES.XY, [
        { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 25 } },
      ]),
    );
    expect(g.volume).toBeCloseTo(Math.PI * 4 * 25, 5);
    expect(g.bounds.max.z).toBeCloseTo(25, 6);
  });

  it("follows a line and an arc that joins it", () => {
    const a = Math.SQRT1_2;
    const g = kernel.tessellate(
      kernel.sweep(
        [circle(2)],
        ORIGIN_PLANES.XY,
        [
          { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 10 } },
          {
            type: "arc",
            from: { x: 0, y: 0, z: 10 },
            via: { x: 10 - 10 * a, y: 0, z: 10 + 10 * a },
            to: { x: 10, y: 0, z: 20 },
          },
        ],
        { pathNormal: { x: 0, y: 1, z: 0 } },
      ),
    );
    // Pappus: area × length of the path of the centroid.
    expect(g.volume).toBeCloseTo(Math.PI * 4 * (10 + (Math.PI / 2) * 10), 4);
    expect(g.faces.some((f) => f.surface === "torus")).toBe(true);
  });

  it("sweeps a profile with a hole as a tube", () => {
    const ring: Profile2 = {
      outer: circle(4).outer,
      holes: [
        { curves: [{ type: "arc", center: { x: 0, y: 0 }, radius: 3, startAngle: 0, sweep: -2 * Math.PI }] },
      ],
    };
    const g = kernel.tessellate(
      kernel.sweep([ring], ORIGIN_PLANES.XY, [
        { type: "line", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 10 } },
      ]),
    );
    expect(g.volume).toBeCloseTo(Math.PI * (16 - 9) * 10, 5);
  });

  it("needs a path", () => {
    expect(() => kernel.sweep([circle(2)], ORIGIN_PLANES.XY, [])).toThrow(KernelError);
  });
});

describe("loft", () => {
  it("joins two rectangles on parallel planes", () => {
    const g = kernel.tessellate(
      kernel.loft([
        { type: "profile", profile: rect(20, 10, -10, -5), plane: ORIGIN_PLANES.XY },
        { type: "profile", profile: rect(10, 5, -5, -2.5), plane: planeAt(30) },
      ]),
    );
    // Prismatoid: h / 6 · (A1 + 4·Am + A2), the middle section being 15 × 7.5.
    expect(g.volume).toBeCloseTo((30 / 6) * (200 + 4 * 15 * 7.5 + 50), 5);
    expect(g.faces).toHaveLength(6);
  });

  it("takes the outer boundary of a planar face as a section", () => {
    const box = kernel.extrude([rect(20, 10, -10, -5)], ORIGIN_PLANES.XY, 0, 10);
    const top = kernel.tessellate(box).faces.findIndex((f) => Math.abs(f.center.z - 10) < 1e-9);
    const g = kernel.tessellate(
      kernel.loft(
        [
          { type: "face", shape: box, faceIndex: top },
          { type: "profile", profile: rect(10, 5, -5, -2.5), plane: planeAt(40) },
        ],
        { ruled: true },
      ),
    );
    expect(g.volume).toBeCloseTo((30 / 6) * (200 + 4 * 15 * 7.5 + 50), 5);
    expect(g.bounds.min.z).toBeCloseTo(10, 6);
  });

  it("rejects what cannot be lofted", () => {
    const one = { type: "profile" as const, profile: rect(20, 10), plane: ORIGIN_PLANES.XY };
    expect(() => kernel.loft([one])).toThrow(/two sections/);
    const holed: Profile2 = { ...rect(20, 10), holes: [polygonLoop([{ x: 2, y: 2 }, { x: 2, y: 4 }, { x: 4, y: 4 }])] };
    expect(() =>
      kernel.loft([one, { type: "profile", profile: holed, plane: planeAt(10) }]),
    ).toThrow(/hole/);
    const cylinder = kernel.extrude([circle(5)], ORIGIN_PLANES.XY, 0, 10);
    const round = kernel.tessellate(cylinder).faces.findIndex((f) => f.surface === "cylinder");
    expect(() => kernel.loft([one, { type: "face", shape: cylinder, faceIndex: round }])).toThrow(
      /planar/,
    );
  });
});

describe("exact edge and vertex data", () => {
  it("keeps the B-Rep vertices in double precision", () => {
    const x = 40.831077088;
    const g = kernel.tessellate(kernel.extrude([rect(10, 20, x, -23.328422305)], ORIGIN_PLANES.XY, 0, 30));
    expect(g.vertices).toBeInstanceOf(Float64Array);
    const xs = new Set<number>();
    for (let i = 0; i < g.vertices.length; i += 3) xs.add(g.vertices[i]!);
    expect([...xs].sort((a, b) => a - b)).toEqual([x, x + 10]);
  });

  it("gives a circular edge the exact axis, turned the way the edge runs", () => {
    const d = Math.hypot(1, 2, 3);
    const direction = { x: 1 / d, y: 2 / d, z: 3 / d };
    const g = kernel.tessellate(
      kernel.hole([{ position: { x: 113.7, y: -52.1, z: 31.3 }, direction, diameter: 8, depth: 12 }]),
    );
    const circles = g.edges.filter((e) => e.curve === "circle");
    expect(circles.length).toBeGreaterThan(0);
    for (const e of circles) {
      const axis = circleAxis(g, e)!;
      const dot = axis.x * direction.x + axis.y * direction.y + axis.z * direction.z;
      expect(Math.abs(dot)).toBeCloseTo(1, 13);
      // The way round agrees with the samples of the edge: counter-clockwise about the axis.
      const pts = edgePolyline(g, e);
      const [a, b] = [pts[0]!, pts[1]!];
      const c = e.center!;
      const turn =
        ((a.y - c.y) * (b.z - c.z) - (a.z - c.z) * (b.y - c.y)) * axis.x +
        ((a.z - c.z) * (b.x - c.x) - (a.x - c.x) * (b.z - c.z)) * axis.y +
        ((a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x)) * axis.z;
      expect(turn).toBeGreaterThan(0);
    }
  });
});
