import {
  type Curve2,
  type Vec2,
  add2,
  closestParam,
  cross2,
  curveEnd,
  curvePointAt,
  curveStart,
  dist2,
  dot2,
  intersectCurves,
  intersectLines,
  norm2,
  normalizeAngle,
  perp2,
  rotate2,
  scale2,
  sub2,
} from "@fabcad/geometry";
import type {
  ArcEntity,
  CircleEntity,
  EllipseEntity,
  EntityId,
  LineEntity,
  Sketch,
  SketchDimension,
  SketchEntity,
} from "./model";
import { SketchBuilder, entityPointIds, getPoint, isCurve } from "./edit";
import { entityToCurves } from "./curves";

/**
 * Sketch Modify tools. All functions are pure: they never mutate their input and return a new
 * sketch (or `{ sketch, created }`).
 *
 * Error policy: operations that have nothing to do (unknown entity, unsupported curve type, no
 * intersection to extend to) return the sketch unchanged; operations asked for impossible
 * geometry (fillet larger than the lines, branching offset chain…) throw an `Error`.
 */

const TOL = 1e-7;

export interface ModifyResult {
  sketch: Sketch;
  /** Newly created curve entities (and copied stand-alone points). */
  created: EntityId[];
}

export interface CopyResult extends ModifyResult {
  /** Original id → copy id, for entities and points. Shared (not duplicated) points map to themselves. */
  map: Record<EntityId, EntityId>;
}

