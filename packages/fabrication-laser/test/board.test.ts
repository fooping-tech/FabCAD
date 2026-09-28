import { describe, expect, it } from "vitest";
import {
  type Vec2,
  type Vec3,
  boundsOfPoints,
  boundsOfPoints3,
  dist3,
  makePlane,
  prismTopology,
  signedArea,
} from "@fabcad/geometry";
import {
  type EdgeConnection,
  type FabricationResult,
  type FlatPart,
  StrategyRegistry,
  fabricate,
} from "@fabcad/fabrication-core";
import {
  type BoardSettings,
  classifyBoardBody,
  defaultStrategyFor,
  edgeCompensation,
  laserBoardStrategy,
  registerLaserStrategies,
} from "../src";
import * as fx from "./fixtures";

const T = fx.MDF.thickness;
const FIT = fx.MDF.fitOffset;

const build = (b = fx.boxBody(), settings: Partial<BoardSettings> = {}): FabricationResult =>
  fabricate(b, fx.MDF, laserBoardStrategy, { kerfCompensation: false, ...settings });

const partOf = (r: FabricationResult, id: string): FlatPart => {
  const p = r.parts.find((x) => x.id === id);
  if (!p) throw new Error(`no part ${id}`);
  return p;
};

const byName = (r: FabricationResult, name: string): FlatPart => {
  const p = r.parts.find((x) => x.name === name);
  if (!p) throw new Error(`no part ${name}`);
  return p;
};

const tabsOf = (r: FabricationResult, c: EdgeConnection): Vec2[][] =>
  partOf(r, c.b.partId).joints.flatMap((j) =>
    j.kind === "tab" && j.connectionId === c.id ? j.polygons : [],
  );

const slotsOf = (r: FabricationResult, c: EdgeConnection): Vec2[][] =>
  partOf(r, c.a.partId).joints.flatMap((j) =>
    j.kind === "slot" && j.connectionId === c.id ? j.polygons : [],
  );

/** Bounds in the frame of a part edge: x along the edge, y = depth into the material. */
function edgeBounds(part: FlatPart, edgeId: string, points: Vec2[]) {
  const edge = part.edges.find((e) => e.id === edgeId);
  if (!edge) throw new Error(`no edge ${edgeId}`);
  const ux = (edge.b.x - edge.a.x) / edge.length;
  const uy = (edge.b.y - edge.a.y) / edge.length;
  return boundsOfPoints(
    points.map((p) => ({
      x: (p.x - edge.a.x) * ux + (p.y - edge.a.y) * uy,
      y: (p.y - edge.a.y) * ux - (p.x - edge.a.x) * uy,
    })),
  );
}

/**
 * Cross-section of a tab in the plane of the slot panel (tab polygon swept by the thickness),
 * measured in the frame of the slot panel's edge.
 */
function tabFootprint(tabPart: FlatPart, slotPart: FlatPart, slotEdge: string, tab: Vec2[]) {
  const pts: Vec3[] = [];
  for (const p of tab) {
    pts.push(fx.toWorld(tabPart, p, 0));
    pts.push(fx.toWorld(tabPart, p, tabPart.thickness));
  }
  return edgeBounds(
    slotPart,
    slotEdge,
    pts.map((p) => fx.toPart(slotPart, p)),
  );
}

function expectTabsMatchSlots(r: FabricationResult): number {
  let checked = 0;
  for (const c of r.connections.filter((x) => x.joint === "tab-slot")) {
    const tabs = tabsOf(r, c);
    const slots = slotsOf(r, c);
    expect(tabs.length).toBe(slots.length);
    const slotPart = partOf(r, c.a.partId);
    tabs.forEach((tab, i) => {
      const foot = tabFootprint(partOf(r, c.b.partId), slotPart, c.a.edgeId, tab);
      const slot = edgeBounds(slotPart, c.a.edgeId, slots[i]!);
      // The tab is as thick as the material and stands at the margin from the edge.
      expect(foot.maxY - foot.minY).toBeCloseTo(T, 6);
      // slot = tab cross-section enlarged by fitOffset on every side: equal positions along
      // the edge; an open notch (margin 0) starts at the outline instead.
      expect(slot.minX).toBeCloseTo(foot.minX - FIT, 6);
      expect(slot.maxX).toBeCloseTo(foot.maxX + FIT, 6);
      expect(slot.minY).toBeCloseTo(Math.max(0, foot.minY - FIT), 6);
      expect(slot.maxY).toBeCloseTo(foot.maxY + FIT, 6);
      checked++;
    });
  }
  return checked;
}

