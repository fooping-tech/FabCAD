import { describe, expect, it } from "vitest";
import {
  type Vec2,
  faceArea,
  offsetPolygon,
  pointInPolygon,
  prismTopology,
  segmentsIntersect,
  signedArea,
} from "@fabcad/geometry";
import { type CadBody, type FabricationResult, type FlatPart, fabricate } from "@fabcad/fabrication-core";
import { type PaperSettings, laserPaperStrategy } from "../src";
import * as fx from "./fixtures";

const build = (b: CadBody, settings: Partial<PaperSettings> = {}): FabricationResult =>
  fabricate(b, fx.PAPER, laserPaperStrategy, settings);

/** True when a closed polygon crosses itself. */
function selfIntersects(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!, 1e-7)) {
        return true;
      }
    }
  }
  return false;
}

const surfaceArea = (b: CadBody, faces: readonly number[]): number =>
  faces.reduce((s, f) => s + faceArea(b.topology, b.topology.faces[f]!), 0);

const tabs = (p: FlatPart): Vec2[][] =>
  p.joints.flatMap((j) => (j.kind === "glue-tab" ? j.polygons : []));

/** Checks that hold for every net, whatever the solid. */
function expectValidNets(b: CadBody, r: FabricationResult): void {
  const faces = r.parts.flatMap((p) => p.sourceFaces).sort((x, y) => x - y);
  expect(new Set(faces).size).toBe(faces.length);
  for (const p of r.parts) {
    const holeArea = p.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    // No overlaps: the traced boundary encloses exactly the unfolded faces.
    expect(signedArea(p.outline) - holeArea).toBeCloseTo(surfaceArea(b, p.sourceFaces), 4);
    expect(selfIntersects(p.outline)).toBe(false);
    expect(p.folds).toHaveLength(p.sourceFaces.length - 1);
    // Glue tabs are part of the cut outline, not cut off from the net.
    const outline = p.paths.filter((x) => x.role === "outline");
    expect(outline).toHaveLength(1);
    expect(outline[0]!.type).toBe("cut");
    expect(outline[0]!.closed).toBe(true);
    const outerTabs = p.joints.flatMap((j) => {
      if (j.kind !== "glue-tab") return [];
      const edge = p.edges.find((e) => e.id === j.edgeId);
      return edge?.loop === 0 ? j.polygons : [];
    });
    const tabArea = outerTabs.reduce((s, t) => s + Math.abs(signedArea(t)), 0);
    expect(signedArea(outline[0]!.points)).toBeCloseTo(signedArea(p.outline) + tabArea, 4);
    expect(selfIntersects(outline[0]!.points)).toBe(false);
    // Tabs lie outside the net.
    for (const t of tabs(p)) {
      const inner = offsetPolygon(t, 0.01).polygon;
      for (const q of inner) {
        const inHole = p.holes.some((h) => pointInPolygon(q, h));
        expect(pointInPolygon(q, p.outline) && !inHole).toBe(false);
      }
    }
    for (const path of p.paths) {
      if (path.type !== "cut") {
        expect(path.closed).toBe(false);
        expect(path.points).toHaveLength(2);
      }
    }
    expect(p.bounds.maxX - p.bounds.minX).toBeGreaterThan(0);
  }
  // Every cut edge has a connection, every connection points at real part edges.
  for (const c of r.connections) {
    for (const end of [c.a, c.b]) {
      const part = r.parts.find((p) => p.id === end.partId);
      expect(part?.edges.some((e) => e.id === end.edgeId && e.connectionId === c.id)).toBe(true);
    }
  }
}