/** Existing, de-duplicated entity ids in input order. */
function existing(sketch: Sketch, ids: Iterable<EntityId>): SketchEntity[] {
  const seen = new Set<EntityId>();
  const out: SketchEntity[] = [];
  for (const id of ids) {
    const e = sketch.entities[id];
    if (!e || seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** Every point used by the entities, once, in first-use order. */
function pointsOf(entities: SketchEntity[]): EntityId[] {
  const seen = new Set<EntityId>();
  for (const e of entities) for (const p of entityPointIds(e)) seen.add(p);
  return [...seen];
}

function transformInPlace(
  sketch: Sketch,
  ids: EntityId[],
  apply: (p: Vec2) => Vec2,
  radiusScale: number,
): Sketch {
  const b = new SketchBuilder(sketch);
  const entities = existing(sketch, ids);
  for (const p of pointsOf(entities)) {
    if (sketch.entities[p]?.type === "point") b.movePoint(p, apply(getPoint(sketch, p)));
  }
  if (radiusScale !== 1) {
    for (const e of entities) {
      if (e.type === "circle") {
        b.updateEntity<CircleEntity>(e.id, { radius: e.radius * radiusScale });
      } else if (e.type === "ellipse") {
        b.updateEntity<EllipseEntity>(e.id, { minorRadius: e.minorRadius * radiusScale });
      }
    }
  }
  return b.build();
}

/** Translate the entities; every point they use moves exactly once. */
export function moveEntities(sketch: Sketch, ids: EntityId[], delta: Vec2): Sketch {
  return transformInPlace(sketch, ids, (p) => add2(p, delta), 1);
}

/**
 * Scale the entities about `origin`. Radii scale with |factor|. Driving dimensions are left
 * untouched, so the solver may pull dimensioned geometry back.
 */
export function scaleEntities(
  sketch: Sketch,
  ids: EntityId[],
  origin: Vec2,
  factor: number,
): Sketch {
  return transformInPlace(
    sketch,
    ids,
    (p) => add2(origin, scale2(sub2(p, origin), factor)),
    Math.abs(factor),
  );
}

interface Transform {
  apply: (p: Vec2) => Vec2;
  /** Orientation reversing (mirror): arcs swap start / end, angle dimensions swap their refs. */
  mirror: boolean;
}

/**
 * Deep-copy entities through a rigid transform into `b`. Points are duplicated once, so points
 * shared in the source stay shared in the copy. Constraints and dimensions of `source` whose
 * refs are all inside the copied set are copied too, except `fix` and, when the transform does
 * not preserve the X / Y directions, horizontal / vertical constraints and dimensions.
 */
function duplicateInto(
  b: SketchBuilder,
  source: Sketch,
  ids: EntityId[],
  xf: Transform,
  share: (pointId: EntityId) => boolean = () => false,
): { created: EntityId[]; map: Map<EntityId, EntityId> } {
  const entities = existing(source, ids);
  const map = new Map<EntityId, EntityId>();
  for (const p of pointsOf(entities)) {
    const e = source.entities[p];
    if (e?.type !== "point") continue;
    if (share(p)) {
      map.set(p, p);
      continue;
    }
    const q = xf.apply(e);
    map.set(p, b.point(q.x, q.y, e.construction === true));
  }
  const m = (id: EntityId): EntityId => {
    const to = map.get(id);
    if (to === undefined) throw new Error(`Sketch point not found: ${id}`);
    return to;
  };
  const created: EntityId[] = [];
  for (const e of entities) {
    const c = e.construction === true;
    let id: EntityId;
    switch (e.type) {
      case "point":
        id = m(e.id);
        break;
      case "line":
        id = b.line(m(e.p1), m(e.p2), c);
        break;
      case "circle":
        id = b.circle(m(e.center), e.radius, c);
        break;
      case "arc":
        id = xf.mirror
          ? b.arc(m(e.center), m(e.end), m(e.start), c)
          : b.arc(m(e.center), m(e.start), m(e.end), c);
        break;
      case "ellipse":
        id = b.ellipse(m(e.center), m(e.majorPoint), e.minorRadius, c);
        break;
      case "spline":
        id = b.spline(e.kind, e.points.map(m), e.closed, c);
        break;
    }
    map.set(e.id, id);
    created.push(id);
  }

  const o = xf.apply({ x: 0, y: 0 });
  const keepsAxes = Math.abs(xf.apply({ x: 1, y: 0 }).y - o.y) < 1e-9;
  const mapped = (refs: EntityId[]): EntityId[] | null => {
    const out: EntityId[] = [];
    for (const r of refs) {
      const to = map.get(r);
      if (to === undefined) return null;
      out.push(to);
    }
    return out.every((r, i) => r === refs[i]) ? null : out;
  };
  for (const k of Object.values(source.constraints)) {
    if (k.type === "fix") continue;
    if (!keepsAxes && (k.type === "horizontal" || k.type === "vertical")) continue;
    const refs = mapped(k.refs);
    if (refs) b.constrain(k.type, ...refs);
  }
  for (const d of Object.values(source.dimensions)) {
    if (!keepsAxes && (d.type === "hdistance" || d.type === "vdistance")) continue;
    const refs = mapped(d.refs);
    if (!refs) continue;
    if (xf.mirror && d.type === "angle") refs.reverse();
    b.dimension(d.type, refs, d.expression, { driving: d.driving });
  }
  return { created, map };
}

const asRecord = (map: Map<EntityId, EntityId>): Record<EntityId, EntityId> =>
  Object.fromEntries(map);

/** Translated deep copy. */
export function copyEntities(sketch: Sketch, ids: EntityId[], delta: Vec2): CopyResult {
  const b = new SketchBuilder(sketch);
  const { created, map } = duplicateInto(b, sketch, ids, {
    apply: (p) => add2(p, delta),
    mirror: false,
  });
  return { sketch: b.build(), created, map: asRecord(map) };
}

/**
 * Mirrored copy across the (infinite) line `axisLineId`. Arcs stay counter-clockwise by
 * swapping start and end. Points lying on the axis are shared between original and copy, which
 * closes half profiles. With `symmetryConstraints`, every duplicated point gets a `symmetry`
 * constraint `[original, mirrored, axis]`. The axis itself is never copied.
 */
export function mirrorEntities(
  sketch: Sketch,
  ids: EntityId[],
  axisLineId: EntityId,
  options: { symmetryConstraints?: boolean } = {},
): CopyResult {
  const axis = sketch.entities[axisLineId];
  if (axis?.type !== "line") throw new Error("Mirror axis must be a line");
  const a = getPoint(sketch, axis.p1);
  const d = sub2(getPoint(sketch, axis.p2), a);
  const l2 = dot2(d, d);
  if (l2 < 1e-24) throw new Error("Mirror axis has zero length");
  const reflect = (p: Vec2): Vec2 => {
    const foot = add2(a, scale2(d, dot2(sub2(p, a), d) / l2));
    return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
  };
  const onAxis = (id: EntityId): boolean => {
    const p = getPoint(sketch, id);
    return Math.abs(cross2(sub2(p, a), d)) / Math.sqrt(l2) < 1e-9;
  };
  const b = new SketchBuilder(sketch);
  const { created, map } = duplicateInto(
    b,
    sketch,
    ids.filter((id) => id !== axisLineId),
    { apply: reflect, mirror: true },
    onAxis,
  );
  if (options.symmetryConstraints) {
    for (const [from, to] of map) {
      if (from !== to && sketch.entities[from]?.type === "point") {
        b.constrain("symmetry", from, to, axisLineId);
      }
    }
  }
  return { sketch: b.build(), created, map: asRecord(map) };
}

/**
 * Grid of copies: instance (i, j) is translated by `i·dx + j·dy`; instance (0, 0) is the
 * original. `created` lists the copies instance by instance.
 */
export function rectangularPattern(
  sketch: Sketch,
  ids: EntityId[],
  options: { dx: Vec2; countX: number; dy?: Vec2; countY?: number },
): ModifyResult {
  const countX = Math.max(1, Math.floor(options.countX));
  const countY = options.dy ? Math.max(1, Math.floor(options.countY ?? 1)) : 1;
  const dy = options.dy ?? { x: 0, y: 0 };
  const b = new SketchBuilder(sketch);
  const created: EntityId[] = [];
  for (let j = 0; j < countY; j++) {
    for (let i = 0; i < countX; i++) {
      if (i === 0 && j === 0) continue;
      const delta = add2(scale2(options.dx, i), scale2(dy, j));
      const copy = duplicateInto(b, sketch, ids, { apply: (p) => add2(p, delta), mirror: false });
      created.push(...copy.created);
    }
  }
  return { sketch: b.build(), created };
}

/**
 * `count` instances (including the original) rotated about `center`. A full turn (default) is
 * divided into `count` steps; any other `totalAngle` spans from the first to the last instance.
 */
export function circularPattern(
  sketch: Sketch,
  ids: EntityId[],
  options: { center: Vec2; count: number; totalAngle?: number },
): ModifyResult {
  const count = Math.max(1, Math.floor(options.count));
  const total = options.totalAngle ?? 2 * Math.PI;
  const full = Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-9;
  const step = full ? total / count : count > 1 ? total / (count - 1) : 0;
  const b = new SketchBuilder(sketch);
  const created: EntityId[] = [];
  for (let i = 1; i < count; i++) {
    const copy = duplicateInto(b, sketch, ids, {
      apply: (p) => rotate2(p, step * i, options.center),
      mirror: false,
    });
    created.push(...copy.created);
  }
  return { sketch: b.build(), created };
}

/** Flip the construction flag of every listed entity. */
export function toggleConstruction(sketch: Sketch, ids: EntityId[]): Sketch {
  const entities = { ...sketch.entities };
  for (const e of existing(sketch, ids)) {
    const { construction, ...rest } = e;
    entities[e.id] = (construction ? rest : { ...rest, construction: true }) as SketchEntity;
  }
  return { ...sketch, entities };
}

// ---------------------------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------------------------

type OffsetGeom = { type: "line"; p: Vec2; d: Vec2 } | { type: "circle"; c: Vec2; r: number };

function lineCircle(l: { p: Vec2; d: Vec2 }, c: Vec2, r: number): Vec2[] {
  const f = sub2(l.p, c);
  const bq = dot2(f, l.d);
  const disc = bq * bq - (dot2(f, f) - r * r);
  if (disc < -1e-9 * Math.max(1, r * r)) return [];
  const s = Math.sqrt(Math.max(0, disc));
  return [add2(l.p, scale2(l.d, -bq - s)), add2(l.p, scale2(l.d, -bq + s))];
}

function circleCircle(c0: Vec2, r0: number, c1: Vec2, r1: number): Vec2[] {
  const d = dist2(c0, c1);
  if (d < 1e-12 || d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return [];
  const x = (d * d + r0 * r0 - r1 * r1) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - x * x));
  const dir = scale2(sub2(c1, c0), 1 / d);
  const base = add2(c0, scale2(dir, x));
  const n = perp2(dir);
  return [add2(base, scale2(n, h)), sub2(base, scale2(n, h))];
}

function meet(a: OffsetGeom, b: OffsetGeom): Vec2[] {
  if (a.type === "line" && b.type === "line") {
    const hit = intersectLines(a.p, a.d, b.p, b.d);
    return hit ? [hit] : [];
  }
  if (a.type === "line" && b.type === "circle") return lineCircle(a, b.c, b.r);
  if (a.type === "circle" && b.type === "line") return lineCircle(b, a.c, a.r);
  if (a.type === "circle" && b.type === "circle") return circleCircle(a.c, a.r, b.c, b.r);
  return [];
}

interface ChainSeg {
  e: LineEntity | ArcEntity;
  /** Node index of the natural start (line p1 / arc start) and end. */
  n0: number;
  n1: number;
}

/**
 * Offset a connected chain or closed loop of lines and arcs (and stand-alone circles).
 *
 * Sign convention: positive `distance` offsets to the RIGHT of the travel direction.
 * - Closed loops are always traversed counter-clockwise, so positive = outward (the loop
 *   grows), negative = inward.
 * - Open chains are traversed starting from the end entity that comes first in `ids`, beginning
 *   at its free end; a single line runs p1→p2 and a single arc start→end (CCW).
 * - Circles and CCW arcs therefore grow for positive distances.
 *
 * Neighbouring offsets are re-intersected (miter join) and share their points. The new curves
 * get `parallel` (lines) or `concentric` (arcs, circles) constraints to their sources.
 * Throws for branching chains and offsets that collapse an arc or circle.
 */
export function offsetEntities(sketch: Sketch, ids: EntityId[], distance: number): ModifyResult {
  const b = new SketchBuilder(sketch);
  const created: EntityId[] = [];
  const nodePos: Vec2[] = [];
  const nodeOfPoint = new Map<EntityId, number>();
  const nodeFor = (pointId: EntityId): number => {
    const known = nodeOfPoint.get(pointId);
    if (known !== undefined) return known;
    const p = getPoint(sketch, pointId);
    let n = nodePos.findIndex((q) => dist2(p, q) <= 1e-6);
    if (n < 0) n = nodePos.push(p) - 1;
    nodeOfPoint.set(pointId, n);
    return n;
  };

  const segs: ChainSeg[] = [];
  for (const e of existing(sketch, ids)) {
    if (e.type === "circle") {
      const r = e.radius + distance;
      if (!(r > 1e-9)) throw new Error("Offset collapses a circle");
      const c = getPoint(sketch, e.center);
      const id = b.circle(b.point(c.x, c.y), r, e.construction === true);
      b.constrain("concentric", e.id, id);
      created.push(id);
    } else if (e.type === "line") {
      segs.push({ e, n0: nodeFor(e.p1), n1: nodeFor(e.p2) });
    } else if (e.type === "arc") {
      segs.push({ e, n0: nodeFor(e.start), n1: nodeFor(e.end) });
    }
  }

  const atNode = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (const n of s.n0 === s.n1 ? [s.n0] : [s.n0, s.n1]) {
      const list = atNode.get(n) ?? [];
      list.push(i);
      atNode.set(n, list);
    }
  });
  for (const list of atNode.values()) {
    if (list.length > 2) throw new Error("Cannot offset a branching chain");
  }

  const curveOf = (s: ChainSeg): Curve2 => entityToCurves(sketch, s.e)[0]!;
  const used = new Array<boolean>(segs.length).fill(false);
  for (let first = 0; first < segs.length; first++) {
    if (used[first]) continue;
    // Walk back to a free end (open chain) or around to `first` again (closed loop).
    let start = first;
    let entry = segs[first]!.n0;
    let closed = false;
    for (;;) {
      const prev = (atNode.get(entry) ?? []).find((i) => i !== start);
      if (prev === undefined) break;
      if (prev === first) {
        closed = true;
        break;
      }
      start = prev;
      entry = segs[prev]!.n0 === entry ? segs[prev]!.n1 : segs[prev]!.n0;
    }
    if (closed) {
      start = first;
      entry = segs[first]!.n0;
    } else {
      // Collect the chain once to find both end entities; start at the one earlier in `ids`.
      let cur = start;
      let node = entry;
      for (;;) {
        const s = segs[cur]!;
        const exit = s.n0 === node ? s.n1 : s.n0;
        const next = (atNode.get(exit) ?? []).find((i) => i !== cur);
        if (next === undefined) {
          if (cur < start) {
            start = cur;
            entry = exit;
          }
          break;
        }
        cur = next;
        node = exit;
      }
    }

    let chain: { seg: ChainSeg; reversed: boolean }[] = [];
    {
      let cur = start;
      let node = entry;
      for (;;) {
        const s = segs[cur]!;
        used[cur] = true;
        const reversed = s.n0 !== node;
        chain.push({ seg: s, reversed });
        const exit = reversed ? s.n0 : s.n1;
        const next = (atNode.get(exit) ?? []).find((i) => i !== cur && !used[i]);
        if (next === undefined) break;
        cur = next;
        node = exit;
      }
    }
    if (closed) {
      let area = 0;
      for (const { seg, reversed } of chain) {
        const c = curveOf(seg);
        const s = curveStart(c);
        const t = curveEnd(c);
        const part =
          c.type === "arc"
            ? (c.radius * c.radius * c.sweep + cross2(c.center, sub2(t, s))) / 2
            : cross2(s, t) / 2;
        area += reversed ? -part : part;
      }
      if (area < 0) {
        chain = chain.reverse().map((c) => ({ seg: c.seg, reversed: !c.reversed }));
      }
    }

    const geoms = chain.map(({ seg, reversed }): OffsetGeom => {
      const c = curveOf(seg);
      if (c.type === "arc") {
        const r = c.radius + (reversed ? -distance : distance);
        if (!(r > 1e-9)) throw new Error("Offset collapses an arc");
        return { type: "circle", c: c.center, r };
      }
      const from = reversed ? curveEnd(c) : curveStart(c);
      const to = reversed ? curveStart(c) : curveEnd(c);
      const d = norm2(sub2(to, from));
      return { type: "line", p: add2(from, scale2({ x: d.y, y: -d.x }, distance)), d };
    });
    /** Offset image of a point of the source segment. */
    const project = (g: OffsetGeom, v: Vec2): Vec2 =>
      g.type === "line"
        ? add2(g.p, scale2(g.d, dot2(sub2(v, g.p), g.d)))
        : add2(g.c, scale2(norm2(sub2(v, g.c)), g.r));
    const vertexAfter = (i: number): Vec2 => {
      const { seg, reversed } = chain[i]!;
      return nodePos[reversed ? seg.n0 : seg.n1]!;
    };
    const vertexBefore = (i: number): Vec2 => {
      const { seg, reversed } = chain[i]!;
      return nodePos[reversed ? seg.n1 : seg.n0]!;
    };
    const join = (i: number, j: number): EntityId => {
      const v = vertexAfter(i);
      const target = project(geoms[i]!, v);
      let best: Vec2 | null = null;
      for (const p of meet(geoms[i]!, geoms[j]!)) {
        if (!best || dist2(p, target) < dist2(best, target)) best = p;
      }
      const p = best ?? target;
      return b.point(p.x, p.y);
    };

    const n = chain.length;
    const startPts: EntityId[] = [];
    const endPts: EntityId[] = [];
    for (let i = 0; i < n; i++) {
      if (i + 1 < n) {
        const p = join(i, i + 1);
        endPts[i] = p;
        startPts[i + 1] = p;
      }
    }
    if (closed && n > 1) {
      const p = join(n - 1, 0);
      endPts[n - 1] = p;
      startPts[0] = p;
    } else {
      const s = project(geoms[0]!, vertexBefore(0));
      startPts[0] = b.point(s.x, s.y);
      if (closed) {
        endPts[0] = startPts[0]!;
      } else {
        const t = project(geoms[n - 1]!, vertexAfter(n - 1));
        endPts[n - 1] = b.point(t.x, t.y);
      }
    }
    chain.forEach(({ seg, reversed }, i) => {
      const from = reversed ? endPts[i]! : startPts[i]!;
      const to = reversed ? startPts[i]! : endPts[i]!;
      const construction = seg.e.construction === true;
      if (seg.e.type === "line") {
        const id = b.line(from, to, construction);
        b.constrain("parallel", seg.e.id, id);
        created.push(id);
      } else {
        const c = getPoint(sketch, seg.e.center);
        const id = b.arc(b.point(c.x, c.y), from, to, construction);
        b.constrain("concentric", seg.e.id, id);
        created.push(id);
      }
    });
  }
  return { sketch: b.build(), created };
}