describe("laser board strategy: rectangle box, MDF 5.5", () => {
  const r = build();

  it("makes six panels with generic names", () => {
    expect(r.strategyId).toBe("laser.board");
    expect(r.parts).toHaveLength(6);
    expect(r.parts.map((p) => p.name).sort()).toEqual(
      ["bottom", "side-0", "side-1", "side-2", "side-3", "top"].sort(),
    );
    for (const p of r.parts) {
      expect(p.thickness).toBe(5.5);
      expect(p.sourceFaces).toHaveLength(1);
      expect(p.frame).toBeDefined();
      expect(signedArea(p.outline)).toBeGreaterThan(0);
      expect(p.edges.every((e) => e.id === `${p.id}.edge-${e.index}`)).toBe(true);
    }
  });

  it("derives explicit connections from the topology", () => {
    expect(r.connections).toHaveLength(12);
    expect(r.connections.filter((c) => c.joint === "tab-slot")).toHaveLength(8);
    expect(r.connections.filter((c) => c.joint === "flat")).toHaveLength(4);
    for (const c of r.connections) {
      expect(c.angle).toBeCloseTo(90, 6);
      for (const end of [c.a, c.b]) {
        const edge = partOf(r, end.partId).edges.find((e) => e.id === end.edgeId);
        expect(edge?.connectionId).toBe(c.id);
        expect(edge?.sourceEdge).toBe(c.sourceEdge);
      }
    }
  });

  it("compensates panel sizes for thickness and slot margin", () => {
    const margin = 3;
    // caps keep the designed outline
    expect(fx.polygonSize(byName(r, "top").outline)).toEqual({ width: 100, height: 80 });
    expect(fx.polygonSize(byName(r, "bottom").outline)).toEqual({ width: 100, height: 80 });
    const sides = r.parts.filter((p) => p.name.startsWith("side"));
    const widths = sides.map((p) => fx.polygonSize(p.outline).width).sort((a, b) => a - b);
    // long walls run through (margin at each end), short walls butt against them
    expect(widths[0]).toBeCloseTo(80 - 2 * (margin + T), 6);
    expect(widths[1]).toBeCloseTo(80 - 2 * (margin + T), 6);
    expect(widths[2]).toBeCloseTo(100 - 2 * margin, 6);
    expect(widths[3]).toBeCloseTo(100 - 2 * margin, 6);
    for (const p of sides) {
      expect(fx.polygonSize(p.outline).height).toBeCloseTo(50 - 2 * T, 6);
      // with tabs the final part is as high as the solid
      expect(fx.size(p).height).toBeCloseTo(50, 6);
    }
  });

  it("matches every tab with its slot", () => {
    expect(expectTabsMatchSlots(r)).toBeGreaterThanOrEqual(8);
    const slotPaths = r.parts.flatMap((p) => p.paths.filter((x) => x.role === "slot"));
    const slots = r.parts.flatMap((p) =>
      p.joints.flatMap((j) => (j.kind === "slot" ? j.polygons : [])),
    );
    expect(slotPaths).toHaveLength(slots.length);
    for (const s of slotPaths) {
      expect(s.type).toBe("cut");
      expect(s.closed).toBe(true);
      expect(s.connectionId).toBeDefined();
    }
  });

  it("keeps slots inside the cap, the margin away from its outline", () => {
    for (const cap of [byName(r, "top"), byName(r, "bottom")]) {
      const slots = cap.joints.flatMap((j) => (j.kind === "slot" ? j.polygons : []));
      expect(slots.length).toBeGreaterThan(0);
      for (const s of slots) {
        const b = boundsOfPoints(s);
        const gap = Math.min(b.minX, b.minY, 100 - b.maxX, 80 - b.maxY);
        expect(gap).toBeCloseTo(3 - FIT, 6);
      }
      // slots never touch each other
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = boundsOfPoints(slots[i]!);
          const b = boundsOfPoints(slots[j]!);
          const apart =
            a.maxX < b.minX - 1 || b.maxX < a.minX - 1 || a.maxY < b.minY - 1 || b.maxY < a.minY - 1;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it("keeps joint geometry out of the part outline", () => {
    for (const p of r.parts.filter((x) => x.name.startsWith("side"))) {
      expect(p.outline).toHaveLength(4);
      const outlinePath = p.paths.find((x) => x.role === "outline");
      const tabs = p.joints.flatMap((j) => (j.kind === "tab" ? j.polygons : []));
      expect(outlinePath?.points.length).toBe(4 + 4 * tabs.length);
      const tabArea = tabs.reduce((s, t) => s + Math.abs(signedArea(t)), 0);
      expect(signedArea(outlinePath?.points ?? [])).toBeCloseTo(signedArea(p.outline) + tabArea, 6);
    }
  });

  it("has no warnings for a plain box", () => {
    expect(r.warnings).toEqual([]);
  });
});

describe("laser board strategy: assembly check (margin 0)", () => {
  const r = build(fx.boxBody(), { slotEdgeMargin: 0 });

  const slab = (p: FlatPart) =>
    boundsOfPoints3(
      p.outline.flatMap((q) => [fx.toWorld(p, q, 0), fx.toWorld(p, q, p.thickness)]),
    );

  it("panels do not overlap in 3D and fill the envelope of the solid", () => {
    const slabs = r.parts.map(slab);
    for (let i = 0; i < slabs.length; i++) {
      for (let j = i + 1; j < slabs.length; j++) {
        const a = slabs[i]!;
        const b = slabs[j]!;
        const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        const volume = Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
        expect(volume).toBeCloseTo(0, 6);
      }
    }
    const all = boundsOfPoints3(slabs.flatMap((s) => [s.min, s.max]));
    expect(all.min.x).toBeCloseTo(0, 6);
    expect(all.min.y).toBeCloseTo(0, 6);
    expect(all.min.z).toBeCloseTo(0, 6);
    expect(all.max.x).toBeCloseTo(100, 6);
    expect(all.max.y).toBeCloseTo(80, 6);
    expect(all.max.z).toBeCloseTo(50, 6);
    // butt walls stop at the inner faces of the through walls
    const widths = r.parts
      .filter((p) => p.name.startsWith("side"))
      .map((p) => fx.polygonSize(p.outline).width)
      .sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(80 - 2 * T, 6);
    expect(widths[3]).toBeCloseTo(100, 6);
  });

  it("turns slots into open notches merged into the outline", () => {
    const top = byName(r, "top");
    expect(top.paths.filter((p) => p.role === "slot")).toHaveLength(0);
    const slots = top.joints.flatMap((j) => (j.kind === "slot" ? j.polygons : []));
    expect(slots.length).toBeGreaterThan(0);
    const outlinePath = top.paths.find((p) => p.role === "outline");
    expect(outlinePath?.points.length).toBe(4 + 4 * slots.length);
    const notchArea = slots.reduce((s, t) => s + Math.abs(signedArea(t)), 0);
    expect(signedArea(outlinePath?.points ?? [])).toBeCloseTo(100 * 80 - notchArea, 6);
    expect(expectTabsMatchSlots(r)).toBeGreaterThan(0);
  });
});

describe("laser board strategy: box joints", () => {
  it("finger joints on a box are complementary", () => {
    const r = build(fx.boxBody(), { sideJoint: "finger", capJoint: "finger" });
    expect(r.connections.every((c) => c.joint === "finger")).toBe(true);
    for (const c of r.connections) {
      const fingers = [c.a, c.b].map((end) =>
        partOf(r, end.partId).joints.flatMap((j) =>
          j.kind === "finger" && j.connectionId === c.id ? j.add : [],
        ),
      );
      const [a, b] = [fingers[0]!, fingers[1]!];
      expect(a.length).toBe(b.length + 1);
      expect((a.length + b.length) % 2).toBe(1);
      // equal finger length on both panels, protruding by the thickness
      const dims = [...a, ...b].map((f) => {
        const s = fx.polygonSize(f);
        return [Math.min(s.width, s.height), Math.max(s.width, s.height)];
      });
      for (const d of dims) {
        expect(Math.min(Math.abs(d[0]! - T), Math.abs(d[1]! - T))).toBeCloseTo(0, 6);
      }
      // along the shared 3D edge the fingers tile the interval, alternating between panels
      const spans = [c.a, c.b].flatMap((end, k) => {
        const part = partOf(r, end.partId);
        const edge = part.edges.find((e) => e.id === end.edgeId)!;
        const o = fx.toWorld(partOf(r, c.a.partId), partOf(r, c.a.partId).edges.find((e) => e.id === c.a.edgeId)!.a);
        const e0 = fx.toWorld(part, edge.a);
        const e1 = fx.toWorld(part, edge.b);
        const sign = k === 0 ? 1 : -1; // the mate runs the other way
        const d = {
          x: (sign * (e1.x - e0.x)) / edge.length,
          y: (sign * (e1.y - e0.y)) / edge.length,
          z: (sign * (e1.z - e0.z)) / edge.length,
        };
        return fingers[k]!.map((f) => {
          const s = f
            .map((p) => fx.toWorld(part, p))
            .map((w) => (w.x - o.x) * d.x + (w.y - o.y) * d.y + (w.z - o.z) * d.z);
          return { owner: k, lo: Math.min(...s), hi: Math.max(...s) };
        });
      });
      spans.sort((x, y) => x.lo - y.lo);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.lo).toBeCloseTo(spans[i - 1]!.hi, 6);
        expect(spans[i]!.owner).not.toBe(spans[i - 1]!.owner);
      }
      expect(spans.length).toBe(a.length + b.length);
    }
  });

  it("honours role overrides", () => {
    const base = build(fx.boxBody());
    const caps = base.parts.filter((p) => p.joints.some((j) => j.kind === "slot"));
    expect(caps.map((p) => p.sourceFaces[0]).sort()).toEqual([0, 1]);
    const r = build(fx.boxBody(), { roles: { 0: "tab", 1: "tab" } });
    const forced = r.parts.filter((p) => p.joints.some((j) => j.kind === "slot"));
    expect(forced.length).toBe(2);
    expect(forced.some((p) => p.sourceFaces[0] === 0 || p.sourceFaces[0] === 1)).toBe(false);
    expectTabsMatchSlots(r);
  });
});

const kindOf = (b: ReturnType<typeof fx.body>, material = fx.MDF) =>
  classifyBoardBody(b, material);

function expectUnsupported(b: ReturnType<typeof fx.body>, reason: RegExp): FabricationResult {
  const c = kindOf(b);
  expect(c.kind).toBe("unsupported");
  expect(c.reason).toMatch(reason);
  const r = build(b);
  expect(r.parts).toHaveLength(0);
  expect(r.connections).toHaveLength(0);
  expect(r.classification).toMatchObject({
    kind: "unsupported",
    label: "Unsupported body",
    supported: false,
  });
  expect(r.classification?.reason).toBe(c.reason);
  expect(r.warnings).toHaveLength(1);
  const w = r.warnings[0]!;
  expect(w.code).toBe("unsupported-board-shape");
  expect(w.severity).toBe("error");
  expect(w.message).toContain("cannot be automatically fabricated from 5.5 mm MDF");
  expect(w.message).toContain("flat sheet parts");
  expect(w.message).toContain("rectangular boxes");
  expect(w.message).toContain(c.reason!);
  return r;
}

function expectFlatPart(b: ReturnType<typeof fx.body>, settings: Partial<BoardSettings> = {}): FlatPart {
  expect(kindOf(b).kind).toBe("flat-part");
  const r = build(b, settings);
  expect(r.classification).toEqual({ kind: "flat-part", label: "Flat Part", supported: true });
  expect(r.parts).toHaveLength(1);
  expect(r.connections).toEqual([]);
  expect(r.warnings).toEqual([]);
  const part = r.parts[0]!;
  expect(part.joints).toEqual([]);
  expect(part.folds).toEqual([]);
  expect(part.paths.every((p) => p.role === "outline" || p.role === "hole")).toBe(true);
  expect(part.paths.every((p) => p.type === "cut" && p.closed)).toBe(true);
  expect(part.paths.filter((p) => p.role === "outline")).toHaveLength(1);
  expect(part.edges.every((e) => e.connectionId === undefined)).toBe(true);
  expect(part.thickness).toBe(5.5);
  expect(part.sourceFaces).toHaveLength(2);
  expect(signedArea(part.outline)).toBeGreaterThan(0);
  return part;
}

/** Every outline vertex of the part is a vertex of the body's source face, in order. */
function expectOutlineIsFace(part: FlatPart, b: ReturnType<typeof fx.body>): void {
  const face = b.topology.faces[part.sourceFaces[0]!]!;
  const loops = [part.outline, ...part.holes];
  expect(loops).toHaveLength(face.loops.length);
  loops.forEach((loop, li) => {
    expect(loop).toHaveLength(face.loops[li]!.length);
    loop.forEach((p, i) => {
      const v = b.topology.vertices[face.loops[li]![i]!]!;
      expect(dist3(fx.toWorld(part, p), v)).toBeLessThan(1e-9);
    });
  });
}

const tilted = makePlane({ x: 12, y: -7, z: 30 }, { x: 1, y: 2, z: 3 }, { x: 3, y: 0, z: -1 });

describe("board classification: flat part", () => {
  it("A. 5.5 mm hexagonal sheet: one part, the original hexagon, no joints", () => {
    const hex = fx.regularPolygon(6, 40);
    const b = fx.body(prismTopology(hex, 5.5), "hex-sheet");
    const part = expectFlatPart(b);
    expect(part.outline).toHaveLength(6);
    expect(part.holes).toEqual([]);
    expect(part.paths).toHaveLength(1);
    expect(part.paths[0]!.points).toHaveLength(6);
    expect(part.paths[0]!.points).toEqual(part.outline);
    expect(signedArea(part.outline)).toBeCloseTo(signedArea(hex), 6);
    for (const e of part.edges) expect(e.length).toBeCloseTo(40, 6);
    expectOutlineIsFace(part, b);
    // Seen from above: the part is drawn from the top face.
    expect(part.frame?.normal.z).toBeCloseTo(1, 9);
    expect(part.sourceFaces).toEqual([1, 0]);
  });

  it("B. 5.5 mm rectangular sheet", () => {
    const b = fx.body(prismTopology(fx.rectangle(120, 70), 5.5), "plate");
    const part = expectFlatPart(b);
    expect(fx.polygonSize(part.outline)).toEqual({ width: 120, height: 70 });
    expect(fx.size(part)).toEqual({ width: 120, height: 70 });
    expectOutlineIsFace(part, b);
  });

  it("C. sheet with holes: one outline, holes preserved", () => {
    const holes = [
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 25 },
        { x: 10, y: 25 },
      ],
      fx.regularPolygon(5, 8).map((p) => ({ x: p.x + 70, y: p.y + 40 })),
    ];
    const b = fx.body(prismTopology(fx.rectangle(100, 80), 5.5, holes), "holes");
    const part = expectFlatPart(b);
    expect(part.outline).toHaveLength(4);
    expect(part.holes).toHaveLength(2);
    expect(part.paths.filter((p) => p.role === "hole")).toHaveLength(2);
    const sizes = part.holes.map((h) => fx.polygonSize(h));
    expect(sizes[0]!.width).toBeCloseTo(20, 6);
    expect(sizes[0]!.height).toBeCloseTo(15, 6);
    expect(part.holes[1]).toHaveLength(5);
    expect(part.edges).toHaveLength(4 + 4 + 5);
    expect(part.edges.map((e) => e.loop)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expectOutlineIsFace(part, b);
  });

  it("works for triangles, stars and tilted sheets", () => {
    for (const profile of [fx.regularPolygon(3, 50), fx.starPolygon(5, 60, 25)]) {
      const b = fx.body(prismTopology(profile, 5.5, [], tilted), "sheet");
      const part = expectFlatPart(b);
      expect(part.outline).toHaveLength(profile.length);
      expect(signedArea(part.outline)).toBeCloseTo(Math.abs(signedArea(profile)), 6);
      expectOutlineIsFace(part, b);
    }
  });

  it("accepts facetted round walls: a disc and a plate with a round hole", () => {
    const curve = (topology: ReturnType<typeof prismTopology>, from: number) => {
      for (const face of topology.faces) {
        if (face.id >= from) {
          face.surface = "curved";
          face.sourceFace = from;
        }
      }
      for (const edge of topology.edges) {
        if (edge.faces.every((f) => f >= from)) edge.smooth = true;
      }
      return topology;
    };
    const disc = fx.body(curve(prismTopology(fx.regularPolygon(24, 30), 5.5), 2), "disc");
    const discPart = expectFlatPart(disc);
    expect(discPart.outline).toHaveLength(24);
    expectOutlineIsFace(discPart, disc);

    const round = fx.regularPolygon(16, 10).map((p) => ({ x: p.x + 50, y: p.y + 40 }));
    // Faces 0, 1 = caps, 2..5 = outer walls, 6.. = wall of the round hole.
    const plate = fx.body(curve(prismTopology(fx.rectangle(100, 80), 5.5, [round]), 6), "plate");
    const platePart = expectFlatPart(plate);
    expect(platePart.holes).toHaveLength(1);
    expect(platePart.holes[0]).toHaveLength(16);
    expectOutlineIsFace(platePart, plate);
  });

  it("applies kerf compensation and nothing else", () => {
    const b = fx.body(prismTopology(fx.rectangle(100, 80), 5.5, [
      [
        { x: 30, y: 25 },
        { x: 70, y: 25 },
        { x: 70, y: 55 },
        { x: 30, y: 55 },
      ],
    ]), "frame");
    const part = expectFlatPart(b, { kerfCompensation: true });
    const kerf = fx.MDF.kerf;
    expect(fx.size(part).width).toBeCloseTo(100 + kerf, 6);
    expect(fx.size(part).height).toBeCloseTo(80 + kerf, 6);
    const hole = fx.polygonSize(part.paths.find((p) => p.role === "hole")!.points);
    expect(hole.width).toBeCloseTo(40 - kerf, 6);
    expect(hole.height).toBeCloseTo(30 - kerf, 6);
    // Nominal geometry is untouched; the fit offset plays no part.
    expect(fx.polygonSize(part.outline)).toEqual({ width: 100, height: 80 });
    const noFit = fabricate(b, { ...fx.MDF, fitOffset: 0.7 }, laserBoardStrategy, {
      kerfCompensation: true,
    });
    expect(noFit.parts[0]!.paths).toEqual(part.paths);
  });

  it("J. thickness mismatch: a 6.0 mm body is not a flat part of 5.5 mm MDF", () => {
    const b = fx.body(prismTopology(fx.regularPolygon(6, 40), 6), "hex-6");
    expect(kindOf(b).reasonCode).toBe("thickness-mismatch");
    expectUnsupported(b, /6 mm thick.*5\.5 mm MDF/);
    const plate = fx.body(prismTopology(fx.rectangle(120, 70), 6), "plate-6");
    expect(kindOf(plate).kind).not.toBe("flat-part");
    expectUnsupported(plate, /6 mm thick/);
    // Within the tolerance (default 0.1 mm) the body is the sheet.
    const close = fx.body(prismTopology(fx.regularPolygon(6, 40), 5.58), "hex-5.58");
    expect(kindOf(close).kind).toBe("flat-part");
    expect(classifyBoardBody(close, fx.MDF, { thicknessTolerance: 0.05 }).kind).toBe("unsupported");
    expect(build(close, { thicknessTolerance: 0.05 }).parts).toHaveLength(0);
    // The same body is a flat part of a 6 mm material.
    expect(classifyBoardBody(b, { ...fx.MDF, thickness: 6 }).kind).toBe("flat-part");
  });

  it("does not take a body with sloped or stepped walls for a sheet", () => {
    // Frustum 5.5 mm high: parallel faces at the right distance, but different profiles.
    const frustum = fx.topologyFromLoops(
      [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 100, y: 100, z: 0 },
        { x: 0, y: 100, z: 0 },
        { x: 2, y: 2, z: 5.5 },
        { x: 98, y: 2, z: 5.5 },
        { x: 98, y: 98, z: 5.5 },
        { x: 2, y: 98, z: 5.5 },
      ],
      [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ],
    );
    expectUnsupported(fx.body(frustum, "chamfered"), /non-90°/);
    // An L-shaped bar 5.5 mm wide: its largest faces are not 5.5 mm apart.
    const l = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 50 },
      { x: 0, y: 50 },
    ];
    expectUnsupported(fx.body(prismTopology(l, 40), "l-bar"), /not a rectangular box/);
  });
});

