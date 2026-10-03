import {
  type Bounds2,
  type Curve2,
  type Loop2,
  type Profile2,
  type Vec2,
  boundsOfPoints,
  closestParam,
  cross2,
  curveBounds,
  curveDerivativeAt,
  curveEnd,
  curveLength,
  curvePointAt,
  curveStart,
  dist2,
  flattenLoop,
  intersectCurves,
  pointInPolygon,
  reverseCurve,
  sub2,
  subCurve,
} from "@fabcad/geometry";
import type { EntityId, Sketch } from "./model";
import { isCurve } from "./edit";
import { entityToCurves } from "./curves";
import { textRegions } from "./text";

/**
 * Sketch Profile Detection: Sketch Geometry → Intersections → Closed Loops → Selectable Profiles.
 *
 * All non-construction curves are split at their mutual intersections, assembled into a planar
 * graph and the minimal bounded faces of that graph become the selectable regions.
 *
 * Projected geometry (the outline of the face a sketch is on, edges brought in with Project) is
 * a reference: it does not cut a region that the drawn curves enclose. The drawn curves form
 * their regions on their own; the projected curves add regions only where no drawn region is,
 * such as the face around a drawn hole, or the halves of a face a drawn line runs across.
 */

export interface SketchRegion {
  /**
   * Stable key derived from the sorted boundary entity ids (outer + holes). Regions sharing the
   * same boundary entities (e.g. the three regions of two overlapping circles) are told apart
   * by a `~n` suffix in area order.
   */
  id: string;
  /** Exact curves: outer loop counter-clockwise, holes clockwise. */
  profile: Profile2;
  /** Entities contributing to the outer boundary (in traversal order, unique). */
  entityIds: EntityId[];
  /** Entities contributing to each hole boundary. */
  holeEntityIds: EntityId[][];
  /** Net area (outer minus holes), > 0. Computed from the exact curves. */
  area: number;
  /** Flattened outer loop (CCW). */
  polygon: Vec2[];
  /** Flattened holes (CW). */
  holePolygons: Vec2[][];
  /** A point strictly inside the region (not in a hole). */
  interiorPoint: Vec2;
  /** Set for the regions of a text: the id of the text. */
  textId?: string;
}

/** Persistent reference to a region, stored by features such as Extrude. */
export interface ProfileRef {
  entityIds: EntityId[];
  point: Vec2;
  /**
   * The whole text with this id: every region of it, whatever the text says by then. The
   * reference survives editing the text, which a reference to single glyphs would not.
   */
  textId?: string;
}

export interface DetectProfilesOptions {
  /** Distance below which points are considered coincident. Default 1e-6 mm. */
  tolerance?: number;
  /** Chord tolerance of `polygon` / `holePolygons`. Default 0.01 mm. */
  flattenTolerance?: number;
}

interface Piece {
  entityId: EntityId;
  curve: Curve2;
  bounds: Bounds2;
}

interface Edge {
  entityId: EntityId;
  piece: number;
  t0: number;
  t1: number;
  curve: Curve2;
  n0: number;
  n1: number;
  length: number;
}

/** Spatial hash merging points closer than `tol` into shared nodes. */
class NodeSet {
  readonly points: Vec2[] = [];
  private readonly grid = new Map<string, number[]>();
  private readonly cell: number;

  constructor(private readonly tol: number) {
    this.cell = tol * 4;
  }

  add(p: Vec2): number {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (dist2(this.points[i]!, p) <= this.tol) return i;
        }
      }
    }
    const id = this.points.length;
    this.points.push(p);
    const key = `${cx},${cy}`;
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(id);
    else this.grid.set(key, [id]);
    return id;
  }
}

const boundsOverlap = (a: Bounds2, b: Bounds2, tol: number): boolean =>
  a.minX <= b.maxX + tol &&
  b.minX <= a.maxX + tol &&
  a.minY <= b.maxY + tol &&
  b.minY <= a.maxY + tol;

const inBounds = (p: Vec2, b: Bounds2, tol: number): boolean =>
  p.x >= b.minX - tol && p.x <= b.maxX + tol && p.y >= b.minY - tol && p.y <= b.maxY + tol;

