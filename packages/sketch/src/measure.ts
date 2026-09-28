import {
  type Bounds2,
  type Curve2,
  type Vec2,
  add2,
  closestParam,
  cross2,
  curveBounds,
  curvePointAt,
  dist2,
  dot2,
  emptyBounds2,
  expandBounds2,
  intersectLines,
  lerp2,
  norm2,
  normalizeAngle,
  perp2,
  radToDeg,
  scale2,
  sub2,
  unionBounds2,
} from "@fabcad/geometry";
import type {
  ArcEntity,
  CircleEntity,
  EntityId,
  PointEntity,
  Sketch,
  SketchDimension,
  SketchEntityType,
} from "./model";
import { entityToCurves } from "./curves";

/** Measurement, hit testing and snapping helpers. Pure functions over sketch data. */

interface Segment {
  a: Vec2;
  b: Vec2;
}

function pointOf(sketch: Sketch, id: EntityId | undefined): Vec2 | null {
  const e = id === undefined ? undefined : sketch.entities[id];
  return e?.type === "point" ? { x: e.x, y: e.y } : null;
}

function segmentOf(sketch: Sketch, id: EntityId | undefined): Segment | null {
  const e = id === undefined ? undefined : sketch.entities[id];
  if (e?.type !== "line") return null;
  const a = pointOf(sketch, e.p1);
  const b = pointOf(sketch, e.p2);
  return a && b ? { a, b } : null;
}

/** Two points described by a `[point, point]` or `[line]` reference list. */
function pointPair(sketch: Sketch, refs: EntityId[]): Segment | null {
  if (refs.length === 1) return segmentOf(sketch, refs[0]);
  if (refs.length !== 2) return null;
  const a = pointOf(sketch, refs[0]);
  const b = pointOf(sketch, refs[1]);
  return a && b ? { a, b } : null;
}

/** Foot of the perpendicular from `p` onto the infinite line through the segment. */
function footOn(s: Segment, p: Vec2): Vec2 {
  const d = sub2(s.b, s.a);
  const l2 = dot2(d, d);
  if (l2 < 1e-24) return s.a;
  return add2(s.a, scale2(d, dot2(sub2(p, s.a), d) / l2));
}

/**
 * Anchor pair for distance dimensions: the two points between which the distance is measured.
 * Handles `[line]`, `[point, point]`, `[point, line]` (either order) and `[line, line]`.
 */
function distancePair(sketch: Sketch, refs: EntityId[]): Segment | null {
  const direct = pointPair(sketch, refs);
  if (direct) return direct;
  if (refs.length !== 2) return null;
  const p0 = pointOf(sketch, refs[0]);
  const p1 = pointOf(sketch, refs[1]);
  const s0 = segmentOf(sketch, refs[0]);
  const s1 = segmentOf(sketch, refs[1]);
  if (p0 && s1) return { a: p0, b: footOn(s1, p0) };
  if (s0 && p1) return { a: p1, b: footOn(s0, p1) };
  if (s0 && s1) {
    const mid = lerp2(s0.a, s0.b, 0.5);
    return { a: mid, b: footOn(s1, mid) };
  }
  return null;
}

function roundOf(
  sketch: Sketch,
  id: EntityId | undefined,
): { center: Vec2; radius: number; entity: CircleEntity | ArcEntity } | null {
  const e = id === undefined ? undefined : sketch.entities[id];
  if (e?.type === "circle") {
    const center = pointOf(sketch, e.center);
    return center ? { center, radius: e.radius, entity: e } : null;
  }
  if (e?.type === "arc") {
    const center = pointOf(sketch, e.center);
    const start = pointOf(sketch, e.start);
    return center && start ? { center, radius: dist2(center, start), entity: e } : null;
  }
  return null;
}

/**
 * Current actual value of a dimension in mm (or degrees for angles), or null when the references
 * cannot be resolved. Distances are unsigned; angles are measured counter-clockwise from the
 * direction of the first line (p1→p2) to the direction of the second, in [0, 360).
 */