describe("board classification: rectangular box", () => {
  it("D. 100 × 80 × 50 box: six parts", () => {
    const c = kindOf(fx.boxBody());
    expect(c.kind).toBe("rectangular-box");
    expect(c.box?.size).toEqual([50, 80, 100]);
    expect(c.box?.pairs).toHaveLength(3);
    const r = build();
    expect(r.classification).toEqual({
      kind: "rectangular-box",
      label: "Rectangular Box",
      supported: true,
    });
    expect(r.parts).toHaveLength(6);
    expect(r.connections).toHaveLength(12);
  });

  it("I. rotated box: recognised, same panels as the axis-aligned box", () => {
    const b = fx.body(prismTopology(fx.rectangle(100, 80), 50, [], tilted), "tilted");
    expect(kindOf(b).kind).toBe("rectangular-box");
    const r = build(b);
    const straight = build();
    expect(r.parts).toHaveLength(6);
    expect(r.warnings).toEqual([]);
    expect(r.connections.map((c) => c.joint)).toEqual(straight.connections.map((c) => c.joint));
    r.parts.forEach((p, i) => {
      const q = straight.parts[i]!;
      expect(p.sourceFaces).toEqual(q.sourceFaces);
      expect(fx.size(p).width).toBeCloseTo(fx.size(q).width, 6);
      expect(fx.size(p).height).toBeCloseTo(fx.size(q).height, 6);
      expect(p.joints.map((j) => j.kind)).toEqual(q.joints.map((j) => j.kind));
    });
    expect(expectTabsMatchSlots(r)).toBe(expectTabsMatchSlots(straight));
  });

  it("rejects a box too small for two panels", () => {
    const b = fx.body(prismTopology(fx.rectangle(100, 80), 10), "thin");
    expect(kindOf(b).reasonCode).toBe("thickness-mismatch");
    const cube = fx.body(prismTopology(fx.rectangle(10, 10), 10), "cube");
    expect(kindOf(cube).reasonCode).toBe("thickness-mismatch");
    expect(build(cube).parts).toHaveLength(0);
  });

  it("rejects a sheared box (parallelepiped)", () => {
    const sheared = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 130, y: 80 },
      { x: 30, y: 80 },
    ];
    expectUnsupported(fx.body(prismTopology(sheared, 50), "sheared"), /non-90°/);
  });
});