function collectPieces(sketch: Sketch, tol: number, skip: Set<EntityId>): Piece[] {
  const pieces: Piece[] = [];
  for (const e of Object.values(sketch.entities)) {
    if (!isCurve(e) || e.construction || skip.has(e.id)) continue;
    let curves: Curve2[];
    try {
      curves = entityToCurves(sketch, e);
    } catch {
      continue; // Entity with a dangling point reference: ignore rather than fail detection.
    }
    for (const curve of curves) {
      if (!(curveLength(curve) > tol)) continue;
      pieces.push({ entityId: e.id, curve, bounds: curveBounds(curve) });
    }
  }
  return pieces;
}

/** Split every piece at intersections and touching end points and build the node / edge graph. */
function buildGraph(pieces: Piece[], tol: number): { edges: Edge[]; nodes: Vec2[] } {
  const params: number[][] = pieces.map(() => []);
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!;
      if (!boundsOverlap(a.bounds, b.bounds, tol)) continue;
      for (const hit of intersectCurves(a.curve, b.curve)) {
        params[i]!.push(hit.ta);
        params[j]!.push(hit.tb);
      }
      // End points touching the other curve (T junctions, overlapping collinear lines).
      for (const [target, source] of [
        [i, j],
        [j, i],
      ] as const) {
        const t = pieces[target]!;
        const s = pieces[source]!;
        for (const p of [curveStart(s.curve), curveEnd(s.curve)]) {
          if (!inBounds(p, t.bounds, tol)) continue;
          const u = closestParam(t.curve, p);
          if (dist2(curvePointAt(t.curve, u), p) <= tol) params[target]!.push(u);
        }
      }
    }
  }

  const nodes = new NodeSet(tol);
  const edges: Edge[] = [];
  pieces.forEach((piece, index) => {
    const c = piece.curve;
    const end = curveEnd(c);
    const kept: number[] = [0];
    let last = curveStart(c);
    for (const t of params[index]!.slice().sort((x, y) => x - y)) {
      if (!(t > 0 && t < 1)) continue;
      const p = curvePointAt(c, t);
      if (dist2(p, last) <= tol || dist2(p, end) <= tol) continue;
      // A closed curve comes back to its start: keep at least a real span before the end.
      kept.push(t);
      last = p;
    }
    kept.push(1);
    for (let k = 0; k + 1 < kept.length; k++) {
      const t0 = kept[k]!;
      const t1 = kept[k + 1]!;
      const curve = t0 === 0 && t1 === 1 ? c : subCurve(c, t0, t1);
      const length = curveLength(curve);
      if (!(length > tol)) continue;
      const n0 = nodes.add(curveStart(curve));
      const n1 = nodes.add(curveEnd(curve));
      edges.push({ entityId: piece.entityId, piece: index, t0, t1, curve, n0, n1, length });
    }
  });

  // Remove duplicates produced by overlapping geometry (same nodes, same midpoint).
  const unique: Edge[] = [];
  const seen = new Map<string, Vec2[]>();
  for (const e of edges) {
    const key = e.n0 < e.n1 ? `${e.n0}-${e.n1}` : `${e.n1}-${e.n0}`;
    const mid = curvePointAt(e.curve, 0.5);
    const mids = seen.get(key);
    if (mids?.some((m) => dist2(m, mid) <= tol * 10)) continue;
    if (mids) mids.push(mid);
    else seen.set(key, [mid]);
    unique.push(e);
  }
  return { edges: unique, nodes: nodes.points };
}

/** Half-edge `2 * i` runs along edge `i`, half-edge `2 * i + 1` against it. */
const originOf = (edges: Edge[], he: number): number =>
  he % 2 === 0 ? edges[he >> 1]!.n0 : edges[he >> 1]!.n1;

const orientedCurve = (edges: Edge[], he: number): Curve2 => {
  const c = edges[he >> 1]!.curve;
  return he % 2 === 0 ? c : reverseCurve(c);
};