// ---------------------------------------------------------------------------------------------
// Trim / Extend / Break
// ---------------------------------------------------------------------------------------------

type Cuttable = LineEntity | ArcEntity | CircleEntity;

const isCuttable = (e: SketchEntity | undefined): e is Cuttable =>
  e?.type === "line" || e?.type === "arc" || e?.type === "circle";

interface Hit {
  t: number;
  point: Vec2;
  cutter: EntityId;
}

/** Intersections of `curve` with all other non-construction curves, sorted along the curve. */
function findHits(sketch: Sketch, exclude: EntityId, curve: Curve2): Hit[] {
  const hits: Hit[] = [];
  for (const e of Object.values(sketch.entities)) {
    if (!isCurve(e) || e.construction || e.id === exclude) continue;
    let others: Curve2[];
    try {
      others = entityToCurves(sketch, e);
    } catch {
      continue;
    }
    for (const other of others) {
      for (const hit of intersectCurves(curve, other)) {
        hits.push({ t: hit.ta, point: hit.point, cutter: e.id });
      }
    }
  }
  hits.sort((a, b) => a.t - b.t);
  const out: Hit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (!last || dist2(last.point, h.point) > TOL) out.push(h);
  }
  return out;
}

function dropIfOrphan(b: SketchBuilder, pointId: EntityId): void {
  const usedBy = Object.values(b.current.entities).some(
    (e) => e.type !== "point" && entityPointIds(e).includes(pointId),
  );
  if (!usedBy) b.remove([pointId]);
}