describe("laser paper strategy", () => {
  it("unfolds a box into a single net", () => {
    const b = fx.boxBody();
    const r = build(b);
    expect(r.strategyId).toBe("laser.paper");
    expect(r.parts).toHaveLength(1);
    const net = r.parts[0]!;
    expect(net.sourceFaces.slice().sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(net.folds).toHaveLength(5);
    expect(tabs(net)).toHaveLength(7);
    expect(r.connections.filter((c) => c.joint === "fold")).toHaveLength(5);
    expect(r.connections.filter((c) => c.joint === "glue-tab")).toHaveLength(7);
    expect(net.paths.filter((p) => p.type === "fold" && p.role === "fold")).toHaveLength(5);
    expect(net.paths.filter((p) => p.type === "fold" && p.role === "glue-tab")).toHaveLength(7);
    expect(net.paths.filter((p) => p.type === "cut")).toHaveLength(1);
    for (const f of net.folds) expect(f.angle).toBeCloseTo(90, 6);
    expect(r.warnings).toEqual([]);
    expectValidNets(b, r);
  });

  it("builds trapezoid glue tabs", () => {
    const r = build(fx.boxBody(), { glueTabs: { enabled: true, width: 6, angle: 45, inset: 2 } });
    for (const t of tabs(r.parts[0]!)) {
      expect(t).toHaveLength(4);
      const base = Math.hypot(t[3]!.x - t[0]!.x, t[3]!.y - t[0]!.y);
      const top = Math.hypot(t[2]!.x - t[1]!.x, t[2]!.y - t[1]!.y);
      expect([50 - 4, 80 - 4, 100 - 4].some((l) => Math.abs(l - base) < 1e-6)).toBe(true);
      expect(top).toBeCloseTo(base - 12, 6);
      expect(Math.abs(signedArea(t))).toBeCloseTo(((base + top) / 2) * 6, 6);
    }
  });

  it("clamps tabs on short edges to triangles", () => {
    const r = build(fx.cylinderBody(24), { glueTabs: { enabled: true, width: 10, angle: 45, inset: 0 } });
    const all = r.parts.flatMap(tabs);
    expect(all.some((t) => t.length === 3)).toBe(true);
    for (const t of all) expect(Math.abs(signedArea(t))).toBeGreaterThan(0);
  });

  it("can switch glue tabs off", () => {
    const r = build(fx.boxBody(), { glueTabs: { enabled: false, width: 8, angle: 30, inset: 0 } });
    expect(tabs(r.parts[0]!)).toHaveLength(0);
    expect(r.connections.filter((c) => c.joint === "glue-tab")).toHaveLength(7);
    expect(r.parts[0]!.paths.find((p) => p.role === "outline")?.points).toEqual(r.parts[0]!.outline);
  });

  it("unfolds a hexagon prism", () => {
    const b = fx.hexBody();
    const r = build(b);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.sourceFaces).toHaveLength(8);
    expect(r.parts[0]!.folds).toHaveLength(7);
    expect(tabs(r.parts[0]!)).toHaveLength(18 - 7);
    expectValidNets(b, r);
  });

  it("unfolds concave and non-prism solids without overlaps", () => {
    for (const b of [fx.starBody(), fx.triangleBody(), fx.pyramidBody(), fx.frustumBody()]) {
      const r = build(b);
      expect(r.parts.flatMap((p) => p.sourceFaces)).toHaveLength(b.topology.faces.length);
      expectValidNets(b, r);
      const cut = b.topology.edges.length - r.parts.reduce((s, p) => s + p.folds.length, 0);
      const skipped = r.warnings.filter((w) => w.code === "overlap").length;
      expect(r.parts.flatMap(tabs).length + skipped).toBe(cut);
    }
  });

  it("unfolds curved faces as a strip with engraved score lines", () => {
    const b = fx.cylinderBody(24);
    const r = build(b);
    expect(r.parts).toHaveLength(1);
    const net = r.parts[0]!;
    expect(net.sourceFaces).toHaveLength(26);
    expect(net.paths.filter((p) => p.type === "engrave")).toHaveLength(23);
    expect(net.paths.filter((p) => p.type === "fold" && p.role === "fold")).toHaveLength(2);
    expect(r.warnings.some((w) => w.code === "curved-face")).toBe(false);
    expectValidNets(b, r);

    const flat = build(b, { foldCurvedFacets: false });
    expect(flat.parts.flatMap((p) => p.sourceFaces).sort()).toEqual([0, 1]);
    expect(flat.warnings.some((w) => w.code === "curved-face")).toBe(true);
  });

  it("splits nets that exceed the maximum size", () => {
    const b = fx.boxBody();
    const r = build(b, { maxNetSize: { width: 210, height: 150 } });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const p of r.parts) {
      const xs = p.outline.map((q) => q.x);
      const ys = p.outline.map((q) => q.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(Math.max(w, h)).toBeLessThanOrEqual(210 + 1e-6);
      expect(Math.min(w, h)).toBeLessThanOrEqual(150 + 1e-6);
    }
    expect(new Set(r.parts.map((p) => p.id)).size).toBe(r.parts.length);
    expectValidNets(b, r);
    // connections between different nets are explicit
    expect(r.connections.some((c) => c.a.partId !== c.b.partId)).toBe(true);
  });

  it("keeps face holes as cut paths", () => {
    const hole = [
      { x: 30, y: 25 },
      { x: 70, y: 25 },
      { x: 70, y: 55 },
      { x: 30, y: 55 },
    ];
    const b = fx.body(prismTopology(fx.rectangle(100, 80), 50, [hole]), "frame");
    const r = build(b);
    expect(r.parts.flatMap((p) => p.sourceFaces)).toHaveLength(10);
    expect(r.parts.reduce((s, p) => s + p.holes.length, 0)).toBe(2);
    expect(r.parts.flatMap((p) => p.paths).filter((p) => p.role === "hole")).toHaveLength(2);
    expectValidNets(b, r);
  });
});