/** Trace all faces (cycles of half-edges with the face on their left). */
function traceFaces(edges: Edge[]): number[][] {
  const minLength = new Map<number, number>();
  for (const e of edges) {
    for (const n of [e.n0, e.n1]) {
      minLength.set(n, Math.min(minLength.get(n) ?? Infinity, e.length));
    }
  }
  const outgoing = new Map<number, { he: number; angle: number }[]>();
  for (let he = 0; he < edges.length * 2; he++) {
    const e = edges[he >> 1]!;
    const origin = originOf(edges, he);
    // Direction towards a point a short, node-wide identical distance along the curve, so that
    // curves leaving the node tangentially are still ordered by their curvature.
    const step = Math.min(0.25, ((minLength.get(origin) ?? e.length) * 1e-3) / e.length);
    const forward = he % 2 === 0;
    const from = curvePointAt(e.curve, forward ? 0 : 1);
    const to = curvePointAt(e.curve, forward ? step : 1 - step);
    const list = outgoing.get(origin) ?? [];
    list.push({ he, angle: Math.atan2(to.y - from.y, to.x - from.x) });
    outgoing.set(origin, list);
  }
  const next = new Array<number>(edges.length * 2).fill(-1);
  const slot = new Array<number>(edges.length * 2).fill(-1);
  for (const list of outgoing.values()) {
    list.sort((a, b) => a.angle - b.angle || a.he - b.he);
    list.forEach((o, i) => {
      slot[o.he] = i;
    });
  }
  for (let he = 0; he < edges.length * 2; he++) {
    const twin = he ^ 1;
    const list = outgoing.get(originOf(edges, twin))!;
    const i = slot[twin]!;
    next[he] = list[(i - 1 + list.length) % list.length]!.he;
  }
  const visited = new Array<boolean>(edges.length * 2).fill(false);
  const faces: number[][] = [];
  for (let start = 0; start < edges.length * 2; start++) {
    if (visited[start]) continue;
    const cycle: number[] = [];
    let he = start;
    while (!visited[he]) {
      visited[he] = true;
      cycle.push(he);
      he = next[he]!;
    }
    faces.push(cycle);
  }
  return faces;
}

/**
 * Remove every edge that does not separate two faces (dangling chains and bridges between
 * loops) and return the faces of the remaining graph.
 */
function extractFaces(input: Edge[]): { edges: Edge[]; faces: number[][] } {
  let edges = input;
  for (;;) {
    const faces = traceFaces(edges);
    const faceOf = new Array<number>(edges.length * 2).fill(-1);
    faces.forEach((cycle, f) => {
      for (const he of cycle) faceOf[he] = f;
    });
    const kept = edges.filter((_, i) => faceOf[2 * i] !== faceOf[2 * i + 1]);
    if (kept.length === edges.length) return { edges, faces };
    edges = kept;
  }
}

/** Contribution of a curve to the signed area integral ½∮(x dy − y dx). Exact for all types. */
function sweptArea(c: Curve2): number {
  switch (c.type) {
    case "line":
      return cross2(c.a, c.b) / 2;
    case "arc":
      return (
        (c.radius * c.radius * c.sweep + cross2(c.center, sub2(curveEnd(c), curveStart(c)))) / 2
      );
    case "ellipseArc":
      return (c.rx * c.ry * c.sweep + cross2(c.center, sub2(curveEnd(c), curveStart(c)))) / 2;
    case "bezier": {
      // The integrand is a quintic polynomial: 3 point Gauss-Legendre is exact.
      const h = Math.sqrt(3 / 5) / 2;
      let sum = 0;
      for (const [t, w] of [
        [0.5 - h, 5 / 18],
        [0.5, 8 / 18],
        [0.5 + h, 5 / 18],
      ] as const) {
        sum += w * cross2(curvePointAt(c, t), curveDerivativeAt(c, t));
      }
      return sum / 2;
    }
  }
}

export const loopArea = (loop: Loop2): number => loop.curves.reduce((a, c) => a + sweptArea(c), 0);

interface BoundaryLoop {
  loop: Loop2;
  entityIds: EntityId[];
  area: number;
  polygon: Vec2[];
  bounds: Bounds2;
  component: number;
}