interface Kept {
  id: EntityId;
  /** Parameter range on the original curve; `t0 > t1` wraps around a closed curve. */
  t0: number;
  t1: number;
}

/**
 * After `entityId` was cut into `pieces`: move point-on-curve constraints to the piece the point
 * lies on (or drop them), and drop what lost its meaning (midpoint, equal length, length
 * dimensions of a line).
 */
function fixRefsAfterCut(
  b: SketchBuilder,
  original: Curve2,
  entityId: EntityId,
  pieces: Kept[],
): void {
  const isLine = original.type === "line";
  const eps = 1e-6;
  const pieceAt = (t: number): Kept | undefined =>
    pieces.find((k) =>
      k.t0 <= k.t1 ? t >= k.t0 - eps && t <= k.t1 + eps : t >= k.t0 - eps || t <= k.t1 + eps,
    );
  for (const k of Object.values(b.current.constraints)) {
    if (!k.refs.includes(entityId)) continue;
    if (k.type === "midpoint" || (k.type === "equal" && isLine)) {
      b.removeConstraint(k.id);
      continue;
    }
    if (k.type !== "coincident" || k.refs[1] !== entityId) continue;
    const p = b.current.entities[k.refs[0] ?? ""];
    if (p?.type !== "point") continue;
    const piece = pieceAt(closestParam(original, p));
    if (piece?.id === entityId) continue;
    b.removeConstraint(k.id);
    if (piece) b.constrain("coincident", p.id, piece.id);
  }
  if (!isLine) return;
  for (const d of Object.values(b.current.dimensions)) {
    const lengthLike = d.type === "distance" || d.type === "hdistance" || d.type === "vdistance";
    if (lengthLike && d.refs.length === 1 && d.refs[0] === entityId) b.removeDimension(d.id);
  }
}

