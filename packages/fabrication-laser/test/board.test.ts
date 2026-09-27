import { describe, expect, it } from "vitest";
import {
  type Vec2,
  type Vec3,
  boundsOfPoints,
  boundsOfPoints3,
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

describe("laser board strategy: other solids", () => {
  it("hexagon prism: 8 parts, flat side joints at 120°", () => {
    const r = build(fx.hexBody());
    expect(r.parts).toHaveLength(8);
    const sideJoints = r.connections.filter((c) => c.joint !== "tab-slot");
    expect(sideJoints).toHaveLength(6);
    for (const c of sideJoints) {
      expect(c.joint).toBe("flat");
      expect(c.angle).toBeCloseTo(120, 6);
      expect([c.a.role, c.b.role]).toEqual(["through", "butt"]);
    }
    expect(r.connections.filter((c) => c.joint === "tab-slot")).toHaveLength(12);
    // every wall is through at one end and butt at the other, so all walls are equal
    const widths = r.parts
      .filter((p) => p.name.startsWith("side"))
      .map((p) => fx.polygonSize(p.outline).width);
    for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 6);
    const m = 3;
    const theta = (120 * Math.PI) / 180;
    const expected =
      40 -
      edgeCompensation("through", m, m, T, theta) -
      edgeCompensation("butt", m, m, T, theta);
    expect(widths[0]).toBeCloseTo(expected, 6);
    expect(expectTabsMatchSlots(r)).toBe(12);
    expect(r.parts.every((p) => p.joints.every((j) => j.kind !== "finger"))).toBe(true);
  });

  it("star prism: 12 parts with concave and acute warnings", () => {
    const r = build(fx.starBody());
    expect(r.parts).toHaveLength(12);
    const codes = new Set(r.warnings.map((w) => w.code));
    expect(codes.has("concave-corner")).toBe(true);
    expect(codes.has("acute-angle")).toBe(true);
    const concave = r.warnings.find((w) => w.code === "concave-corner");
    expect(concave?.message).toContain("cannot be reproduced accurately with 5.5 mm MDF");
    expect(concave?.position).toBeDefined();
    expect(concave?.connectionId).toBeDefined();
    expect(r.connections.filter((c) => c.angle > 180)).toHaveLength(5);
    expectTabsMatchSlots(r);
  });

  it("triangle prism: 5 parts", () => {
    const r = build(fx.triangleBody());
    expect(r.parts).toHaveLength(5);
    expect(r.connections.filter((c) => c.joint === "flat")).toHaveLength(3);
    expect(expectTabsMatchSlots(r)).toBeGreaterThan(0);
  });

  it("pyramid (not a prism): oblique edges get flat joints only", () => {
    const r = build(fx.pyramidBody());
    expect(r.parts).toHaveLength(5);
    expect(r.connections).toHaveLength(8);
    for (const c of r.connections) expect(c.joint).toBe("flat");
    for (const p of r.parts) {
      expect(p.joints).toHaveLength(0);
      expect(p.paths).toHaveLength(1);
    }
    expect(r.warnings.some((w) => w.code === "acute-angle")).toBe(true);
    expect(r.warnings.some((w) => w.code === "joint-fallback")).toBe(false);
  });

  it("never forces finger joints on oblique corners", () => {
    const r = build(fx.frustumBody(), { sideJoint: "finger", capJoint: "finger" });
    expect(r.parts).toHaveLength(6);
    for (const c of r.connections) expect(c.joint).toBe("flat");
    expect(r.parts.every((p) => p.joints.length === 0)).toBe(true);
    expect(r.warnings.filter((w) => w.code === "joint-fallback").length).toBeGreaterThan(0);
  });

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

  it("skips curved faces with a warning", () => {
    const r = build(fx.cylinderBody(12));
    expect(r.parts).toHaveLength(2);
    expect(r.warnings.some((w) => w.code === "curved-face")).toBe(true);
    for (const p of r.parts) expect(p.joints).toHaveLength(0);
  });

  it("handles faces with holes (inner walls tab into the caps)", () => {
    const hole = [
      { x: 30, y: 25 },
      { x: 70, y: 25 },
      { x: 70, y: 55 },
      { x: 30, y: 55 },
    ];
    const r = build(fx.body(prismTopology(fx.rectangle(100, 80), 50, [hole]), "frame"));
    expect(r.parts).toHaveLength(10);
    const top = byName(r, "top");
    expect(top.holes).toHaveLength(1);
    expect(fx.polygonSize(top.holes[0]!)).toEqual({ width: 40, height: 30 });
    expect(top.paths.filter((p) => p.role === "hole")).toHaveLength(1);
    expect(r.connections.filter((c) => c.joint === "tab-slot")).toHaveLength(16);
    expect(r.connections.filter((c) => c.angle > 180)).toHaveLength(4);
    expect(r.warnings.filter((w) => w.code === "concave-corner")).toHaveLength(4);
    expect(expectTabsMatchSlots(r)).toBeGreaterThanOrEqual(16);
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