/** Turn a half-edge cycle into exact curves, merging consecutive spans of the same source curve. */
function buildLoop(
  cycle: number[],
  edges: Edge[],
  pieces: Piece[],
  nodes: Vec2[],
): { loop: Loop2; entityIds: EntityId[] } {
  interface Span {
    piece: number;
    entityId: EntityId;
    from: number;
    to: number;
    forward: boolean;
    /** The span runs across the seam (t = 1 ≡ t = 0) of a closed source curve. */
    wraps: boolean;
    startNode: number;
    endNode: number;
  }
  const closedSource = (piece: number): boolean => {
    const c = pieces[piece]!.curve;
    return (
      (c.type === "arc" || c.type === "ellipseArc") &&
      Math.abs(Math.abs(c.sweep) - 2 * Math.PI) < 1e-12
    );
  };
  const joins = (a: Span, b: Span): boolean => {
    if (a.piece !== b.piece || a.forward !== b.forward || a.wraps || b.wraps) return false;
    return (
      a.to === b.from ||
      (closedSource(a.piece) && a.to === (a.forward ? 1 : 0) && b.from === (a.forward ? 0 : 1))
    );
  };
  const merge = (a: Span, b: Span): Span => ({
    ...a,
    to: b.to,
    wraps: a.to !== b.from,
    endNode: b.endNode,
  });
  const spans: Span[] = [];
  for (const he of cycle) {
    const e = edges[he >> 1]!;
    const forward = he % 2 === 0;
    const span: Span = {
      piece: e.piece,
      entityId: e.entityId,
      from: forward ? e.t0 : e.t1,
      to: forward ? e.t1 : e.t0,
      forward,
      wraps: false,
      startNode: forward ? e.n0 : e.n1,
      endNode: forward ? e.n1 : e.n0,
    };
    const prev = spans[spans.length - 1];
    if (prev && joins(prev, span)) spans[spans.length - 1] = merge(prev, span);
    else spans.push(span);
  }
  if (spans.length > 1 && joins(spans[spans.length - 1]!, spans[0]!)) {
    const tail = spans.pop()!;
    spans[0] = merge(tail, spans[0]!);
  }
  const curves = spans.map((s): Curve2 => {
    const src = pieces[s.piece]!.curve;
    if (src.type === "line") {
      // Snap to the merged node positions so that consecutive curves join exactly.
      return { type: "line", a: nodes[s.startNode]!, b: nodes[s.endNode]! };
    }
    if (s.wraps && (src.type === "arc" || src.type === "ellipseArc")) {
      const span = s.forward ? 1 - s.from + s.to : s.from + 1 - s.to;
      const sweep = src.sweep * span * (s.forward ? 1 : -1);
      return src.type === "arc"
        ? { ...src, startAngle: src.startAngle + src.sweep * s.from, sweep }
        : { ...src, startParam: src.startParam + src.sweep * s.from, sweep };
    }
    const lo = Math.min(s.from, s.to);
    const hi = Math.max(s.from, s.to);
    const part = lo === 0 && hi === 1 ? src : subCurve(src, lo, hi);
    return s.forward ? part : reverseCurve(part);
  });
  const entityIds: EntityId[] = [];
  for (const s of spans) if (!entityIds.includes(s.entityId)) entityIds.push(s.entityId);
  return { loop: { curves }, entityIds };
}