/**
 * Replace a circle by an arc (CCW from `start` to `end`) around the same center point, moving
 * all constraints and dimensions of the circle over to the arc. Returns the arc id.
 */
function circleToArc(
  b: SketchBuilder,
  circle: CircleEntity,
  start: EntityId,
  end: EntityId,
): EntityId {
  const arc = b.arc(circle.center, start, end, circle.construction === true);
  const swap = (refs: EntityId[]): EntityId[] => refs.map((r) => (r === circle.id ? arc : r));
  for (const k of Object.values(b.current.constraints)) {
    if (k.refs.includes(circle.id)) b.constrain(k.type, ...swap(k.refs));
  }
  for (const d of Object.values(b.current.dimensions)) {
    if (!d.refs.includes(circle.id)) continue;
    const options: { driving: boolean; labelPosition?: Vec2 } = { driving: d.driving };
    if (d.labelPosition) options.labelPosition = d.labelPosition;
    b.dimension(d.type, swap(d.refs), d.expression, options);
  }
  b.remove([circle.id]);
  return arc;
}

const endIds = (e: LineEntity | ArcEntity): { s: EntityId; t: EntityId } =>
  e.type === "line" ? { s: e.p1, t: e.p2 } : { s: e.start, t: e.end };

function setEnd(
  b: SketchBuilder,
  e: LineEntity | ArcEntity,
  which: "s" | "t",
  point: EntityId,
): void {
  if (e.type === "line") {
    b.updateEntity<LineEntity>(e.id, which === "s" ? { p1: point } : { p2: point });
  } else {
    b.updateEntity<ArcEntity>(e.id, which === "s" ? { start: point } : { end: point });
  }
}

/** Second piece of a split line / arc, from `from` to the original end. */
function addTail(b: SketchBuilder, e: LineEntity | ArcEntity, from: EntityId): EntityId {
  const construction = e.construction === true;
  if (e.type === "line") {
    const id = b.line(from, e.p2, construction);
    b.constrain("collinear", e.id, id);
    return id;
  }
  const id = b.arc(e.center, from, e.end, construction);
  b.constrain("equal", e.id, id);
  return id;
}