describe("board classification: unsupported", () => {
  it("E. 60 mm hexagonal prism", () => {
    const r = expectUnsupported(fx.hexBody(), /non-90° panel joints/);
    expect(kindOf(fx.hexBody()).reasonCode).toBe("non-right-angle");
    expect(r.warnings[0]!.message).toContain("120°");
  });

  it("F. triangular prism", () => {
    expectUnsupported(fx.triangleBody(), /non-90° panel joints/);
  });

  it("G. pyramid", () => {
    expectUnsupported(fx.pyramidBody(), /non-90° panel joints/);
  });

  it("H. frustum: no flat-joint fallback", () => {
    expectUnsupported(fx.frustumBody(), /non-90° panel joints/);
    const r = build(fx.frustumBody(), { sideJoint: "finger", capJoint: "finger" });
    expect(r.parts).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === "joint-fallback")).toBe(false);
  });

  it("star prism and box with an opening", () => {
    expectUnsupported(fx.starBody(), /non-90° panel joints/);
    const hole = [
      { x: 30, y: 25 },
      { x: 70, y: 25 },
      { x: 70, y: 55 },
      { x: 30, y: 55 },
    ];
    const frame = fx.body(prismTopology(fx.rectangle(100, 80), 50, [hole]), "frame");
    expectUnsupported(frame, /not a rectangular box/);
  });

  it("curved body", () => {
    expectUnsupported(fx.cylinderBody(12), /curved face/);
    expect(kindOf(fx.cylinderBody(12)).reasonCode).toBe("curved-faces");
  });

  it("open and broken bodies", () => {
    const open = fx.boxBody();
    open.topology.faces.pop();
    for (const e of open.topology.edges) e.faces = e.faces.filter((f) => f < 5);
    expectUnsupported(open, /not a closed solid/);
    const broken = {
      id: "broken",
      name: "broken",
      topology: {
        vertices: [{ x: 0, y: 0, z: 0 }],
        faces: [
          {
            id: 0,
            sourceFace: 0,
            surface: "plane" as const,
            normal: { x: 0, y: 0, z: 1 },
            loops: [[0, 5, 9]],
          },
        ],
        edges: [{ id: 0, a: 0, b: 7, faces: [0, 3], smooth: false }],
      },
    };
    expectUnsupported(broken, /no usable solid geometry/);
  });

  it("is deterministic", () => {
    for (const b of [fx.boxBody(), fx.hexBody(), fx.pyramidBody()]) {
      expect(classifyBoardBody(b, fx.MDF)).toEqual(classifyBoardBody(b, fx.MDF));
    }
  });
});