export function measureDimension(sketch: Sketch, dim: SketchDimension): number | null {
  switch (dim.type) {
    case "distance": {
      const pair = distancePair(sketch, dim.refs);
      return pair ? dist2(pair.a, pair.b) : null;
    }
    case "hdistance": {
      const pair = pointPair(sketch, dim.refs);
      return pair ? Math.abs(pair.b.x - pair.a.x) : null;
    }
    case "vdistance": {
      const pair = pointPair(sketch, dim.refs);
      return pair ? Math.abs(pair.b.y - pair.a.y) : null;
    }
    case "angle": {
      const s0 = segmentOf(sketch, dim.refs[0]);
      const s1 = segmentOf(sketch, dim.refs[1]);
      if (!s0 || !s1) return null;
      const d0 = sub2(s0.b, s0.a);
      const d1 = sub2(s1.b, s1.a);
      const deg = radToDeg(normalizeAngle(Math.atan2(cross2(d0, d1), dot2(d0, d1))));
      return deg >= 360 - 1e-12 ? 0 : deg;
    }
    case "radius":
      return roundOf(sketch, dim.refs[0])?.radius ?? null;
    case "diameter": {
      const r = roundOf(sketch, dim.refs[0]);
      return r ? r.radius * 2 : null;
    }
  }
}

const labelOffset = (length: number): number => Math.max(4, Math.min(20, length * 0.15));

/** Direction from the center towards the middle of an arc (or 45° for a circle). */
function roundDirection(sketch: Sketch, e: CircleEntity | ArcEntity, center: Vec2): Vec2 {
  if (e.type === "arc") {
    const curve = entityToCurves(sketch, e)[0];
    if (curve) return norm2(sub2(curvePointAt(curve, 0.5), center));
  }
  return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
}

/**
 * Geometric anchor points of a dimension (for extension lines) and a default label position.
 * - distances: the two measured points
 * - angle: [vertex, end of first line, end of second line]
 * - radius: [center, point on curve]; diameter: two opposite points on the curve
 */
export function dimensionAnchor(
  sketch: Sketch,
  dim: SketchDimension,
): { points: Vec2[]; defaultLabel: Vec2 } {
  const none = { points: [], defaultLabel: { x: 0, y: 0 } };
  switch (dim.type) {
    case "distance": {
      const pair = distancePair(sketch, dim.refs);
      if (!pair) return none;
      const len = dist2(pair.a, pair.b);
      const n = len < 1e-12 ? { x: 0, y: 1 } : perp2(norm2(sub2(pair.b, pair.a)));
      return {
        points: [pair.a, pair.b],
        defaultLabel: add2(lerp2(pair.a, pair.b, 0.5), scale2(n, labelOffset(len))),
      };
    }
    case "hdistance": {
      const pair = pointPair(sketch, dim.refs);
      if (!pair) return none;
      const off = labelOffset(Math.abs(pair.b.x - pair.a.x));
      return {
        points: [pair.a, pair.b],
        defaultLabel: { x: (pair.a.x + pair.b.x) / 2, y: Math.max(pair.a.y, pair.b.y) + off },
      };
    }
    case "vdistance": {
      const pair = pointPair(sketch, dim.refs);
      if (!pair) return none;
      const off = labelOffset(Math.abs(pair.b.y - pair.a.y));
      return {
        points: [pair.a, pair.b],
        defaultLabel: { x: Math.max(pair.a.x, pair.b.x) + off, y: (pair.a.y + pair.b.y) / 2 },
      };
    }
    case "angle": {
      const s0 = segmentOf(sketch, dim.refs[0]);
      const s1 = segmentOf(sketch, dim.refs[1]);
      if (!s0 || !s1) return none;
      const d0 = norm2(sub2(s0.b, s0.a));
      const d1 = norm2(sub2(s1.b, s1.a));
      const vertex = intersectLines(s0.a, d0, s1.a, d1) ?? s0.a;
      const angle = normalizeAngle(Math.atan2(cross2(d0, d1), dot2(d0, d1)));
      const c = Math.cos(angle / 2);
      const s = Math.sin(angle / 2);
      const bisector = { x: d0.x * c - d0.y * s, y: d0.x * s + d0.y * c };
      const reach = Math.min(dist2(s0.a, s0.b), dist2(s1.a, s1.b)) * 0.4;
      return {
        points: [vertex, s0.b, s1.b],
        defaultLabel: add2(vertex, scale2(bisector, Math.max(reach, 4))),
      };
    }
    case "radius": {
      const r = roundOf(sketch, dim.refs[0]);
      if (!r) return none;
      const dir = roundDirection(sketch, r.entity, r.center);
      return {
        points: [r.center, add2(r.center, scale2(dir, r.radius))],
        defaultLabel: add2(r.center, scale2(dir, r.radius + labelOffset(r.radius))),
      };
    }
    case "diameter": {
      const r = roundOf(sketch, dim.refs[0]);
      if (!r) return none;
      const dir = roundDirection(sketch, r.entity, r.center);
      return {
        points: [add2(r.center, scale2(dir, -r.radius)), add2(r.center, scale2(dir, r.radius))],
        defaultLabel: add2(r.center, scale2(dir, r.radius + labelOffset(r.radius * 2))),
      };
    }
  }
}