/**
 * Fusion-style trim: removes the part of the entity under `pick`, bounded by the nearest
 * intersections with other non-construction curves on either side (or by the curve's end).
 * New end points are created at the intersections and constrained onto the cutting curve.
 * A trimmed circle becomes an arc (constraints and dimensions carry over). Without any usable
 * intersection the entity is deleted. When a middle part is removed, the original id keeps the
 * first piece and a new entity (collinear / equal radius) is created for the second.
 */
export function trimCurve(sketch: Sketch, entityId: EntityId, pick: Vec2): Sketch {
  const e = sketch.entities[entityId];
  if (!isCuttable(e)) return sketch;
  const curve = entityToCurves(sketch, e)[0];
  if (!curve) return sketch;
  const b = new SketchBuilder(sketch);
  const hits = findHits(sketch, entityId, curve);
  const tPick = closestParam(curve, pick);
  const pointAt = (h: Hit): EntityId => {
    const id = b.point(h.point.x, h.point.y);
    b.constrain("coincident", id, h.cutter);
    return id;
  };

  if (e.type === "circle") {
    const first = hits[0];
    const last = hits[hits.length - 1];
    if (hits.length > 1 && first && last && dist2(first.point, last.point) <= TOL) hits.pop();
    if (hits.length < 2) {
      b.remove([entityId]);
      return b.build();
    }
    let upperIndex = hits.findIndex((h) => h.t > tPick);
    if (upperIndex < 0) upperIndex = 0;
    const upper = hits[upperIndex]!;
    const lower = hits[(upperIndex - 1 + hits.length) % hits.length]!;
    const arc = circleToArc(b, e, pointAt(upper), pointAt(lower));
    fixRefsAfterCut(b, curve, arc, [{ id: arc, t0: upper.t, t1: lower.t }]);
    return b.build();
  }

  const start = curveStart(curve);
  const end = curveEnd(curve);
  const inner = hits.filter((h) => dist2(h.point, start) > TOL && dist2(h.point, end) > TOL);
  let lower: Hit | undefined;
  let upper: Hit | undefined;
  for (const h of inner) {
    if (h.t <= tPick) lower = h;
    else if (!upper) upper = h;
  }
  if (!lower && !upper) {
    b.remove([entityId]);
    return b.build();
  }
  const ends = endIds(e);
  const pieces: Kept[] = [];
  if (lower && upper) {
    const p1 = pointAt(lower);
    const p2 = pointAt(upper);
    const tail = addTail(b, e, p2);
    setEnd(b, e, "t", p1);
    pieces.push({ id: entityId, t0: 0, t1: lower.t }, { id: tail, t0: upper.t, t1: 1 });
  } else if (lower) {
    setEnd(b, e, "t", pointAt(lower));
    dropIfOrphan(b, ends.t);
    pieces.push({ id: entityId, t0: 0, t1: lower.t });
  } else if (upper) {
    setEnd(b, e, "s", pointAt(upper));
    dropIfOrphan(b, ends.s);
    pieces.push({ id: entityId, t0: upper.t, t1: 1 });
  }
  fixRefsAfterCut(b, curve, entityId, pieces);
  return b.build();
}

/**
 * Extend the end of a line or arc nearest to `pick` until the first intersection with another
 * non-construction curve; the end point gets a point-on-curve `coincident` constraint. An end
 * point shared with other curves is left alone and replaced by a new point. Returns the sketch
 * unchanged when nothing is hit.
 */
export function extendCurve(sketch: Sketch, entityId: EntityId, pick: Vec2): Sketch {
  const e = sketch.entities[entityId];
  if (e?.type !== "line" && e?.type !== "arc") return sketch;
  const curve = entityToCurves(sketch, e)[0];
  if (!curve) return sketch;
  const start = curveStart(curve);
  const end = curveEnd(curve);
  const atEnd = dist2(pick, end) <= dist2(pick, start);
  const from = atEnd ? end : start;

  let probe: Curve2;
  if (curve.type === "line") {
    let reach = dist2(start, end);
    for (const p of Object.values(sketch.entities)) {
      if (p.type === "point") reach = Math.max(reach, dist2(p, from));
      else if (p.type === "circle") reach += p.radius * 2;
      else if (p.type === "ellipse") reach += p.minorRadius * 2;
    }
    const dir = norm2(atEnd ? sub2(end, start) : sub2(start, end));
    probe = { type: "line", a: from, b: add2(from, scale2(dir, reach * 4 + 1)) };
  } else if (curve.type === "arc") {
    const rest = 2 * Math.PI - Math.abs(curve.sweep);
    if (rest < 1e-9) return sketch;
    probe = atEnd
      ? { ...curve, startAngle: curve.startAngle + curve.sweep, sweep: rest }
      : { ...curve, sweep: -rest };
  } else {
    return sketch;
  }
  const hit = findHits(sketch, entityId, probe).find((h) => dist2(h.point, from) > TOL);
  if (!hit) return sketch;

  const b = new SketchBuilder(sketch);
  const ends = endIds(e);
  const pointId = atEnd ? ends.t : ends.s;
  const shared =
    Object.values(sketch.entities).some(
      (o) => o.type !== "point" && o.id !== entityId && entityPointIds(o).includes(pointId),
    ) ||
    (e.type === "arc" && ends.s === ends.t);
  let target = pointId;
  if (shared) {
    target = b.point(hit.point.x, hit.point.y);
    setEnd(b, e, atEnd ? "t" : "s", target);
  } else {
    b.movePoint(pointId, hit.point);
  }
  b.constrain("coincident", target, hit.cutter);
  if (e.type === "line") {
    for (const d of Object.values(b.current.dimensions)) {
      const lengthLike = d.type === "distance" || d.type === "hdistance" || d.type === "vdistance";
      if (lengthLike && d.refs.length === 1 && d.refs[0] === entityId) b.removeDimension(d.id);
    }
    for (const k of Object.values(b.current.constraints)) {
      if ((k.type === "equal" || k.type === "midpoint") && k.refs.includes(entityId)) {
        b.removeConstraint(k.id);
      }
    }
  }
  return b.build();
}

