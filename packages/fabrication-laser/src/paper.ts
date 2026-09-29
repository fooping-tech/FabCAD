import {
  type Plane3,
  type TopoEdge,
  type TopoFace,
  type Vec2,
  type Vec3,
  boundsOfPoints,
  buildEdgeLookup,
  degToRad,
  dist2,
  edgeInteriorAngle,
  faceLoops2D,
  facePlane,
  lerp3,
  norm2,
  offsetPolygon,
  perp2,
  polygonsOverlap,
  radToDeg,
  signedArea,
  sub2,
  topoEdgeKey,
} from "@fabcad/geometry";
import {
  type CadBody,
  type EdgeConnection,
  type FabricationResult,
  type FabricationStrategy,
  type FabricationWarning,
  type FlatPart,
  type FlatPath,
  type JointFeature,
  type MaterialProfile,
  type PartEdge,
  type StrategySettings,
  analyzeBody,
  compensateKerf,
  dedupeWarnings,
} from "@fabcad/fabrication-core";
import { boundsOfPaths, closeLoop, pushPoint } from "./shared";

/**
 * Laser paper strategy:
 *
 *   Solid → Unfold → Connected Net → Fold Lines → Joints of the cut edges
 *
 * Generic for any polyhedral topology. Paper has (nearly) no thickness, so there is no
 * thickness compensation.
 *
 * The cut edges of the net are joined in one of two ways:
 *
 * - "glue": one side carries a glue tab that is glued behind the other side;
 * - "insert": one side carries tabs, the other side a flap with slits, so the model holds
 *   together without glue. Everything ends up inside the model: the flap is folded inwards
 *   and lies behind the face that carries the tabs, the slits are cut into the fold line of
 *   the flap (they lie exactly on the edge of the solid), and the tabs are folded inwards and
 *   pushed through the slits. A tab is wider than its slit at the shoulders and locks behind
 *   it. From outside, only the two faces meeting at the edge are seen.
 */
export type PaperJoint = "glue" | "insert";

export interface InsertTabSettings {
  /** Width of a tab where it passes the slit, along the edge (mm). Default 12. */
  width: number;
  /** Length of the tongue behind the slit (mm). Default 8. */
  depth: number;
  /** Smallest gap between two tabs of one edge (mm); long edges get several tabs. Default 20. */
  spacing: number;
  /**
   * Height of the flap that carries the slits and lies behind the other face (mm).
   * Default 8. Its sides are tapered like those of a glue tab.
   */
  flap: number;
  /** Length of the tab between the edge and its shoulders: what passes the slit (mm). Default 1. */
  neck: number;
  /** How much longer the slit is than the tab is wide (mm). Default 0.4. */
  clearance: number;
  /** How far the shoulders of the tongue stick out on each side (mm); 0 = no lock. Default 1.5. */
  lock: number;
}

export interface PaperSettings extends StrategySettings {
  /** How the cut edges are joined. Default "glue". */
  joint: PaperJoint;
  /**
   * Tabs and slits of the "insert" joint. Edges too short for a tab get a glue tab instead
   * (when glue tabs are enabled).
   */
  insertTabs: InsertTabSettings;
  glueTabs: {
    /** Generate glue tabs on cut edges. Default true. */
    enabled: boolean;
    /** Height of a tab, measured perpendicular to its edge (mm). Default 8. */
    width: number;
    /**
     * Taper of the two slanted tab sides in degrees, measured from the perpendicular of the
     * edge: 0 = rectangular tab, 45 = sides at 45°. Default 30. On short edges the taper is
     * clamped so that the tab is a triangle at most.
     */
    angle: number;
    /** Distance of the tab ends from the ends of the edge (mm). Default 0. */
    inset: number;
  };
  /** Nets are split so that each fits into this box (in either orientation). */
  maxNetSize?: { width: number; height: number };
  /**
   * true (default): facets of curved faces are unfolded as a strip, with light `engrave`
   * score lines between them instead of `fold` lines.
   * false: facets of curved faces are left out and reported with a `curved-face` warning.
   */
  foldCurvedFacets: boolean;
  /** Apply kerf compensation to the cut paths. Default false. */
  kerfCompensation: boolean;
}

export function defaultPaperSettings(_material?: MaterialProfile): PaperSettings {
  return {
    joint: "glue",
    insertTabs: { width: 12, depth: 8, spacing: 20, flap: 8, neck: 1, clearance: 0.4, lock: 1.5 },
    glueTabs: { enabled: true, width: 8, angle: 30, inset: 0 },
    foldCurvedFacets: true,
    kerfCompensation: false,
  };
}