function curvesOf(sketch: Sketch, id: EntityId): Curve2[] {
  const e = sketch.entities[id];
  if (!e || e.type === "point") return [];
  try {
    return entityToCurves(sketch, e);
  } catch {
    return [];
  }
}

/** Bounding box of all points and curves (construction included), or null for an empty sketch. */
export function sketchBounds(sketch: Sketch): Bounds2 | null {
  let bounds = emptyBounds2();
  let any = false;
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point") {
      expandBounds2(bounds, e);
      any = true;
      continue;
    }
    for (const c of curvesOf(sketch, e.id)) {
      bounds = unionBounds2(bounds, curveBounds(c));
      any = true;
    }
  }
  return any ? bounds : null;
}

function closestOnEntity(
  sketch: Sketch,
  id: EntityId,
  p: Vec2,
): { point: Vec2; distance: number } | null {
  let best: { point: Vec2; distance: number } | null = null;
  for (const c of curvesOf(sketch, id)) {
    const point = curvePointAt(c, closestParam(c, p));
    const distance = dist2(point, p);
    if (!best || distance < best.distance) best = { point, distance };
  }
  return best;
}

export interface SketchHit {
  id: EntityId;
  type: SketchEntityType;
  distance: number;
}

/**
 * Nearest entity within `tolerance` of `p`. Points win over curves when both are in range.
 * `options` can switch off point or curve picking.
 */
export function hitTestSketch(
  sketch: Sketch,
  p: Vec2,
  tolerance: number,
  options: { points?: boolean; curves?: boolean } = {},
): SketchHit | null {
  let bestPoint: SketchHit | null = null;
  let bestCurve: SketchHit | null = null;
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point") {
      if (options.points === false) continue;
      const distance = dist2(e, p);
      if (distance <= tolerance && (!bestPoint || distance < bestPoint.distance)) {
        bestPoint = { id: e.id, type: "point", distance };
      }
      continue;
    }
    if (options.curves === false) continue;
    const hit = closestOnEntity(sketch, e.id, p);
    if (hit && hit.distance <= tolerance && (!bestCurve || hit.distance < bestCurve.distance)) {
      bestCurve = { id: e.id, type: e.type, distance: hit.distance };
    }
  }
  return bestPoint ?? bestCurve;
}

/** A position lined up with other points of the sketch. */
export interface AlignResult {
  point: Vec2;
  /** The reference straight above or below `point`: both have the same X. */
  vertical?: Vec2;
  /** The reference straight left or right of `point`: both have the same Y. */
  horizontal?: Vec2;
}

/**
 * Line `p` up with reference points: when its X is within `tolerance` of the X of a reference
 * it takes that X (it then lies straight above or below the reference), and the same for Y.
 * The two axes are independent, so a position can be above one point and beside another.
 * Per axis the reference that is nearest along that axis wins; among equals, the nearest one.
 */