/**
 * Split a line, arc or circle at the point closest to `at`. Lines and arcs keep their id for
 * the first piece and `created` holds the second piece (sharing the new point). A circle is
 * replaced by two arcs split at the pick and at the diametrically opposite point; both are
 * listed in `created`. Breaking at an end point is a no-op.
 */
export function breakCurve(sketch: Sketch, entityId: EntityId, at: Vec2): ModifyResult {
  const e = sketch.entities[entityId];
  if (!isCuttable(e)) return { sketch, created: [] };
  const curve = entityToCurves(sketch, e)[0];
  if (!curve) return { sketch, created: [] };
  const t = closestParam(curve, at);
  const p = curvePointAt(curve, t);
  const b = new SketchBuilder(sketch);

  if (e.type === "circle") {
    const t2 = (t + 0.5) % 1;
    const q = curvePointAt(curve, t2);
    const a = b.point(p.x, p.y);
    const c = b.point(q.x, q.y);
    const second = b.arc(e.center, c, a, e.construction === true);
    const first = circleToArc(b, e, a, c);
    b.constrain("equal", first, second);
    fixRefsAfterCut(b, curve, first, [
      { id: first, t0: t, t1: t2 },
      { id: second, t0: t2, t1: t },
    ]);
    return { sketch: b.build(), created: [first, second] };
  }

  if (dist2(p, curveStart(curve)) <= TOL || dist2(p, curveEnd(curve)) <= TOL) {
    return { sketch, created: [] };
  }
  const mid = b.point(p.x, p.y);
  const tail = addTail(b, e, mid);
  setEnd(b, e, "t", mid);
  fixRefsAfterCut(b, curve, entityId, [
    { id: entityId, t0: 0, t1: t },
    { id: tail, t0: t, t1: 1 },
  ]);
  return { sketch: b.build(), created: [tail] };
}

// ---------------------------------------------------------------------------------------------
// Fillet / Chamfer
// ---------------------------------------------------------------------------------------------

interface Corner {
  a: LineEntity;
  b: LineEntity;
  /** Corner point id on each line (identical when the point is shared). */
  cornerA: EntityId;
  cornerB: EntityId;
  farA: EntityId;
  farB: EntityId;
  v: Vec2;
  /** Unit directions from the corner along each line. */
  u: Vec2;
  w: Vec2;
  lengthA: number;
  lengthB: number;
  /** Angle between the two lines at the corner, in (0, π). */
  angle: number;
}

function findCorner(sketch: Sketch, lineA: EntityId, lineB: EntityId): Corner {
  const a = sketch.entities[lineA];
  const b = sketch.entities[lineB];
  if (a?.type !== "line" || b?.type !== "line" || lineA === lineB) {
    throw new Error("Fillet / chamfer needs two different lines");
  }
  const combos: [EntityId, EntityId, EntityId, EntityId][] = [
    [a.p1, a.p2, b.p1, b.p2],
    [a.p1, a.p2, b.p2, b.p1],
    [a.p2, a.p1, b.p1, b.p2],
    [a.p2, a.p1, b.p2, b.p1],
  ];
  const match =
    combos.find(([ca, , cb]) => ca === cb) ??
    combos.find(([ca, , cb]) => dist2(getPoint(sketch, ca), getPoint(sketch, cb)) <= 1e-6);
  if (!match) throw new Error("The lines do not meet at a common end point");
  const [cornerA, farA, cornerB, farB] = match;
  const v = getPoint(sketch, cornerA);
  const da = sub2(getPoint(sketch, farA), v);
  const db = sub2(getPoint(sketch, farB), v);
  const u = norm2(da);
  const w = norm2(db);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot2(u, w))));
  if (angle < 1e-6 || angle > Math.PI - 1e-6) throw new Error("The lines are parallel");
  return {
    a,
    b,
    cornerA,
    cornerB,
    farA,
    farB,
    v,
    u,
    w,
    lengthA: Math.hypot(da.x, da.y),
    lengthB: Math.hypot(db.x, db.y),
    angle,
  };
}

/**
 * Shorten both lines by `setback` from the corner. Length dimensions of the lines are kept
 * meaningful by re-targeting them to [far end, original corner point]; in that case the corner
 * point stays as a free point constrained onto both lines. Returns the new end points.
 */