/** A point strictly inside `outer` and outside all `holes`, found on a horizontal scan line. */
export function interiorPointOf(outer: Vec2[], holes: Vec2[][]): Vec2 {
  const b = boundsOfPoints(outer);
  let best: { p: Vec2; width: number } | null = null;
  for (const f of [0.5, 0.382, 0.618, 0.25, 0.75, 0.127, 0.873]) {
    const y = b.minY + (b.maxY - b.minY) * f;
    const xs: number[] = [];
    for (const poly of [outer, ...holes]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!;
      if (!best || width > best.width * 1.0001) {
        best = { p: { x: (xs[i]! + xs[i + 1]!) / 2, y }, width };
      }
    }
  }
  if (best) return best.p;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

const regionKey = (outer: EntityId[], holes: EntityId[][]): string => {
  const part = (ids: EntityId[]): string => ids.slice().sort().join(",");
  const holeParts = holes.map(part).sort();
  return holeParts.length ? `${part(outer)}|${holeParts.join("|")}` : part(outer);
};

/**
 * Closed regions of a sketch: the faces of the arrangement of its curves, followed by the
 * regions of its texts. Texts are regions of their own and are not cut by other geometry.
 */
export function detectProfiles(
  sketch: Sketch,
  options: DetectProfilesOptions = {},
): SketchRegion[] {
  const curves = detectCurveProfiles(sketch, options);
  if (!sketch.texts) return curves;
  const texts: SketchRegion[] = [];
  for (const text of Object.values(sketch.texts)) {
    if (text.construction) continue;
    texts.push(...textRegions(sketch, text, options.flattenTolerance ?? 0.01));
  }
  return texts.length > 0 ? [...curves, ...texts] : curves;
}

function detectCurveProfiles(
  sketch: Sketch,
  options: DetectProfilesOptions = {},
): SketchRegion[] {
  const tol = options.tolerance ?? 1e-6;
  const flattenTolerance = options.flattenTolerance ?? 0.01;
  const projected = new Set<EntityId>();
  for (const r of sketch.projections) for (const id of r.entityIds) projected.add(id);
  const all = arrangementRegions(collectPieces(sketch, tol, new Set()), tol, flattenTolerance);
  const drawn =
    projected.size > 0
      ? arrangementRegions(collectPieces(sketch, tol, projected), tol, flattenTolerance)
      : [];
  // Every face of the whole arrangement lies either inside one drawn region or outside all of
  // them, since the drawn curves are part of it: keep the ones outside.
  const regions =
    drawn.length > 0
      ? [...drawn, ...all.filter((r) => !drawn.some((d) => containsPoint(d, r.interiorPoint)))]
      : all;

  const compare = (a: SketchRegion, b: SketchRegion): number =>
    b.area - a.area ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
    a.interiorPoint.x - b.interiorPoint.x ||
    a.interiorPoint.y - b.interiorPoint.y;
  regions.sort(compare);
  const used = new Map<string, number>();
  for (const r of regions) {
    const n = (used.get(r.id) ?? 0) + 1;
    used.set(r.id, n);
    if (n > 1) r.id = `${r.id}~${n}`;
  }
  return regions.sort(compare);
}

/** The faces of the arrangement of `pieces`, with ids not yet told apart. */
function arrangementRegions(
  pieces: Piece[],
  tol: number,
  flattenTolerance: number,
): SketchRegion[] {
  if (pieces.length === 0) return [];
  const graph = buildGraph(pieces, tol);
  const { edges, faces } = extractFaces(graph.edges);
  if (edges.length === 0) return [];

  // Connected components of the remaining graph.
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  for (const e of edges) parent.set(find(e.n0), find(e.n1));

  const minArea = tol * tol;
  const bounded: BoundaryLoop[] = [];
  const outlines: BoundaryLoop[] = [];
  for (const cycle of faces) {
    const { loop, entityIds } = buildLoop(cycle, edges, pieces, graph.nodes);
    const area = loopArea(loop);
    if (Math.abs(area) <= minArea) continue;
    const polygon = flattenLoop(loop, flattenTolerance);
    const item: BoundaryLoop = {
      loop,
      entityIds,
      area,
      polygon,
      bounds: boundsOfPoints(polygon),
      component: find(originOf(edges, cycle[0]!)),
    };
    (area > 0 ? bounded : outlines).push(item);
  }

  // Each component outline becomes a hole of the smallest face of another component around it.
  const holesOf = new Map<BoundaryLoop, BoundaryLoop[]>();
  for (const outline of outlines) {
    const probe = curveStart(outline.loop.curves[0]!);
    let host: BoundaryLoop | null = null;
    for (const face of bounded) {
      if (face.component === outline.component) continue;
      if (host && face.area >= host.area) continue;
      if (!inBounds(probe, face.bounds, 0) || !pointInPolygon(probe, face.polygon)) continue;
      host = face;
    }
    if (!host) continue;
    const list = holesOf.get(host) ?? [];
    list.push(outline);
    holesOf.set(host, list);
  }

  const regions: SketchRegion[] = [];
  for (const face of bounded) {
    const holes = (holesOf.get(face) ?? [])
      .slice()
      .sort(
        (a, b) => a.area - b.area || a.bounds.minX - b.bounds.minX || a.bounds.minY - b.bounds.minY,
      );
    const area = holes.reduce((a, h) => a + h.area, face.area);
    if (!(area > minArea)) continue;
    const holePolygons = holes.map((h) => h.polygon);
    const holeEntityIds = holes.map((h) => h.entityIds);
    regions.push({
      id: regionKey(face.entityIds, holeEntityIds),
      profile: { outer: face.loop, holes: holes.map((h) => h.loop) },
      entityIds: face.entityIds,
      holeEntityIds,
      area,
      polygon: face.polygon,
      holePolygons,
      interiorPoint: interiorPointOf(face.polygon, holePolygons),
    });
  }
  return regions;
}

const containsPoint = (r: SketchRegion, p: Vec2): boolean =>
  pointInPolygon(p, r.polygon) && !r.holePolygons.some((h) => pointInPolygon(p, h));

/** Smallest-area region containing `p`. */
export function regionAtPoint(regions: SketchRegion[], p: Vec2): SketchRegion | undefined {
  let best: SketchRegion | undefined;
  for (const r of regions) {
    if (containsPoint(r, p) && (!best || r.area < best.area)) best = r;
  }
  return best;
}

export function profileRefOf(region: SketchRegion): ProfileRef {
  return {
    entityIds: region.entityIds.slice(),
    point: { ...region.interiorPoint },
    ...(region.textId !== undefined ? { textId: region.textId } : {}),
  };
}

/**
 * All regions a reference stands for: every region of the text for a text reference, the
 * one region found by `resolveProfileRef` otherwise.
 */
export function resolveProfileRefs(regions: SketchRegion[], ref: ProfileRef): SketchRegion[] {
  if (ref.textId !== undefined) return regions.filter((r) => r.textId === ref.textId);
  const region = resolveProfileRef(
    regions.filter((r) => r.textId === undefined),
    ref,
  );
  return region ? [region] : [];
}

/**
 * Re-identify a stored region after the sketch changed. Preference order: same outer entity set
 * (ties: containing `ref.point`, then nearest interior point), best Jaccard overlap of the
 * entity sets, region under `ref.point`.
 */
export function resolveProfileRef(
  regions: SketchRegion[],
  ref: ProfileRef,
): SketchRegion | undefined {
  const pick = (candidates: SketchRegion[]): SketchRegion | undefined => {
    if (candidates.length <= 1) return candidates[0];
    const inside = candidates.filter((r) => containsPoint(r, ref.point));
    if (inside.length > 0) {
      return inside.reduce((a, b) => (b.area < a.area ? b : a));
    }
    return candidates.reduce((a, b) =>
      dist2(b.interiorPoint, ref.point) < dist2(a.interiorPoint, ref.point) ? b : a,
    );
  };
  const wanted = new Set(ref.entityIds);
  const exact = regions.filter(
    (r) => r.entityIds.length === wanted.size && r.entityIds.every((id) => wanted.has(id)),
  );
  if (exact.length > 0) return pick(exact);

  let bestScore = 0;
  let best: SketchRegion[] = [];
  for (const r of regions) {
    const ids = new Set(r.entityIds);
    let common = 0;
    for (const id of ids) if (wanted.has(id)) common++;
    const union = ids.size + wanted.size - common;
    const score = union === 0 ? 0 : common / union;
    if (score > bestScore + 1e-12) {
      bestScore = score;
      best = [r];
    } else if (score > 0 && Math.abs(score - bestScore) <= 1e-12) {
      best.push(r);
    }
  }
  if (best.length > 0) return pick(best);
  return regionAtPoint(regions, ref.point);
}