export function alignPoint(p: Vec2, references: Iterable<Vec2>, tolerance: number): AlignResult {
  let vertical: { ref: Vec2; off: number; distance: number } | null = null;
  let horizontal: { ref: Vec2; off: number; distance: number } | null = null;
  const better = (
    best: { off: number; distance: number } | null,
    off: number,
    distance: number,
  ): boolean =>
    best === null ||
    off < best.off - 1e-12 ||
    (Math.abs(off - best.off) <= 1e-12 && distance < best.distance);
  for (const ref of references) {
    const dx = Math.abs(ref.x - p.x);
    const dy = Math.abs(ref.y - p.y);
    const distance = Math.hypot(dx, dy);
    if (dx <= tolerance && better(vertical, dx, distance)) vertical = { ref, off: dx, distance };
    if (dy <= tolerance && better(horizontal, dy, distance)) {
      horizontal = { ref, off: dy, distance };
    }
  }
  const result: AlignResult = {
    point: { x: vertical ? vertical.ref.x : p.x, y: horizontal ? horizontal.ref.y : p.y },
  };
  if (vertical) result.vertical = { x: vertical.ref.x, y: vertical.ref.y };
  if (horizontal) result.horizontal = { x: horizontal.ref.x, y: horizontal.ref.y };
  return result;
}

/** The points of a sketch a position can line up with: its point entities, `exclude` left out. */
export function alignmentReferences(sketch: Sketch, exclude: EntityId[] = []): Vec2[] {
  const skip = new Set(exclude);
  const out: Vec2[] = [];
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point" && !skip.has(e.id)) out.push({ x: e.x, y: e.y });
  }
  return out;
}

export interface SnapResult {
  point: Vec2;
  pointId?: EntityId;
  curveId?: EntityId;
  kind: "point" | "midpoint" | "curve" | "center" | "none";
}

/**
 * Snap `p` to the sketch. Priority: existing point (`center` when it is the center of a circle,
 * arc or ellipse, which then also reports `curveId`), line midpoint, nearest point on a curve.
 * Entities listed in `exclude` (e.g. the geometry being dragged) are ignored.
 */
export function snapPoint(
  sketch: Sketch,
  p: Vec2,
  tolerance: number,
  exclude: EntityId[] = [],
): SnapResult {
  const skip = new Set(exclude);
  let nearest: { e: PointEntity; distance: number } | null = null;
  for (const e of Object.values(sketch.entities)) {
    if (e.type !== "point" || skip.has(e.id)) continue;
    const distance = dist2(e, p);
    if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
      nearest = { e, distance };
    }
  }
  if (nearest) {
    const id = nearest.e.id;
    const point = { x: nearest.e.x, y: nearest.e.y };
    const owner = Object.values(sketch.entities).find(
      (e) =>
        (e.type === "circle" || e.type === "arc" || e.type === "ellipse") &&
        e.center === id &&
        !skip.has(e.id),
    );
    return owner
      ? { point, pointId: id, curveId: owner.id, kind: "center" }
      : { point, pointId: id, kind: "point" };
  }

  let mid: { id: EntityId; point: Vec2; distance: number } | null = null;
  let onCurve: { id: EntityId; point: Vec2; distance: number } | null = null;
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point" || skip.has(e.id)) continue;
    if (e.type === "line") {
      const s = segmentOf(sketch, e.id);
      if (s) {
        const point = lerp2(s.a, s.b, 0.5);
        const distance = dist2(point, p);
        if (distance <= tolerance && (!mid || distance < mid.distance)) {
          mid = { id: e.id, point, distance };
        }
      }
    }
    const hit = closestOnEntity(sketch, e.id, p);
    if (hit && hit.distance <= tolerance && (!onCurve || hit.distance < onCurve.distance)) {
      onCurve = { id: e.id, point: hit.point, distance: hit.distance };
    }
  }
  if (mid) return { point: mid.point, curveId: mid.id, kind: "midpoint" };
  if (onCurve) return { point: onCurve.point, curveId: onCurve.id, kind: "curve" };
  return { point: { x: p.x, y: p.y }, kind: "none" };
}