describe("laser board strategy: kerf", () => {
  it("grows outlines and shrinks slots by kerf / 2", () => {
    const plain = build(fx.boxBody(), { kerfCompensation: false });
    const comp = build(fx.boxBody(), { kerfCompensation: true });
    const kerf = fx.MDF.kerf;
    plain.parts.forEach((p, i) => {
      const q = comp.parts[i]!;
      expect(fx.size(q).width).toBeCloseTo(fx.size(p).width + kerf, 6);
      expect(fx.size(q).height).toBeCloseTo(fx.size(p).height + kerf, 6);
      // nominal geometry is untouched
      expect(q.outline).toEqual(p.outline);
      expect(q.joints).toEqual(p.joints);
      const slotsP = p.paths.filter((x) => x.role === "slot");
      const slotsQ = q.paths.filter((x) => x.role === "slot");
      slotsP.forEach((s, k) => {
        const a = fx.polygonSize(s.points);
        const b = fx.polygonSize(slotsQ[k]!.points);
        expect(b.width).toBeCloseTo(a.width - kerf, 6);
        expect(b.height).toBeCloseTo(a.height - kerf, 6);
      });
    });
  });
});

describe("laser strategies registry", () => {
  it("registers and selects strategies by material", () => {
    const registry = new StrategyRegistry();
    registerLaserStrategies(registry);
    expect(registry.list("laser").map((s) => s.id)).toEqual(["laser.board", "laser.paper"]);
    expect(defaultStrategyFor(fx.MDF)?.id).toBe("laser.board");
    expect(defaultStrategyFor(fx.PAPER)?.id).toBe("laser.paper");
    expect(fabricate(fx.boxBody(), fx.PAPER, laserBoardStrategy).warnings[0]?.code).toBe(
      "unsupported",
    );
  });
});
