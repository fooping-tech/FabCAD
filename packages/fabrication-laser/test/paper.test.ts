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

  describe("insert joint: tabs and slits", () => {
    const INSERT: Partial<PaperSettings> = { joint: "insert" };
    const insertTabs = (p: FlatPart): Vec2[][] =>
      p.joints.flatMap((j) => (j.kind === "tab" ? j.polygons : []));
    const slits = (p: FlatPart) => p.paths.filter((x) => x.role === "slot");
    const area = (polys: Vec2[][]): number => polys.reduce((s, t) => s + Math.abs(signedArea(t)), 0);

    it("joins the cut edges of a box without glue", () => {
      const b = fx.boxBody();
      const r = build(b, INSERT);
      expect(r.parts).toHaveLength(1);
      const net = r.parts[0]!;
      expect(net.folds).toHaveLength(5);
      const joined = r.connections.filter((c) => c.joint === "tab-slot");
      expect(joined).toHaveLength(7);
      expect(r.connections.filter((c) => c.joint === "glue-tab")).toHaveLength(0);
      expect(tabs(net)).toHaveLength(0);
      expect(r.warnings).toEqual([]);
      for (const c of joined) {
        expect(c.a.role).toBe("tab");
        expect(c.b.role).toBe("slot");
        // As many slits as tabs, connection by connection.
        const t = net.joints.filter((j) => j.kind === "tab" && j.connectionId === c.id);
        const s = net.joints.filter((j) => j.kind === "slot" && j.connectionId === c.id);
        expect(t).toHaveLength(1);
        expect(s).toHaveLength(1);
        const count = t[0]!.kind === "tab" ? t[0]!.polygons.length : 0;
        expect(count).toBeGreaterThan(0);
        expect(s[0]!.kind === "slot" ? s[0]!.polygons.length : 0).toBe(count);
        // Tabs of 12 mm with gaps of at least 20 mm: two on the edges of 50 and 80 mm,
        // three on the edges of 100 mm.
        expect(count).toBe(c.length > 90 ? 3 : 2);
      }
    });

    it("cuts the tabs as part of the outline and the slits as single cuts", () => {
      const b = fx.boxBody();
      const net = build(b, INSERT).parts[0]!;
      const outline = net.paths.filter((x) => x.role === "outline");
      expect(outline).toHaveLength(1);
      expect(selfIntersects(outline[0]!.points)).toBe(false);
      expect(signedArea(outline[0]!.points)).toBeCloseTo(
        signedArea(net.outline) + area(insertTabs(net)),
        4,
      );
      // The part itself is the unfolded solid, whatever the joint.
      expect(signedArea(net.outline)).toBeCloseTo(surfaceArea(b, net.sourceFaces), 4);
      for (const s of slits(net)) {
        expect(s.type).toBe("cut");
        expect(s.closed).toBe(false);
        expect(s.points).toHaveLength(2);
      }
      expect(slits(net)).toHaveLength(insertTabs(net).length);
      // Two fold lines per tab: at the edge and at the slit.
      const folds = net.paths.filter((x) => x.type === "fold" && x.role === "tab");
      expect(folds).toHaveLength(2 * insertTabs(net).length);
    });

    it("puts every slit inside the net, at its offset from the edge, where its tab arrives", () => {
      const b = fx.boxBody();
      const settings = {
        joint: "insert" as const,
        insertTabs: { width: 10, depth: 6, spacing: 15, slitOffset: 2, clearance: 0.6, lock: 1 },
      };
      const r = build(b, settings);
      const net = r.parts[0]!;
      for (const c of r.connections.filter((x) => x.joint === "tab-slot")) {
        const tabEdge = net.edges.find((e) => e.id === c.a.edgeId)!;
        const slitEdge = net.edges.find((e) => e.id === c.b.edgeId)!;
        const along = (e: typeof tabEdge, p: Vec2): number =>
          ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.y - e.a.y) * (e.b.y - e.a.y)) / e.length;
        const off = (e: typeof tabEdge, p: Vec2): number =>
          ((p.x - e.a.x) * -(e.b.y - e.a.y) + (p.y - e.a.y) * (e.b.x - e.a.x)) / e.length;
        const tabJoint = net.joints.find((j) => j.kind === "tab" && j.connectionId === c.id)!;
        const slotJoint = net.joints.find((j) => j.kind === "slot" && j.connectionId === c.id)!;
        const tabPolys = tabJoint.kind === "tab" ? tabJoint.polygons : [];
        const slitSegs = slotJoint.kind === "slot" ? slotJoint.polygons : [];
        // Where the tabs pass the slit, measured from the start of the edge of the solid. The
        // two sides run along the edge in opposite directions.
        const tabSpans = tabPolys
          .map((t) => {
            const foot = t.filter((p) => Math.abs(off(tabEdge, p)) < 1e-6).map((p) => along(tabEdge, p));
            return [Math.min(...foot), Math.max(...foot)] as const;
          })
          .sort((p, q) => p[0] - q[0]);
        const slitSpans = slitSegs
          .map((s) => {
            for (const p of s) {
              // Left of travel is the material: the slit is inside the face.
              expect(off(slitEdge, p)).toBeCloseTo(2, 6);
              expect(pointInPolygon(p, net.outline)).toBe(true);
            }
            const at = s.map((p) => slitEdge.length - along(slitEdge, p));
            return [Math.min(...at), Math.max(...at)] as const;
          })
          .sort((p, q) => p[0] - q[0]);
        expect(slitSpans).toHaveLength(tabSpans.length);
        tabSpans.forEach(([t0, t1], i) => {
          expect(t1 - t0).toBeCloseTo(10, 6);
          expect(slitSpans[i]![0]).toBeCloseTo(t0 - 0.3, 6);
          expect(slitSpans[i]![1]).toBeCloseTo(t1 + 0.3, 6);
        });
        for (const t of tabPolys) {
          // Neck 2 mm, tongue 6 mm; the shoulders are 1 mm wider than the tab on each side,
          // which is more than the slit gives.
          const heights = t.map((p) => -off(tabEdge, p));
          expect(Math.max(...heights)).toBeCloseTo(8, 6);
          const shoulders = t.filter((p) => Math.abs(-off(tabEdge, p) - 2) < 1e-6).map((p) => along(tabEdge, p));
          expect(Math.max(...shoulders) - Math.min(...shoulders)).toBeCloseTo(12, 6);
          expect(12).toBeGreaterThan(10 + 0.6);
        }
      }
    });

    it("keeps tabs clear of the net and of each other on any solid", () => {
      for (const b of [fx.hexBody(), fx.starBody(), fx.triangleBody(), fx.pyramidBody(), fx.frustumBody()]) {
        const r = build(b, INSERT);
        expect(r.parts.flatMap((p) => p.sourceFaces)).toHaveLength(b.topology.faces.length);
        for (const p of r.parts) {
          expect(signedArea(p.outline)).toBeCloseTo(surfaceArea(b, p.sourceFaces), 4);
          const outline = p.paths.find((x) => x.role === "outline")!;
          expect(selfIntersects(outline.points)).toBe(false);
          const all = [...insertTabs(p), ...tabs(p)];
          expect(signedArea(outline.points)).toBeCloseTo(signedArea(p.outline) + area(all), 4);
          for (const t of all) {
            for (const q of offsetPolygon(t, 0.01).polygon) {
              expect(pointInPolygon(q, p.outline)).toBe(false);
            }
          }
          const cuts = slits(p);
          for (let i = 0; i < cuts.length; i++) {
            for (let j = i + 1; j < cuts.length; j++) {
              const [a, c] = [cuts[i]!.points, cuts[j]!.points];
              expect(segmentsIntersect(a[0]!, a[1]!, c[0]!, c[1]!, 1e-7)).toBe(false);
            }
          }
        }
        // Every cut edge is joined one way or the other, or reported.
        const cut = b.topology.edges.length - r.parts.reduce((s, p) => s + p.folds.length, 0);
        const joined = r.connections.filter((c) => c.joint === "tab-slot").length;
        const glued = r.parts.flatMap(tabs).length;
        const skipped = r.warnings.filter((w) => w.code === "overlap").length;
        expect(joined + glued + skipped).toBe(cut);
        expect(joined).toBeGreaterThan(0);
      }
    });

    it("falls back to a glue tab where an edge is too short, and says so", () => {
      const b = fx.cylinderBody(24);
      const r = build(b, INSERT);
      // The facets are 7.8 mm wide: too short for a tab with its shoulders.
      const short = r.connections.filter((c) => c.joint !== "fold" && c.length < 8);
      expect(short.length).toBeGreaterThan(0);
      for (const c of short) expect(c.joint).toBe("glue-tab");
      const notes = r.warnings.filter((w) => w.code === "joint-fallback");
      expect(notes.length).toBe(short.length);
      expect(notes[0]!.severity).toBe("info");
      expect(notes[0]!.message).toMatch(/glue tab is used instead/);
      // The seam of the strip is long enough.
      expect(r.connections.some((c) => c.joint === "tab-slot")).toBe(true);

      const bare = build(b, { joint: "insert", glueTabs: { enabled: false, width: 8, angle: 30, inset: 0 } });
      expect(bare.parts.flatMap(tabs)).toHaveLength(0);
      expect(bare.warnings.some((w) => /left without a joint/.test(w.message))).toBe(true);
    });

    it("does not change the glue joint", () => {
      const glue = build(fx.boxBody());
      const explicit = build(fx.boxBody(), { joint: "glue" });
      expect(explicit).toEqual(glue);
      expect(glue.parts[0]!.paths.some((p) => p.role === "slot" || p.role === "tab")).toBe(false);
    });

    it("leaves slits alone when the kerf is compensated", () => {
      const material = { ...fx.PAPER, kerf: 0.2 };
      const plain = fabricate(fx.boxBody(), material, laserPaperStrategy, INSERT);
      const comp = fabricate(fx.boxBody(), material, laserPaperStrategy, {
        ...INSERT,
        kerfCompensation: true,
      });
      expect(slits(comp.parts[0]!).map((s) => s.points)).toEqual(
        slits(plain.parts[0]!).map((s) => s.points),
      );
    });
  });
});