/** Tolerance (mm) by which polygons are shrunk before overlap tests, so touching is allowed. */
const TOUCH = 1e-3;

interface NetFace {
  face: TopoFace;
  net: number;
  /** Loops in net coordinates (outer loop counter-clockwise, seen from outside the solid). */
  loops: Vec2[][];
  /** Outer loop, slightly shrunk, for overlap tests. */
  test: Vec2[];
  /** Per outer-loop edge: the face on the other side of a fold. */
  folds: (undefined | { other: NetFace; index: number; edge: TopoEdge })[];
}

interface Candidate {
  from: NetFace;
  fromIndex: number;
  to: TopoFace;
  edge: TopoEdge;
  length: number;
}

interface BoundaryEdge {
  owner: NetFace;
  loop: number;
  index: number;
  a: Vec2;
  b: Vec2;
  edge?: TopoEdge;
  partEdge: number;
  tab?: Vec2[];
  /** Tabs that go through slits of the other side, with the fold lines across each. */
  inserts?: { polygon: Vec2[]; folds: [Vec2, Vec2][] }[];
  /** Flap with the slits for the tabs of the other side: slits and folds share its base line. */
  flap?: { polygon: Vec2[]; slits: [Vec2, Vec2][]; folds: [Vec2, Vec2][] };
  connectionId?: string;
}

/** The narrowest insert tab worth cutting (mm). */
const MIN_INSERT_WIDTH = 4;
/** Paper left between a slit, or the shoulder of a tab, and the end of the edge (mm). */
const INSERT_MARGIN = 1;

interface Net {
  id: number;
  partId: string;
  faces: NetFace[];
  rootPlane: Plane3;
  tabs: Vec2[][];
}

function shrink(poly: readonly Vec2[]): Vec2[] {
  if (poly.length < 3) return poly.slice();
  const result = offsetPolygon(poly, TOUCH);
  return result.collapsedEdges.length > 0 ? poly.slice() : result.polygon;
}