function cutCorner(
  sketch: Sketch,
  corner: Corner,
  setback: number,
  finish: (b: SketchBuilder, pa: EntityId, pb: EntityId) => EntityId,
): ModifyResult {
  if (!(setback > 1e-9)) throw new Error("Fillet / chamfer size must be positive");
  if (setback > corner.lengthA - 1e-9 || setback > corner.lengthB - 1e-9) {
    throw new Error("Fillet / chamfer is too large for the lines");
  }
  const b = new SketchBuilder(sketch);
  const qa = add2(corner.v, scale2(corner.u, setback));
  const qb = add2(corner.v, scale2(corner.w, setback));
  const pa = b.point(qa.x, qa.y);
  const pb = b.point(qb.x, qb.y);
  b.updateEntity<LineEntity>(corner.a.id, corner.a.p1 === corner.cornerA ? { p1: pa } : { p2: pa });
  b.updateEntity<LineEntity>(corner.b.id, corner.b.p1 === corner.cornerB ? { p1: pb } : { p2: pb });
  const created = finish(b, pa, pb);

  const retargeted = new Map<string, EntityId[]>();
  const sides = [
    { line: corner.a.id, far: corner.farA, corner: corner.cornerA },
    { line: corner.b.id, far: corner.farB, corner: corner.cornerB },
  ];
  for (const side of sides) {
    for (const k of Object.values(b.current.constraints)) {
      if ((k.type === "equal" || k.type === "midpoint") && k.refs.includes(side.line)) {
        b.removeConstraint(k.id);
      }
    }
    let keep = false;
    for (const d of Object.values(b.current.dimensions)) {
      const lengthLike = d.type === "distance" || d.type === "hdistance" || d.type === "vdistance";
      if (!lengthLike || d.refs.length !== 1 || d.refs[0] !== side.line) continue;
      retargeted.set(d.id, [side.far, side.corner]);
      keep = true;
    }
    if (keep) b.constrain("coincident", side.corner, side.line);
  }
  for (const side of sides) {
    const kept = [...retargeted.values()].some((refs) => refs.includes(side.corner));
    if (!kept && b.current.entities[side.corner]) dropIfOrphan(b, side.corner);
  }
  const built = b.build();
  const dimensions: Record<string, SketchDimension> = { ...built.dimensions };
  for (const [id, refs] of retargeted) {
    const d = dimensions[id];
    if (d) dimensions[id] = { ...d, refs };
  }
  return { sketch: { ...built, dimensions }, created: [created] };
}

/**
 * Round the corner between two lines that meet at a shared (or coincident) end point: both
 * lines are shortened and a tangent arc of the given radius is inserted, with `tangent`
 * constraints to both lines. `created` = [arc].
 */
export function sketchFillet(
  sketch: Sketch,
  lineA: EntityId,
  lineB: EntityId,
  radius: number,
): ModifyResult {
  if (!(radius > 0)) throw new Error("Fillet radius must be positive");
  const corner = findCorner(sketch, lineA, lineB);
  const half = corner.angle / 2;
  const setback = radius / Math.tan(half);
  const center = add2(corner.v, scale2(norm2(add2(corner.u, corner.w)), radius / Math.sin(half)));
  return cutCorner(sketch, corner, setback, (b, pa, pb) => {
    const ta = getPoint(b.current, pa);
    const tb = getPoint(b.current, pb);
    const sweep = normalizeAngle(
      Math.atan2(tb.y - center.y, tb.x - center.x) - Math.atan2(ta.y - center.y, ta.x - center.x),
    );
    const c = b.point(center.x, center.y);
    const arc = sweep < Math.PI ? b.arc(c, pa, pb) : b.arc(c, pb, pa);
    b.constrain("tangent", lineA, arc);
    b.constrain("tangent", lineB, arc);
    return arc;
  });
}

/**
 * Cut the corner between two lines with a straight line starting `distance` from the corner on
 * both lines. `created` = [chamfer line].
 */
export function sketchChamfer(
  sketch: Sketch,
  lineA: EntityId,
  lineB: EntityId,
  distance: number,
): ModifyResult {
  const corner = findCorner(sketch, lineA, lineB);
  return cutCorner(sketch, corner, distance, (b, pa, pb) => b.line(pa, pb));
}

export interface SketchModifyToolDescriptor {
  id: string;
  label: string;
  group: "modify";
  description: string;
}

const tool = (id: string, label: string, description: string): SketchModifyToolDescriptor => ({
  id,
  label,
  group: "modify",
  description,
});

/** Registry of the modify tools so a UI can build its toolbar generically. */
export const SKETCH_MODIFY_TOOLS: SketchModifyToolDescriptor[] = [
  tool("fillet", "Fillet", "Round a corner between two lines with a tangent arc"),
  tool("chamfer", "Chamfer", "Cut a corner between two lines with a straight line"),
  tool("trim", "Trim", "Remove the part of a curve up to its nearest intersections"),
  tool("extend", "Extend", "Extend a curve to the next intersection"),
  tool("break", "Break", "Split a curve into two at a point"),
  tool("offset", "Offset", "Offset a chain of curves by a distance"),
  tool("move", "Move", "Translate the selected entities"),
  tool("copy", "Copy", "Duplicate the selected entities"),
  tool("scale", "Scale", "Scale the selected entities about a point"),
  tool("mirror", "Mirror", "Mirror the selected entities across a line"),
  tool("rectangular-pattern", "Rectangular Pattern", "Repeat entities on a grid"),
  tool("circular-pattern", "Circular Pattern", "Repeat entities around a center"),
  tool("toggle-construction", "Normal / Construction", "Toggle construction geometry"),
];
