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
import {
  type PaperSettings,
  doublyCurvedFaces,
  goreTessellation,
  laserPaperStrategy,
  planGores,
} from "../src";
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
    const flaps = (p: FlatPart): Vec2[][] =>
      p.joints.flatMap((j) => (j.kind === "flap" ? j.polygons : []));
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
        // Tabs of 12 mm with gaps of at least 20 mm: one on the edges of 50 mm, two on
        // those of 80 mm, three on those of 100 mm.
        expect(count).toBe(c.length > 90 ? 3 : c.length > 60 ? 2 : 1);
        // By default a slit is 1.5 mm longer than its tab is wide.
        for (const slit of s[0]!.kind === "slot" ? s[0]!.polygons : []) {
          expect(Math.hypot(slit[1]!.x - slit[0]!.x, slit[1]!.y - slit[0]!.y)).toBeCloseTo(13.5, 6);
        }
      }
    });

    it("cuts tabs and flaps as part of the outline, and the slits as single cuts", () => {
      const b = fx.boxBody();
      const net = build(b, INSERT).parts[0]!;
      const outline = net.paths.filter((x) => x.role === "outline");
      expect(outline).toHaveLength(1);
      expect(selfIntersects(outline[0]!.points)).toBe(false);
      expect(flaps(net)).toHaveLength(7);
      expect(signedArea(outline[0]!.points)).toBeCloseTo(
        signedArea(net.outline) + area(insertTabs(net)) + area(flaps(net)),
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
    });

    it("hides the joint inside: slits on the edge itself, in the fold of a flap", () => {
      const b = fx.boxBody();
      const settings = {
        joint: "insert" as const,
        insertTabs: { width: 10, depth: 6, spacing: 15, flap: 9, neck: 1.2, clearance: 0.6, lock: 1 },
      };
      const r = build(b, settings);
      const net = r.parts[0]!;
      for (const c of r.connections.filter((x) => x.joint === "tab-slot")) {
        const tabEdge = net.edges.find((e) => e.id === c.a.edgeId)!;
        const slitEdge = net.edges.find((e) => e.id === c.b.edgeId)!;
        type Edge = typeof tabEdge;
        const along = (e: Edge, p: Vec2): number =>
          ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.y - e.a.y) * (e.b.y - e.a.y)) / e.length;
        /** Distance from the edge; positive = away from the face, where tabs and flaps are. */
        const out = (e: Edge, p: Vec2): number =>
          -((p.x - e.a.x) * -(e.b.y - e.a.y) + (p.y - e.a.y) * (e.b.x - e.a.x)) / e.length;
        const polygonsOf = (kind: "tab" | "slot" | "flap"): Vec2[][] =>
          net.joints.flatMap((j) => (j.kind === kind && j.connectionId === c.id ? j.polygons : []));
        const tabPolys = polygonsOf("tab");
        const slitSegs = polygonsOf("slot");
        const flap = polygonsOf("flap");

        // The flap sits on the side with the slits, along the whole edge.
        expect(flap).toHaveLength(1);
        const heights = flap[0]!.map((p) => out(slitEdge, p));
        expect(Math.min(...heights)).toBeCloseTo(0, 6);
        expect(Math.max(...heights)).toBeCloseTo(9, 6);
        const base = flap[0]!.filter((p) => Math.abs(out(slitEdge, p)) < 1e-6).map((p) => along(slitEdge, p));
        expect(Math.min(...base)).toBeCloseTo(0, 6);
        expect(Math.max(...base)).toBeCloseTo(slitEdge.length, 6);

        // Tabs and slits are at the same places along the edge of the solid. The two sides
        // run along it in opposite directions.
        const tabSpans = tabPolys
          .map((t) => {
            const foot = t.filter((p) => Math.abs(out(tabEdge, p)) < 1e-6).map((p) => along(tabEdge, p));
            return [Math.min(...foot), Math.max(...foot)] as const;
          })
          .sort((p, q) => p[0] - q[0]);
        const slitSpans = slitSegs
          .map((s) => {
            // Exactly on the edge: nothing of the joint is cut into the visible face.
            for (const p of s) expect(out(slitEdge, p)).toBeCloseTo(0, 6);
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

        // The flap stays attached: its fold line is folded wherever it is not slit, and the
        // folds and the slits together make up the edge.
        const folds = net.paths.filter(
          (x) => x.type === "fold" && x.role === "tab" && x.connectionId === c.id,
        );
        const flapFolds = folds.filter((x) => x.points.every((p) => Math.abs(out(slitEdge, p)) < 1e-6 && along(slitEdge, p) > -1e-6 && along(slitEdge, p) < slitEdge.length + 1e-6));
        const len = (pts: readonly Vec2[]): number =>
          Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        expect(flapFolds).toHaveLength(slitSegs.length + 1);
        const folded = flapFolds.reduce((sum, x) => sum + len(x.points), 0);
        const cutLength = slitSegs.reduce((sum, x) => sum + len(x), 0);
        expect(folded + cutLength).toBeCloseTo(slitEdge.length, 6);
        expect(Math.min(...flapFolds.map((x) => len(x.points)))).toBeGreaterThan(2);
        // One fold per tab, at the edge.
        expect(folds.length - flapFolds.length).toBe(tabPolys.length);

        for (const t of tabPolys) {
          // Neck 1.2 mm, tongue 6 mm; at the shoulders the tab is 12 mm wide, the slit 10.6.
          const h = t.map((p) => out(tabEdge, p));
          expect(Math.min(...h)).toBeCloseTo(0, 6);
          expect(Math.max(...h)).toBeCloseTo(7.2, 6);
          const shoulders = t
            .filter((p) => Math.abs(out(tabEdge, p) - 1.2) < 1e-6)
            .map((p) => along(tabEdge, p));
          expect(Math.max(...shoulders) - Math.min(...shoulders)).toBeCloseTo(12, 6);
        }
      }
    });

    it("keeps tabs and flaps clear of the net and of each other on any solid", () => {
      for (const b of [fx.hexBody(), fx.starBody(), fx.triangleBody(), fx.pyramidBody(), fx.frustumBody()]) {
        const r = build(b, INSERT);
        expect(r.parts.flatMap((p) => p.sourceFaces)).toHaveLength(b.topology.faces.length);
        for (const p of r.parts) {
          expect(signedArea(p.outline)).toBeCloseTo(surfaceArea(b, p.sourceFaces), 4);
          const outline = p.paths.find((x) => x.role === "outline")!;
          expect(selfIntersects(outline.points)).toBe(false);
          const all = [...insertTabs(p), ...flaps(p), ...tabs(p)];
          expect(signedArea(outline.points)).toBeCloseTo(signedArea(p.outline) + area(all), 4);
          for (const t of all) {
            for (const q of offsetPolygon(t, 0.01).polygon) {
              expect(pointInPolygon(q, p.outline)).toBe(false);
            }
          }
          expect(slits(p)).toHaveLength(insertTabs(p).length);
        }
        // Every cut edge is joined one way or the other, or reported.
        const cut = b.topology.edges.length - r.parts.reduce((s, p) => s + p.folds.length, 0);
        const joined = r.connections.filter((c) => c.joint === "tab-slot").length;
        const glued = r.parts.flatMap(tabs).length;
        const skipped = r.warnings.filter((w) => w.code === "overlap").length;
        expect(joined + glued + skipped).toBe(cut);
        expect(joined).toBeGreaterThan(0);
        expect(r.parts.flatMap(flaps)).toHaveLength(joined);
      }
    });

    it("joins the edges next to where a cap hangs on the strip, in the notch of the net", () => {
      // Octagonal prism: the caps hang on one side face each. The edges next to that fold
      // face each other across a gap of 45°, where a tab and a flap of full size collide.
      for (const n of [5, 6, 8]) {
        const b = fx.body(prismTopology(fx.regularPolygon(n, 26), 60), `prism-${n}`);
        for (const joint of ["insert", "glue"] as const) {
          const r = build(b, { joint });
          expect(r.warnings).toEqual([]);
          const net = r.parts[0]!;
          const cut = b.topology.edges.length - net.folds.length;
          const wanted = joint === "insert" ? "tab-slot" : "glue-tab";
          expect(r.connections.filter((c) => c.joint === wanted)).toHaveLength(cut);
          if (joint === "insert") {
            expect(flaps(net)).toHaveLength(cut);
            expect(slits(net)).toHaveLength(insertTabs(net).length);
            expect(insertTabs(net).length).toBeGreaterThanOrEqual(cut);
          } else {
            expect(tabs(net)).toHaveLength(cut);
          }
          const outline = net.paths.find((x) => x.role === "outline")!;
          expect(selfIntersects(outline.points)).toBe(false);
          const all = [...insertTabs(net), ...flaps(net), ...tabs(net)];
          expect(signedArea(outline.points)).toBeCloseTo(signedArea(net.outline) + area(all), 4);
          // Nothing that is added lies on a face, or on anything else that is added.
          for (let i = 0; i < all.length; i++) {
            for (const q of offsetPolygon(all[i]!, 0.01).polygon) {
              expect(pointInPolygon(q, net.outline)).toBe(false);
              for (let j = 0; j < all.length; j++) {
                if (j !== i) expect(pointInPolygon(q, all[j]!)).toBe(false);
              }
            }
          }
        }
      }
    });

    it("puts the tabs on the face that closes the model, whatever the face ids", () => {
      // The caps of a prism hang on one fold and are pressed on last: they carry the tabs,
      // which then point into the model. The side faces carry the flaps with the slits.
      const prism = prismTopology(fx.regularPolygon(8, 26), 60);
      const count = prism.faces.length;
      // The same solid with the faces numbered the other way round (caps last).
      const flipped = {
        vertices: prism.vertices,
        faces: prism.faces
          .map((f) => ({ ...f, id: count - 1 - f.id, sourceFace: count - 1 - f.sourceFace }))
          .sort((p, q) => p.id - q.id),
        edges: prism.edges.map((e) => ({ ...e, faces: e.faces.map((f) => count - 1 - f) })),
      };
      for (const [topology, caps] of [
        [prism, [0, 1]],
        [flipped, [count - 1, count - 2]],
      ] as const) {
        const b = fx.body(topology, "prism");
        const r = build(b, INSERT);
        const net = r.parts[0]!;
        const joined = r.connections.filter((c) => c.joint === "tab-slot");
        expect(joined).toHaveLength(15);
        for (const cap of caps) {
          const mine = joined.filter((c) =>
            topology.edges.find((e) => e.id === c.sourceEdge)!.faces.includes(cap),
          );
          expect(mine).toHaveLength(7);
          // The edges that carry the tabs go round the octagon: each turns by 45° from the
          // one before. (The edges of the side faces lie in one line.)
          const edges = mine
            .map((c) => net.edges.find((e) => e.id === c.a.edgeId)!)
            .sort((p, q) => p.index - q.index);
          for (let i = 0; i + 1 < edges.length; i++) {
            const [p, q] = [edges[i]!, edges[i + 1]!];
            expect(Math.hypot(p.b.x - q.a.x, p.b.y - q.a.y)).toBeLessThan(1e-6);
            const turn = Math.atan2(
              (p.b.x - p.a.x) * (q.b.y - q.a.y) - (p.b.y - p.a.y) * (q.b.x - q.a.x),
              (p.b.x - p.a.x) * (q.b.x - q.a.x) + (p.b.y - p.a.y) * (q.b.y - q.a.y),
            );
            expect((turn * 180) / Math.PI).toBeCloseTo(45, 6);
          }
          for (const c of mine) expect(c.a.role).toBe("tab");
        }
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
      expect(glue.parts[0]!.joints.some((j) => j.kind !== "glue-tab")).toBe(false);
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

  describe("faces that paper cannot follow", () => {
    /** A surface of revolution about Z through the given (radius, height) rows, facetted. */
    const revolved = (
      rows: [number, number][],
      segments: number,
      id: string,
      /** B-Rep face of the facets above every row; one face for all when left out. */
      sources: number[] = [],
    ): CadBody => {
      const vertices = rows.flatMap(([radius, z]) =>
        radius === 0
          ? [{ x: 0, y: 0, z }]
          : Array.from({ length: segments }, (_, i) => ({
              x: radius * Math.cos((2 * Math.PI * i) / segments),
              y: radius * Math.sin((2 * Math.PI * i) / segments),
              z,
            })),
      );
      const start: number[] = [];
      let at = 0;
      for (const [radius] of rows) {
        start.push(at);
        at += radius === 0 ? 1 : segments;
      }
      const v = (row: number, i: number): number =>
        rows[row]![0] === 0 ? start[row]! : start[row]! + (i % segments);
      const loops: number[][] = [];
      const sourceOfLoop: number[] = [];
      const closedBelow = rows[0]![0] === 0;
      // Bottom disc, seen from below.
      if (!closedBelow) loops.push(Array.from({ length: segments }, (_, i) => v(0, segments - 1 - i)));
      for (let row = 0; row + 1 < rows.length; row++) {
        for (let i = 0; i < segments; i++) {
          const quad = [v(row, i), v(row, i + 1), v(row + 1, i + 1), v(row + 1, i)];
          loops.push(quad.filter((x, k) => quad.indexOf(x) === k));
          sourceOfLoop[loops.length - 1] = sources[row] ?? 1;
        }
      }
      const last = rows.length - 1;
      if (rows[last]![0] !== 0) loops.push(Array.from({ length: segments }, (_, i) => v(last, i)));
      const topology = fx.topologyFromLoops(vertices, loops);
      for (const face of topology.faces) {
        const flat =
          (!closedBelow && face.id === 0) ||
          (rows[last]![0] !== 0 && face.id === loops.length - 1);
        if (flat) continue;
        face.surface = "curved";
        face.sourceFace = sourceOfLoop[face.id] ?? 1;
      }
      return fx.body(topology, id);
    };

    it("unfolds cylinders and cones: they are rolled from a flat sheet", () => {
      const cylinder = fx.cylinderBody(24);
      expect(doublyCurvedFaces(cylinder.topology)).toEqual([]);
      // A cone: every facet meets the others at the tip, and nowhere else inside the face.
      const cone = revolved(
        [
          [30, 0],
          [0, 50],
        ],
        24,
        "cone",
      );
      expect(doublyCurvedFaces(cone.topology)).toEqual([]);
      // A cone without its tip, in several rows of facets.
      const frustum = revolved(
        [
          [30, 0],
          [25, 10],
          [20, 20],
          [15, 30],
        ],
        24,
        "frustum",
      );
      expect(doublyCurvedFaces(frustum.topology)).toEqual([]);
      for (const b of [cylinder, cone, frustum]) {
        const r = build(b);
        expect(r.classification).toEqual({ kind: "net", label: "Unfolded Net", supported: true });
        expect(r.parts.flatMap((p) => p.sourceFaces)).toHaveLength(b.topology.faces.length);
        expect(r.warnings.some((w) => w.severity === "error")).toBe(false);
      }
    });

    it("stops at a dome, and at a cylinder with a rounded edge", () => {
      const quarter = (k: number, n: number, radius: number, z0: number): [number, number] => [
        // Exactly on the axis at the end of the quarter.
        k === n ? 0 : radius * Math.cos((Math.PI / 2) * (k / n)),
        z0 + radius * Math.sin((Math.PI / 2) * (k / n)),
      ];
      const dome = revolved(
        Array.from({ length: 7 }, (_, k) => quarter(k, 6, 30, 0)),
        24,
        "dome",
      );
      // Wall of 20 mm, then the edge rounded with a radius of 10 mm, then the flat top.
      const rounded = revolved(
        [
          [30, 0],
          ...Array.from({ length: 5 }, (_, k): [number, number] => [
            20 + 10 * Math.cos((Math.PI / 2) * (k / 4)),
            20 + 10 * Math.sin((Math.PI / 2) * (k / 4)),
          ]),
        ],
        32,
        "rounded",
      );
      for (const b of [dome, rounded]) {
        const found = doublyCurvedFaces(b.topology);
        expect(found).toHaveLength(1);
        expect(found[0]!.sourceFace).toBe(1);
        expect(found[0]!.vertices).toBeGreaterThan(24);
        for (const joint of ["glue", "insert"] as const) {
          const r = build(b, { joint });
          expect(r.parts).toEqual([]);
          expect(r.connections).toEqual([]);
          expect(r.classification).toMatchObject({ kind: "unsupported", supported: false });
          expect(r.classification?.reason).toMatch(/curved in two directions/);
          const errors = r.warnings.filter((w) => w.code === "unsupported-paper-shape");
          expect(errors).toHaveLength(1);
          expect(errors[0]!.severity).toBe("error");
          expect(errors[0]!.message).toMatch(/flat faces, cylinders and cones/);
          expect(errors[0]!.position).toBeDefined();
        }
      }
      // The whole sphere has a total defect of 720°: the dome is half of it.
      expect(doublyCurvedFaces(dome.topology)[0]!.defect).toBeGreaterThan(300);
      expect(doublyCurvedFaces(dome.topology)[0]!.defect).toBeLessThan(360);
    });

    it("still cuts the flat faces when curved facets are not unfolded", () => {
      const rows: [number, number][] = [
        [30, 0],
        [30, 20],
        [28, 26],
        [24, 29],
        [20, 30],
      ];
      const b = revolved(rows, 24, "rounded");
      expect(build(b).parts).toEqual([]);
      const flat = build(b, { foldCurvedFacets: false });
      expect(flat.classification?.supported).toBe(true);
      expect(flat.parts).toHaveLength(2);
      expect(flat.warnings.some((w) => w.code === "curved-face")).toBe(true);
    });

    describe("gores", () => {
      const quarter = (k: number, n: number, radius: number, z0: number): [number, number] => [
        // Exactly on the axis at the end of the quarter.
        k === n ? 0 : radius * Math.cos((Math.PI / 2) * (k / n)),
        z0 + radius * Math.sin((Math.PI / 2) * (k / n)),
      ];
      const GORES: Partial<PaperSettings> = { doublyCurved: "gores" };
      /** Wall of 20 mm, the edge rounded with a radius of 10 mm, flat top. 12 facets round. */
      const rounded = (): CadBody =>
        revolved(
          [
            [30, 0],
            ...Array.from({ length: 5 }, (_, k): [number, number] => {
              const [r, z] = quarter(k, 4, 10, 20);
              return [20 + r, z];
            }),
          ],
          12,
          "rounded",
          // The wall is a face of its own, as the kernel has it.
          [2, 1, 1, 1, 1],
        );
      const dome = (): CadBody =>
        revolved(
          Array.from({ length: 7 }, (_, k) => quarter(k, 6, 30, 0)),
          12,
          "dome",
        );
      const sphere = (): CadBody =>
        revolved(
          Array.from({ length: 9 }, (_, k): [number, number] => [
            k === 0 || k === 8 ? 0 : 30 * Math.sin((Math.PI * k) / 8),
            -30 * Math.cos((Math.PI * k) / 8),
          ]),
          12,
          "sphere",
        );
      const added = (p: FlatPart): Vec2[][] =>
        p.joints.flatMap((j) => (j.kind === "slot" || j.kind === "finger" ? [] : j.polygons));

      /** What holds for the parts of every body made with gores. */
      const expectSound = (b: CadBody, r: FabricationResult): void => {
        expect(r.classification).toMatchObject({ kind: "gores", supported: true });
        expect(r.warnings.some((w) => w.severity === "error")).toBe(false);
        const faces = r.parts.flatMap((p) => p.sourceFaces).sort((x, y) => x - y);
        expect(faces).toEqual(b.topology.faces.map((f) => f.id));
        for (const p of r.parts) {
          // The facets lie flat, side by side: the outline encloses exactly their area.
          expect(signedArea(p.outline)).toBeCloseTo(surfaceArea(b, p.sourceFaces), 4);
          expect(selfIntersects(p.outline)).toBe(false);
          expect(p.folds).toHaveLength(p.sourceFaces.length - 1);
          const outline = p.paths.find((x) => x.role === "outline")!;
          expect(selfIntersects(outline.points)).toBe(false);
          const tabArea = added(p).reduce((sum, t) => sum + Math.abs(signedArea(t)), 0);
          expect(signedArea(outline.points)).toBeCloseTo(signedArea(p.outline) + tabArea, 4);
        }
        for (const c of r.connections) {
          for (const end of [c.a, c.b]) {
            const part = r.parts.find((p) => p.id === end.partId);
            expect(part?.edges.some((e) => e.id === end.edgeId)).toBe(true);
          }
        }
      };

      it("plans one gore per facet of the boundary, in levels from there", () => {
        const b = rounded();
        const plan = planGores(b.topology, doublyCurvedFaces(b.topology));
        expect(plan.gores).toBe(12);
        // Four rows of twelve facets.
        expect(plan.levels.size).toBe(48);
        for (let level = 0; level < 4; level++) {
          expect([...plan.levels.values()].filter((l) => l === level)).toHaveLength(12);
        }
        // Between the gores: twelve seams of four edges. Of the rim, every gore gives up one
        // end: six at the wall, six at the top.
        const inside = [...plan.cuts].filter((id) =>
          b.topology.edges[id]!.faces.every((f) => plan.levels.has(f)),
        );
        expect(inside).toHaveLength(48);
        expect(plan.cuts.size - inside.length).toBe(12);
      });

      it("makes a rounded edge from gores: half of them on the wall, half around the top", () => {
        const b = rounded();
        expect(build(b).parts).toEqual([]);
        for (const joint of ["glue", "insert"] as const) {
          const r = build(b, { ...GORES, joint });
          expect(r.classification?.label).toBe("Gores (12, approximation)");
          expectSound(b, r);
          expect(r.parts).toHaveLength(2);
          // Bottom, wall and six gores; top and six gores. A gore has four facets.
          expect(r.parts.map((p) => p.sourceFaces.length).sort((x, y) => x - y)).toEqual([
            1 + 6 * 4,
            1 + 12 + 6 * 4,
          ]);
          // Every seam is joined: between the gores there is room for the tabs.
          expect(r.warnings.filter((w) => w.code === "overlap")).toEqual([]);
          const cut = b.topology.edges.length - r.parts.reduce((n, p) => n + p.folds.length, 0);
          expect(r.connections.filter((c) => c.joint !== "fold")).toHaveLength(cut);
          const note = r.warnings.find((w) => w.code === "curved-face");
          expect(note?.severity).toBe("info");
          expect(note?.message).toMatch(/12 gores/);
        }
      });

      it("keeps the folds of a gore in one line: a strip, not a patch", () => {
        const b = rounded();
        const r = build(b, GORES);
        const plan = planGores(b.topology, doublyCurvedFaces(b.topology));
        // Inside the rounded face, a fold joins a facet to the next level, never to its
        // neighbour in the same row.
        for (const c of r.connections.filter((x) => x.joint === "fold")) {
          const faces = b.topology.edges.find((e) => e.id === c.sourceEdge)!.faces;
          if (!faces.every((f) => plan.levels.has(f))) continue;
          const [l0, l1] = faces.map((f) => plan.levels.get(f)!);
          expect(Math.abs(l0! - l1!)).toBe(1);
        }
      });

      it("makes a dome: every second gore stands on the rim, the others are parts of their own", () => {
        const b = dome();
        const r = build(b, GORES);
        expectSound(b, r);
        // The bottom with six gores, and six single gores.
        const sizes = r.parts.map((p) => p.sourceFaces.length).sort((x, y) => x - y);
        expect(sizes).toEqual([6, 6, 6, 6, 6, 6, 1 + 6 * 6]);
        expect(r.warnings.filter((w) => w.code === "overlap")).toEqual([]);
      });

      it("makes a sphere: gores joined at the equator", () => {
        const b = sphere();
        const found = doublyCurvedFaces(b.topology);
        expect(found).toHaveLength(1);
        // The angular defects of a closed surface add up to 720°.
        expect(found[0]!.defect).toBeCloseTo(720, 6);
        const r = build(b, GORES);
        expectSound(b, r);
        expect(r.parts).toHaveLength(1);
        expect(r.parts[0]!.sourceFaces).toHaveLength(12 * 8);
        // Joined side by side at one row of facets, the gores open like a fan.
        const folds = r.connections.filter((c) => c.joint === "fold");
        expect(folds).toHaveLength(12 * 8 - 1);
      });

      it("leaves bodies without such faces as they are", () => {
        for (const b of [fx.boxBody(), fx.cylinderBody(24), fx.hexBody()]) {
          const plain = build(b);
          const withGores = build(b, GORES);
          expect(withGores).toEqual(plain);
          expect(withGores.classification?.kind).toBe("net");
        }
      });

      it("asks for as many facets as there are gores, whatever the size of the body", () => {
        expect(goreTessellation(12, 100)).toEqual({ tolerance: 15, angularTolerance: Math.PI / 3 });
        expect(goreTessellation(24, 10).angularTolerance).toBeCloseTo(Math.PI / 6, 12);
        expect(goreTessellation(24, 10).tolerance).toBeCloseTo(1.5, 12);
        // Out of range, or no size: something usable all the same.
        expect(goreTessellation(1, 100).angularTolerance).toBeCloseTo((4 * Math.PI) / 6, 12);
        expect(goreTessellation(1000, 100).angularTolerance).toBeCloseTo((4 * Math.PI) / 72, 12);
        expect(goreTessellation(Number.NaN, Number.NaN)).toEqual({
          tolerance: 15,
          angularTolerance: Math.PI / 3,
        });
      });
    });
  });
});