function fabricatePaper(
  body: CadBody,
  material: MaterialProfile,
  input: PaperSettings,
): FabricationResult {
  const defaults = defaultPaperSettings(material);
  const settings: PaperSettings = {
    ...defaults,
    ...input,
    glueTabs: { ...defaults.glueTabs, ...(input.glueTabs ?? {}) },
    insertTabs: { ...defaults.insertTabs, ...(input.insertTabs ?? {}) },
  };
  const { topology } = body;
  const warnings: FabricationWarning[] = analyzeBody(body).warnings.filter(
    (w) => w.code !== "curved-face" || !settings.foldCurvedFacets,
  );
  const lookup = buildEdgeLookup(topology);
  const midpoint = (edge: TopoEdge): Vec3 =>
    lerp3(topology.vertices[edge.a]!, topology.vertices[edge.b]!, 0.5);

  // 1. Faces taking part, with their own 2D polygons.
  const included = topology.faces.filter(
    (f) =>
      (f.loops[0]?.length ?? 0) >= 3 && (f.surface === "plane" || settings.foldCurvedFacets),
  );
  const includedIds = new Set(included.map((f) => f.id));
  const own = new Map<number, { plane: Plane3; loops: Vec2[][]; area: number }>();
  for (const face of included) {
    const plane = facePlane(topology, face);
    const loops = faceLoops2D(topology, face, plane);
    own.set(face.id, { plane, loops, area: loops.reduce((s, l) => s + signedArea(l), 0) });
  }
  const edgeAt = (face: TopoFace, loop: number, index: number): TopoEdge | undefined => {
    const ids = face.loops[loop]!;
    return lookup.get(topoEdgeKey(ids[index]!, ids[(index + 1) % ids.length]!));
  };
  /** Index of `edge` in the outer loop of `face`, or -1. Folds only cross outer loops. */
  const outerIndexOf = (face: TopoFace, edge: TopoEdge): number => {
    const ids = face.loops[0]!;
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!;
      const b = ids[(i + 1) % ids.length]!;
      if ((a === edge.a && b === edge.b) || (a === edge.b && b === edge.a)) return i;
    }
    return -1;
  };

  // 2. Spanning forest by unfolding.
  const placed = new Map<number, NetFace>();
  const nets: Net[] = [];
  const fitsMax = (points: readonly Vec2[]): boolean => {
    const max = settings.maxNetSize;
    if (!max) return true;
    const b = boundsOfPoints(points);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return (w <= max.width + 1e-9 && h <= max.height + 1e-9) ||
      (h <= max.width + 1e-9 && w <= max.height + 1e-9);
  };

  const remaining = (): TopoFace[] => included.filter((f) => !placed.has(f.id));
  while (remaining().length > 0) {
    // Start every net from the largest face that is still free (ties: lower face id).
    const root = remaining().sort(
      (a, b) => own.get(b.id)!.area - own.get(a.id)!.area || a.id - b.id,
    )[0]!;
    const rootOwn = own.get(root.id)!;
    const net: Net = {
      id: nets.length,
      partId: `${body.id}.net-${nets.length}`,
      faces: [],
      rootPlane: rootOwn.plane,
      tabs: [],
    };
    nets.push(net);
    const frontier: Candidate[] = [];
    const addFace = (nf: NetFace): void => {
      net.faces.push(nf);
      placed.set(nf.face.id, nf);
      const ids = nf.face.loops[0]!;
      for (let i = 0; i < ids.length; i++) {
        const edge = edgeAt(nf.face, 0, i);
        if (!edge || edge.faces.length !== 2) continue;
        const otherId = edge.faces[0] === nf.face.id ? edge.faces[1]! : edge.faces[0]!;
        if (otherId === nf.face.id || !includedIds.has(otherId) || placed.has(otherId)) continue;
        const other = topology.faces[otherId];
        if (!other || outerIndexOf(other, edge) < 0) continue;
        const loop = nf.loops[0]!;
        frontier.push({
          from: nf,
          fromIndex: i,
          to: other,
          edge,
          length: dist2(loop[i]!, loop[(i + 1) % loop.length]!),
        });
      }
    };
    const rootLoops = rootOwn.loops.map((l) => l.map((p) => ({ x: p.x, y: p.y })));
    addFace({
      face: root,
      net: net.id,
      loops: rootLoops,
      test: shrink(rootLoops[0]!),
      folds: rootLoops[0]!.map(() => undefined),
    });
    if (!fitsMax(rootLoops[0]!)) {
      warnings.push({
        code: "part-too-large",
        severity: "warning",
        message: `A single face of "${body.name}" is larger than the maximum net size.`,
        partId: net.partId,
      });
    }

    while (frontier.length > 0) {
      // Priority: smooth edges first (strips of curved facets stay together), then longer
      // shared edges, then lower ids for determinism.
      let best = 0;
      for (let i = 1; i < frontier.length; i++) {
        const c = frontier[i]!;
        const b = frontier[best]!;
        const order =
          Number(b.edge.smooth) - Number(c.edge.smooth) ||
          (Math.abs(b.length - c.length) > 1e-9 ? b.length - c.length : 0) ||
          c.to.id - b.to.id ||
          c.from.face.id - b.from.face.id;
        // order > 0: the current best wins; order < 0: the candidate is better.
        if (order < 0) best = i;
      }
      const cand = frontier.splice(best, 1)[0]!;
      if (placed.has(cand.to.id)) continue;
      const unfolded = unfold(cand);
      if (!unfolded) continue;
      const test = shrink(unfolded.loops[0]!);
      if (net.faces.some((f) => polygonsOverlap(test, f.test))) continue;
      if (settings.maxNetSize) {
        const all = net.faces.flatMap((f) => f.loops[0]!).concat(unfolded.loops[0]!);
        if (!fitsMax(all)) continue;
      }
      const nf: NetFace = {
        face: cand.to,
        net: net.id,
        loops: unfolded.loops,
        test,
        folds: unfolded.loops[0]!.map(() => undefined),
      };
      nf.folds[unfolded.index] = { other: cand.from, index: cand.fromIndex, edge: cand.edge };
      cand.from.folds[cand.fromIndex] = { other: nf, index: unfolded.index, edge: cand.edge };
      addFace(nf);
    }
  }

  /**
   * Unfold the face `cand.to` about the shared edge into the plane of the net: the rigid
   * motion (rotation + translation, no reflection) that maps the two shared vertices from the
   * face's own frame onto their positions in the net. Both polygons are counter-clockwise
   * seen from outside and traverse the shared edge in opposite directions, so the face lands
   * on the far side of the edge automatically.
   */
  function unfold(cand: Candidate): { loops: Vec2[][]; index: number } | null {
    const index = outerIndexOf(cand.to, cand.edge);
    const data = own.get(cand.to.id);
    if (index < 0 || !data) return null;
    const parentLoop = cand.from.loops[0]!;
    const parentIds = cand.from.face.loops[0]!;
    const pA = parentLoop[cand.fromIndex]!;
    const pB = parentLoop[(cand.fromIndex + 1) % parentLoop.length]!;
    const idA = parentIds[cand.fromIndex]!;
    const childIds = cand.to.loops[0]!;
    const childLoop = data.loops[0]!;
    const c0 = childLoop[index]!;
    const c1 = childLoop[(index + 1) % childLoop.length]!;
    // Child edge start corresponds to parent vertex A or B.
    const startIsA = childIds[index] === idA;
    const from0 = c0;
    const from1 = c1;
    const to0 = startIsA ? pA : pB;
    const to1 = startIsA ? pB : pA;
    const angle =
      Math.atan2(to1.y - to0.y, to1.x - to0.x) - Math.atan2(from1.y - from0.y, from1.x - from0.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const map = (p: Vec2): Vec2 => {
      const dx = p.x - from0.x;
      const dy = p.y - from0.y;
      return { x: to0.x + dx * cos - dy * sin, y: to0.y + dx * sin + dy * cos };
    };
    return { loops: data.loops.map((l) => l.map(map)), index };
  }

  // 3. Boundary of every net and part edges.
  const connections: EdgeConnection[] = [];
  const boundaryByKey = new Map<string, { net: Net; be: BoundaryEdge }>();
  const keyOf = (faceId: number, loop: number, index: number): string =>
    `${faceId}:${loop}:${index}`;
  const netLoops = new Map<number, BoundaryEdge[][]>();
  const netFolds = new Map<
    number,
    { a: Vec2; b: Vec2; edge: TopoEdge; partEdge: number; angle: number; connectionId: string }[]
  >();

  for (const net of nets) {
    const loops: BoundaryEdge[][] = [];
    let counter = 0;
    // Outer boundary: follow the directed face edges; at a fold, cross over to the
    // neighbouring face and continue with the edge after the fold.
    const outer: BoundaryEdge[] = [];
    let start: { f: NetFace; i: number } | undefined;
    for (const f of net.faces) {
      const i = f.folds.findIndex((x) => x === undefined);
      if (i >= 0) {
        start = { f, i };
        break;
      }
    }
    if (start) {
      let cur = start;
      let guard = 0;
      const limit = net.faces.reduce((s, f) => s + f.loops[0]!.length, 0) * 4 + 8;
      do {
        const loop = cur.f.loops[0]!;
        outer.push({
          owner: cur.f,
          loop: 0,
          index: cur.i,
          a: loop[cur.i]!,
          b: loop[(cur.i + 1) % loop.length]!,
          edge: edgeAt(cur.f.face, 0, cur.i),
          partEdge: counter++,
        });
        let f = cur.f;
        let i = (cur.i + 1) % f.loops[0]!.length;
        let hops = 0;
        for (let fold = f.folds[i]; fold && hops < limit; fold = f.folds[i], hops++) {
          f = fold.other;
          i = (fold.index + 1) % f.loops[0]!.length;
        }
        cur = { f, i };
      } while ((cur.f !== start.f || cur.i !== start.i) && guard++ < limit);
    }
    loops.push(outer);
    for (const f of net.faces) {
      for (let li = 1; li < f.loops.length; li++) {
        const loop = f.loops[li]!;
        loops.push(
          loop.map((a, i) => ({
            owner: f,
            loop: li,
            index: i,
            a,
            b: loop[(i + 1) % loop.length]!,
            edge: edgeAt(f.face, li, i),
            partEdge: counter++,
          })),
        );
      }
    }
    for (const loop of loops) {
      for (const be of loop) boundaryByKey.set(keyOf(be.owner.face.id, be.loop, be.index), { net, be });
    }
    netLoops.set(net.id, loops);

    // Tree edges → folds.
    const folds: NonNullable<ReturnType<typeof netFolds.get>> = [];
    for (const f of net.faces) {
      f.folds.forEach((fold, i) => {
        if (!fold || f.face.id > fold.other.face.id) return;
        const loop = f.loops[0]!;
        const theta = edgeInteriorAngle(topology, fold.edge) ?? Math.PI;
        const connectionId = `${body.id}.conn-${fold.edge.id}`;
        const partEdge = counter++;
        folds.push({
          a: loop[i]!,
          b: loop[(i + 1) % loop.length]!,
          edge: fold.edge,
          partEdge,
          angle: radToDeg(theta),
          connectionId,
        });
        const edgeId = `${net.partId}.edge-${partEdge}`;
        connections.push({
          id: connectionId,
          a: { partId: net.partId, edgeId, role: "fold" },
          b: { partId: net.partId, edgeId, role: "fold" },
          joint: "fold",
          angle: radToDeg(theta),
          length: dist2(loop[i]!, loop[(i + 1) % loop.length]!),
          sourceEdge: fold.edge.id,
        });
      });
    }
    folds.sort((x, y) => x.edge.id - y.edge.id);
    netFolds.set(net.id, folds);
  }

  // 4. Cut edges: every topology edge that appears twice on net boundaries gets a connection
  //    and its joint: a glue tab, or tabs on one side and slits on the other.
  const tabSettings = settings.glueTabs;
  const insert = settings.insertTabs;
  const finiteOr = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const neck = Math.max(0.3, finiteOr(insert.neck, 1));
  const flapHeight = Math.max(2, finiteOr(insert.flap, 8));
  const lock = Math.max(0, finiteOr(insert.lock, 0));
  const insertDepth = Math.max(1, finiteOr(insert.depth, 8));
  const clearance = Math.max(0, finiteOr(insert.clearance, 0));

  /** Vertex of the solid at the start of a boundary edge. */
  const startVertex = (be: BoundaryEdge): number => be.owner.face.loops[be.loop]![be.index]!;

  /**
   * Insert tabs on `tabSide`, and the flap with the slits for them on `slitSide`, or null
   * when the edge is too short or there is no room. Positions are measured along the edge of
   * the solid, so a tab and its slit are at the same place on both sides.
   */
  const makeInserts = (
    tabSide: { net: Net; be: BoundaryEdge },
    slitSide: { net: Net; be: BoundaryEdge },
    edge: TopoEdge,
  ): {
    tabs: NonNullable<BoundaryEdge["inserts"]>;
    flap: NonNullable<BoundaryEdge["flap"]>;
    tabTests: Vec2[][];
    flapTest: Vec2[];
  } | null => {
    const length = dist2(tabSide.be.a, tabSide.be.b);
    const margin = lock + clearance / 2 + INSERT_MARGIN;
    const usable = length - 2 * margin;
    if (usable < MIN_INSERT_WIDTH) return null;
    const width = Math.min(Math.max(MIN_INSERT_WIDTH, finiteOr(insert.width, 12)), usable);
    const gap = Math.max(2 * lock + 1, finiteOr(insert.spacing, 20));
    const count = Math.max(1, Math.floor((usable + gap + 1e-9) / (width + gap)));
    const cell = usable / count;

    /** Point of a side at `s` along the edge of the solid and `h` from the edge. */
    const frame = (side: { be: BoundaryEdge }, inward: boolean) => {
      const { a, b } = side.be;
      const u = norm2(sub2(b, a));
      const left = perp2(u); // material is on the left of travel
      const normal = inward ? left : { x: -left.x, y: -left.y };
      const forward = startVertex(side.be) === edge.a;
      return (s: number, h: number): Vec2 => {
        const along = forward ? s : length - s;
        return { x: a.x + u.x * along + normal.x * h, y: a.y + u.y * along + normal.y * h };
      };
    };
    const onTab = frame(tabSide, false);
    const onSlit = frame(slitSide, false);
    const tip = Math.min(width / 4, insertDepth / 2);

    // The flap of the other side: it is folded inwards and lies behind the face that carries
    // the tabs. The slits are cut into its fold line.
    let flap: Vec2[] | null = null;
    for (const scale of [1, 0.5]) {
      // Along the whole edge: the slits lie in its fold line.
      const made = makeTab(slitSide.be, 1, flapHeight * scale, 0);
      if (!made) continue;
      const test = shrink(made);
      const hitsFace = slitSide.net.faces.some((f) => polygonsOverlap(test, f.test));
      const hitsTab = slitSide.net.tabs.some((other) => polygonsOverlap(test, other));
      if (hitsFace || hitsTab) continue;
      flap = made;
      break;
    }
    if (!flap) return null;
    const flapTest = shrink(flap);

    const tabs: NonNullable<BoundaryEdge["inserts"]> = [];
    const spans: [number, number][] = [];
    const tests: Vec2[][] = [];
    for (let i = 0; i < count; i++) {
      const s0 = margin + cell * (i + 0.5) - width / 2;
      const s1 = s0 + width;
      // A short neck that passes the slit, shoulders that lock behind it, and the tongue
      // narrowing to its tip.
      const outline: [number, number][] = [
        [s0, 0],
        [s0, neck],
        [s0 - lock, neck],
        [s0 + tip, neck + insertDepth],
        [s1 - tip, neck + insertDepth],
        [s1 + lock, neck],
        [s1, neck],
        [s1, 0],
      ];
      let polygon: Vec2[] = [];
      for (const [s, h] of outline) pushPoint(polygon, onTab(s, h), 1e-7);
      // In the direction of travel of the boundary, so that it can be spliced into the cut.
      if (dist2(polygon[0]!, tabSide.be.a) > dist2(polygon[polygon.length - 1]!, tabSide.be.a)) {
        polygon = polygon.reverse();
      }
      // The tab lies outside the net and clear of the other tabs and flaps.
      const test = shrink(polygon);
      const hitsFace = tabSide.net.faces.some((f) => polygonsOverlap(test, f.test));
      const others = [...tabSide.net.tabs, ...tests];
      if (tabSide.net === slitSide.net) others.push(flapTest);
      if (hitsFace || others.some((other) => polygonsOverlap(test, other))) continue;
      tabs.push({ polygon, folds: [[onTab(s0, 0), onTab(s1, 0)]] });
      spans.push([s0 - clearance / 2, s1 + clearance / 2]);
      tests.push(test);
    }
    if (tabs.length === 0) return null;

    // Along the fold line of the flap: slits where the tabs arrive, folds in between.
    spans.sort((p, q) => p[0] - q[0]);
    const slits: [Vec2, Vec2][] = spans.map(([s0, s1]) => [onSlit(s0, 0), onSlit(s1, 0)]);
    const folds: [Vec2, Vec2][] = [];
    let from = 0;
    for (const [s0, s1] of [...spans, [length, length] as [number, number]]) {
      if (s0 - from > 1e-6) folds.push([onSlit(from, 0), onSlit(s0, 0)]);
      from = s1;
    }
    tests.push(flapTest);
    // In the order in which the boundary passes them.
    tabs.sort(
      (p, q) => dist2(p.polygon[0]!, tabSide.be.a) - dist2(q.polygon[0]!, tabSide.be.a),
    );
    return { tabs, flap: { polygon: flap, slits, folds }, tabTests: tests.slice(0, -1), flapTest };
  };
  const makeTab = (
    be: BoundaryEdge,
    scale: number,
    size = tabSettings.width,
    fromEnds = tabSettings.inset,
  ): Vec2[] | null => {
    const u = norm2(sub2(be.b, be.a));
    const out = perp2(u); // material is on the left of travel, so the tab goes to the right
    const outward = { x: -out.x, y: -out.y };
    const length = dist2(be.a, be.b);
    const inset = Math.max(0, fromEnds);
    const base = length - 2 * inset;
    const height = size * scale;
    if (base <= 1e-6 || height <= 1e-6) return null;
    const taper = Math.min(89, Math.max(0, tabSettings.angle));
    const run = Math.min(height * Math.tan(degToRad(taper)), base / 2);
    const at = (along: number, h: number): Vec2 => ({
      x: be.a.x + u.x * along + outward.x * h,
      y: be.a.y + u.y * along + outward.y * h,
    });
    const poly: Vec2[] = [];
    pushPoint(poly, at(inset, 0));
    pushPoint(poly, at(inset + run, height));
    pushPoint(poly, at(length - inset - run, height), 1e-7);
    pushPoint(poly, at(length - inset, 0));
    return poly.length >= 3 ? poly : null;
  };

  for (const edge of topology.edges) {
    if (edge.faces.length !== 2) continue;
    const ends: { net: Net; be: BoundaryEdge }[] = [];
    for (const faceId of edge.faces.slice().sort((a, b) => a - b)) {
      const nf = placed.get(faceId);
      if (!nf) continue;
      nf.face.loops.forEach((ids, li) => {
        ids.forEach((v, i) => {
          const w = ids[(i + 1) % ids.length]!;
          if (topoEdgeKey(v, w) !== topoEdgeKey(edge.a, edge.b)) return;
          const hit = boundaryByKey.get(keyOf(faceId, li, i));
          if (hit) ends.push(hit);
        });
      });
    }
    if (ends.length !== 2) continue; // fold edges are not on any boundary
    const [x, y] = [ends[0]!, ends[1]!];
    const theta = edgeInteriorAngle(topology, edge) ?? Math.PI;
    const connectionId = `${body.id}.conn-${edge.id}`;
    x.be.connectionId = connectionId;
    y.be.connectionId = connectionId;
    let glued: { net: Net; be: BoundaryEdge } | undefined;
    let inserted: { net: Net; be: BoundaryEdge } | undefined;
    if (settings.joint === "insert") {
      // Deterministic choice: tabs on the face with the lower id, slits on the other; the
      // other way round when that does not fit.
      for (const [tabSide, slitSide] of [
        [x, y],
        [y, x],
      ] as const) {
        const made = makeInserts(tabSide, slitSide, edge);
        if (!made) continue;
        tabSide.be.inserts = made.tabs;
        tabSide.net.tabs.push(...made.tabTests);
        slitSide.be.flap = made.flap;
        slitSide.net.tabs.push(made.flapTest);
        inserted = tabSide;
        break;
      }
      if (!inserted) {
        warnings.push({
          code: "joint-fallback",
          severity: "info",
          message:
            `This edge (${dist2(x.be.a, x.be.b).toFixed(1)} mm) has no room for a tab and its flap. ` +
            (tabSettings.enabled ? "A glue tab is used instead." : "It is left without a joint."),
          connectionId,
          partId: x.net.partId,
          edgeId: `${x.net.partId}.edge-${x.be.partEdge}`,
          position: midpoint(edge),
        });
      }
    }
    if (!inserted && tabSettings.enabled) {
      // Deterministic choice: the face with the lower id first, the other side when the tab
      // would cover the net or another tab; then both sides again with a tab of half height.
      for (const scale of [1, 0.5]) {
        for (const end of ends) {
          const tab = makeTab(end.be, scale);
          if (!tab) continue;
          const test = shrink(tab);
          const hitsFace = end.net.faces.some((f) => polygonsOverlap(test, f.test));
          const hitsTab = end.net.tabs.some((other) => polygonsOverlap(test, other));
          if (hitsFace || hitsTab) continue;
          end.be.tab = tab;
          end.net.tabs.push(test);
          glued = end;
          break;
        }
        if (glued) break;
      }
      if (!glued) {
        warnings.push({
          code: "overlap",
          severity: "warning",
          message:
            "No room for a glue tab on this edge: it would overlap the net on both sides. " +
            "The edge is left without a tab.",
          connectionId,
          partId: x.net.partId,
          edgeId: `${x.net.partId}.edge-${x.be.partEdge}`,
          position: midpoint(edge),
        });
      }
    }
    const endOf = (end: { net: Net; be: BoundaryEdge }): EdgeConnection["a"] => ({
      partId: end.net.partId,
      edgeId: `${end.net.partId}.edge-${end.be.partEdge}`,
      role: inserted ? (end === inserted ? "tab" : "slot") : end === glued ? "glue-tab" : "glue",
    });
    // The side carrying the tab is listed first.
    const first = (inserted ?? glued) === y ? y : x;
    const second = first === x ? y : x;
    connections.push({
      id: connectionId,
      a: endOf(first),
      b: endOf(second),
      joint: inserted ? "tab-slot" : "glue-tab",
      angle: radToDeg(theta),
      length: dist2(x.be.a, x.be.b),
      sourceEdge: edge.id,
    });
  }
  connections.sort((a, b) => (a.sourceEdge ?? 0) - (b.sourceEdge ?? 0));

  // 5. Compile parts.
  const kerf = settings.kerfCompensation ? material.kerf : 0;
  const parts: FlatPart[] = nets.map((net) => {
    const loops = netLoops.get(net.id) ?? [];
    const folds = netFolds.get(net.id) ?? [];
    const paths: FlatPath[] = [];
    const tabFolds: FlatPath[] = [];
    const slitCuts: FlatPath[] = [];
    const joints: JointFeature[] = [];
    const edges: PartEdge[] = [];
    const plain: Vec2[][] = [];
    loops.forEach((loop, li) => {
      const raw: Vec2[] = [];
      const cut: Vec2[] = [];
      for (const be of loop) {
        const edgeId = `${net.partId}.edge-${be.partEdge}`;
        edges.push({
          id: edgeId,
          index: be.partEdge,
          loop: li,
          a: be.a,
          b: be.b,
          length: dist2(be.a, be.b),
          connectionId: be.connectionId,
          sourceEdge: be.edge?.id,
        });
        pushPoint(raw, be.a);
        pushPoint(cut, be.a);
        if (be.tab && be.connectionId) {
          // Splice the tab into the cut path so that it stays attached to the net.
          for (const p of be.tab) pushPoint(cut, p);
          joints.push({
            kind: "glue-tab",
            connectionId: be.connectionId,
            edgeId,
            polygons: [be.tab],
          });
          tabFolds.push({
            type: "fold",
            role: "glue-tab",
            points: [be.tab[0]!, be.tab[be.tab.length - 1]!],
            closed: false,
            connectionId: be.connectionId,
          });
        }
        if (be.inserts && be.connectionId) {
          // The tabs are part of the outline, like glue tabs.
          for (const tab of be.inserts) {
            for (const p of tab.polygon) pushPoint(cut, p);
            for (const fold of tab.folds) {
              tabFolds.push({
                type: "fold",
                role: "tab",
                points: [fold[0], fold[1]],
                closed: false,
                connectionId: be.connectionId,
              });
            }
          }
          joints.push({
            kind: "tab",
            connectionId: be.connectionId,
            edgeId,
            polygons: be.inserts.map((t) => t.polygon),
          });
        }
        if (be.flap && be.connectionId) {
          for (const q of be.flap.polygon) pushPoint(cut, q);
          joints.push({
            kind: "flap",
            connectionId: be.connectionId,
            edgeId,
            polygons: [be.flap.polygon],
          });
          joints.push({ kind: "slot", connectionId: be.connectionId, polygons: be.flap.slits });
          for (const fold of be.flap.folds) {
            tabFolds.push({
              type: "fold",
              role: "tab",
              points: [fold[0], fold[1]],
              closed: false,
              connectionId: be.connectionId,
            });
          }
          // Slits: single cuts in the fold line. The laser gives them the width of its kerf.
          for (const slit of be.flap.slits) {
            slitCuts.push({
              type: "cut",
              role: "slot",
              points: [slit[0], slit[1]],
              closed: false,
              connectionId: be.connectionId,
            });
          }
        }
      }
      plain.push(closeLoop(raw));
      paths.push({
        type: "cut",
        role: li === 0 ? "outline" : "hole",
        points: closeLoop(cut),
        closed: true,
      });
    });
    for (const fold of folds) {
      edges.push({
        id: `${net.partId}.edge-${fold.partEdge}`,
        index: fold.partEdge,
        loop: -1, // interior edge: neither outline nor hole
        a: fold.a,
        b: fold.b,
        length: dist2(fold.a, fold.b),
        connectionId: fold.connectionId,
        sourceEdge: fold.edge.id,
      });
      paths.push({
        type: fold.edge.smooth ? "engrave" : "fold",
        role: "fold",
        points: [fold.a, fold.b],
        closed: false,
        connectionId: fold.connectionId,
      });
    }
    paths.push(...tabFolds);
    paths.push(...slitCuts);
    edges.sort((a, b) => a.index - b.index);
    const finalPaths = kerf > 0 ? compensateKerf(paths, kerf) : paths;
    const outline = plain[0] ?? [];
    const plane = net.rootPlane;
    return {
      id: net.partId,
      name: nets.length === 1 ? "net" : `net-${net.id + 1}`,
      materialId: material.id,
      thickness: material.thickness,
      sourceFaces: net.faces.map((f) => f.face.id),
      outline,
      holes: plain.slice(1),
      edges,
      joints,
      folds: folds.map((f) => ({ a: f.a, b: f.b, connectionId: f.connectionId, angle: f.angle })),
      paths: finalPaths,
      bounds: boundsOfPaths(finalPaths, outline),
      frame: { origin: plane.origin, xDir: plane.xDir, yDir: plane.yDir, normal: plane.normal },
    };
  });

  return {
    bodyId: body.id,
    material,
    strategyId: "laser.paper",
    parts,
    connections,
    warnings: dedupeWarnings(warnings),
  };
}

export const laserPaperStrategy: FabricationStrategy<PaperSettings> = {
  id: "laser.paper",
  name: "Laser cut paper (unfolded net)",
  process: "laser",
  supports: (material) => material.category === "paper",
  defaultSettings: defaultPaperSettings,
  fabricate: fabricatePaper,
};
