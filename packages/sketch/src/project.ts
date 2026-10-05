import {
  type Plane3,
  type TopologyRef,
  type Vec2,
  type Vec3,
  circumcenter,
  cross2,
  dist2,
  sub2,
  worldToPlane,
} from "@fabcad/geometry";
import { SketchBuilder } from "./edit";
import type { EntityId, ProjectedGeometryRef, Sketch } from "./model";

/**
 * Project: geometry of a body projected onto the sketch plane. The projected entities are
 * ordinary sketch entities listed in `sketch.projections`; the solver holds them in place and
 * the feature engine re-projects them whenever the source body changes.
 */

export type ProjectedShape =
  | { type: "point"; at: Vec2 }
  | { type: "line"; a: Vec2; b: Vec2 }
  | { type: "circle"; center: Vec2; radius: number }
  /** Counter-clockwise from `start` to `end`. */
  | { type: "arc"; center: Vec2; start: Vec2; end: Vec2 }
  /** A fit spline through `points`, or with `kind: "control"` the control polygon of a Bézier. */
  | { type: "spline"; points: Vec2[]; closed: boolean; kind?: "control" };

const TOL = 1e-6;

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist2(last, p) > TOL) out.push(p);
  }
  return out;
}

/**
 * Recognise what a polyline sampled along a 3D curve looks like once it is projected onto the
 * plane: a point (curve perpendicular to the plane), a line, a circle, an arc or a free curve.
 */
export function projectPolyline(plane: Plane3, points: readonly Vec3[]): ProjectedShape | null {
  // Tessellations are single precision: drop the noise below a nanometre-scale grid.
  const clean = (v: number): number => {
    const r = Math.round(v * 1e5) / 1e5;
    return Object.is(r, -0) ? 0 : r;
  };
  const all = points.map((p) => {
    const q = worldToPlane(plane, p);
    return { x: clean(q.x), y: clean(q.y) };
  });
  if (all.length === 0) return null;
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const pts = dedupe(all);
  if (pts.length === 1) return { type: "point", at: first };

  const extent = Math.max(...pts.map((p) => dist2(p, first)), 1e-9);
  const closed = all.length > 2 && dist2(first, last) <= TOL * Math.max(1, extent);

  // Straight: every point lies on the line through the two points that are farthest apart.
  const far = pts.reduce((a, b) => (dist2(b, first) > dist2(a, first) ? b : a));
  const dir = sub2(far, first);
  const len = Math.hypot(dir.x, dir.y);
  const straight = pts.every((p) => Math.abs(cross2(dir, sub2(p, first))) / len <= 1e-6 * Math.max(1, len));
  if (straight) {
    // A curve seen edge-on can fold back on itself: span the whole extent.
    let lo = first;
    let hi = first;
    let tLo = 0;
    let tHi = 0;
    for (const p of pts) {
      const t = ((p.x - first.x) * dir.x + (p.y - first.y) * dir.y) / len;
      if (t < tLo) {
        tLo = t;
        lo = p;
      }
      if (t > tHi) {
        tHi = t;
        hi = p;
      }
    }
    return { type: "line", a: lo, b: hi };
  }

  if (pts.length >= 3) {
    const ring = closed ? pts.slice(0, -1) : pts;
    const a = ring[0]!;
    const b = ring[Math.floor(ring.length / 3)]!;
    const c = ring[Math.floor((2 * ring.length) / 3)]!;
    const centre = circumcenter(a, b, c);
    if (centre) {
      const radius = dist2(centre, a);
      const round = pts.every((p) => Math.abs(dist2(p, centre) - radius) <= 1e-5 * Math.max(1, radius));
      if (round) {
        const center = { x: clean(centre.x), y: clean(centre.y) };
        const r = clean(radius);
        if (closed) return { type: "circle", center, radius: r };
        // Both ends are put exactly on the circle, so that the arc is consistent in itself.
        const onCircle = (p: Vec2): Vec2 => {
          const d = dist2(p, center);
          return { x: center.x + ((p.x - center.x) * r) / d, y: center.y + ((p.y - center.y) * r) / d };
        };
        const ccw = cross2(sub2(pts[0]!, center), sub2(pts[1]!, center)) > 0;
        return ccw
          ? { type: "arc", center, start: onCircle(first), end: onCircle(last) }
          : { type: "arc", center, start: onCircle(last), end: onCircle(first) };
      }
    }
  }

  // Anything else becomes a spline through a manageable number of the sampled points.
  const source = closed ? pts.slice(0, -1) : pts;
  const max = 24;
  const step = Math.max(1, Math.ceil(source.length / max));
  const picked = source.filter((_, i) => i % step === 0);
  if (!closed && picked[picked.length - 1] !== source[source.length - 1]) {
    picked.push(source[source.length - 1]!);
  }
  return picked.length >= 2 ? { type: "spline", points: picked, closed } : null;
}

/** What the B-Rep knows exactly about an edge, beyond its sampled points. */
export interface ExactEdge {
  curve: "line" | "circle" | "other";
  from: Vec3;
  to: Vec3;
  /** For circles and circular arcs. */
  center?: Vec3;
  radius?: number;
  /** For circles: the normal of the circle's plane. */
  axis?: Vec3;
}

/**
 * Project an edge. A Bézier edge (`bezier`: its control points) projects exactly to the
 * Bézier of the projected control points, which a control spline holds as it is; anything else
 * is recognised from the sampled `points` (`projectPolyline`). With `exact`, the recognised
 * shape takes its end points, and a circle its center and radius, from the B-Rep instead of
 * the single-precision samples: the ends of neighbouring edges then meet exactly, and a circle
 * concentric with the sketch origin has its center exactly there.
 */
export function projectCurve(
  plane: Plane3,
  points: readonly Vec3[],
  bezier?: readonly Vec3[],
  exact?: ExactEdge,
): ProjectedShape | null {
  const shape = projectSampled(plane, points, bezier);
  return shape && exact ? snapToExact(plane, shape, exact, points) : shape;
}

/**
 * The points of a circle standing upright on the sketch (its plane contains the sketch normal)
 * that lie on the edge and are extremes along its edge-on projection: the ends of the edge,
 * and the two points of the circle farthest to either side where the edge passes them. The
 * samples tell which way round the edge runs. Null for a circle that does not stand upright.
 */
function uprightExtremes(plane: Plane3, edge: ExactEdge, points: readonly Vec3[]): Vec2[] | null {
  const { center: c, radius: r, axis } = edge;
  if (!c || r === undefined || !axis) return null;
  const n = plane.normal;
  if (Math.abs(n.x * axis.x + n.y * axis.y + n.z * axis.z) > 1e-9) return null;
  const at = (p: Vec3): Vec2 => {
    const q = worldToPlane(plane, p);
    return { x: tidy(q.x), y: tidy(q.y) };
  };
  // In the circle's plane: e1 towards the start, e2 a quarter turn on.
  const rel = (p: Vec3): Vec3 => ({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z });
  const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const crossV = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const f = rel(edge.from);
  const fl = Math.hypot(f.x, f.y, f.z);
  if (fl < 1e-12) return null;
  const e1 = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  const e2 = crossV(axis, e1);
  const angle = (p: Vec3): number => {
    const v = rel(p);
    const a = Math.atan2(dot(v, e2), dot(v, e1));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  // Which way round: the second sample is a little way on from the start.
  const second = points.length > 1 ? angle(points[1]!) : 0;
  const ccw = second < Math.PI;
  const turn = (a: number): number => (ccw ? a : (2 * Math.PI - a) % (2 * Math.PI));
  const closed = Math.hypot(edge.from.x - edge.to.x, edge.from.y - edge.to.y, edge.from.z - edge.to.z) < 1e-9;
  const sweep = closed ? 2 * Math.PI : turn(angle(edge.to));
  // The direction in the circle's plane that is parallel to the sketch.
  const u = crossV(n, axis);
  const ul = Math.hypot(u.x, u.y, u.z);
  const out: Vec2[] = closed ? [] : [at(edge.from), at(edge.to)];
  for (const s of [1, -1]) {
    const p = { x: c.x + (s * r * u.x) / ul, y: c.y + (s * r * u.y) / ul, z: c.z + (s * r * u.z) / ul };
    if (turn(angle(p)) <= sweep + 1e-12) out.push(at(p));
  }
  return out.length > 0 ? out : null;
}

/** Normalise exact values: drop the last bits of rounding noise and negative zero. */
const tidy = (v: number): number => {
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
};

function snapToExact(
  plane: Plane3,
  shape: ProjectedShape,
  edge: ExactEdge,
  points: readonly Vec3[],
): ProjectedShape {
  const at = (p: Vec3): Vec2 => {
    const q = worldToPlane(plane, p);
    return { x: tidy(q.x), y: tidy(q.y) };
  };
  const from = at(edge.from);
  const to = at(edge.to);
  // Which exact end each end of the recognised shape is.
  const ends = (a: Vec2, b: Vec2): [Vec2, Vec2] =>
    dist2(a, from) + dist2(b, to) <= dist2(a, to) + dist2(b, from) ? [from, to] : [to, from];
  const near = (a: Vec2, b: Vec2): boolean => dist2(a, b) <= 1e-3;
  switch (shape.type) {
    case "point":
      // A vertex, or a curve seen end-on.
      return near(shape.at, from) ? { type: "point", at: from } : near(shape.at, to) ? { type: "point", at: to } : shape;
    case "line": {
      if (edge.curve === "line") {
        if (!near(shape.a, from) && !near(shape.a, to)) return shape;
        const [a, b] = ends(shape.a, shape.b);
        return { type: "line", a, b };
      }
      // A curve seen edge-on also becomes a line. Its ends are the extremes of the curve: the
      // ends of the edge, and for a circle standing upright on the sketch, the points of the
      // circle farthest along the line where the arc passes them, which the samples only come
      // close to.
      const extremes: Vec2[] = [from, to];
      let tolerance = 1e-3;
      const upright = edge.curve === "circle" ? uprightExtremes(plane, edge, points) : null;
      if (upright) {
        extremes.splice(0, 2, ...upright);
        // Samples at most 0.15 rad from an extreme fall short of it by r·(1 − cos 0.15).
        tolerance = Math.max(tolerance, 0.02 * edge.radius!);
      }
      const dir = sub2(shape.b, shape.a);
      const along = (p: Vec2): number => (p.x - shape.a.x) * dir.x + (p.y - shape.a.y) * dir.y;
      const lo = extremes.reduce((m, p) => (along(p) < along(m) ? p : m));
      const hi = extremes.reduce((m, p) => (along(p) > along(m) ? p : m));
      if (dist2(lo, shape.a) > tolerance || dist2(hi, shape.b) > tolerance) return shape;
      return { type: "line", a: lo, b: hi };
    }
    case "circle":
    case "arc": {
      if (edge.curve !== "circle" || !edge.center || edge.radius === undefined) return shape;
      const center = at(edge.center);
      const radius = edge.radius;
      // The fit of a short arc from single-precision samples can be off by a few micrometres
      // in its center: the exact circle is taken whenever it is the one the samples lie on,
      // which also says that it lies parallel to the sketch (a tilted one would project to an
      // ellipse). Arcs of the same circle then share their center and radius, and their ends
      // meet those of the neighbouring edges exactly.
      const slack = 1e-3 * Math.max(1, radius);
      const onCircle = (p: Vec2): boolean => Math.abs(dist2(p, center) - radius) <= slack;
      if (!points.every((p) => onCircle(worldToPlane(plane, p)))) return shape;
      if (shape.type === "circle") return { type: "circle", center, radius: tidy(radius) };
      if (!onCircle(from) || !onCircle(to)) return shape;
      if (!near(shape.start, from) && !near(shape.start, to)) return shape;
      const [start, end] = ends(shape.start, shape.end);
      return { type: "arc", center, start, end };
    }
    case "spline": {
      if (shape.closed || shape.kind === "control" || shape.points.length < 2) return shape;
      const points = shape.points.slice();
      const [first, last] = ends(points[0]!, points[points.length - 1]!);
      points[0] = first;
      points[points.length - 1] = last;
      return { ...shape, points };
    }
    default:
      return shape;
  }
}

function projectSampled(
  plane: Plane3,
  points: readonly Vec3[],
  bezier?: readonly Vec3[],
): ProjectedShape | null {
  if (!bezier || bezier.length < 2 || bezier.length > 4) return projectPolyline(plane, points);
  const poles = bezier.map((p) => {
    const q = worldToPlane(plane, p);
    return { x: q.x, y: q.y };
  });
  const first = poles[0]!;
  const last = poles[poles.length - 1]!;
  const size = Math.max(...poles.map((p) => dist2(p, first)));
  // Seen edge-on, or straight to begin with: the sampled points give the line and its extent.
  const flat = poles.every((p) => Math.abs(cross2(sub2(last, first), sub2(p, first))) <= 1e-9 * Math.max(1, size * size));
  if (flat || dist2(first, last) < 1e-9) return projectPolyline(plane, points);
  const cubic =
    poles.length === 4
      ? poles
      : poles.length === 3
        ? [
            poles[0]!,
            { x: poles[0]!.x + ((poles[1]!.x - poles[0]!.x) * 2) / 3, y: poles[0]!.y + ((poles[1]!.y - poles[0]!.y) * 2) / 3 },
            { x: poles[2]!.x + ((poles[1]!.x - poles[2]!.x) * 2) / 3, y: poles[2]!.y + ((poles[1]!.y - poles[2]!.y) * 2) / 3 },
            poles[2]!,
          ]
        : null;
  if (!cubic) return projectPolyline(plane, points);
  return { type: "spline", kind: "control", points: cubic, closed: false };
}

export interface ProjectionSource {
  bodyId: string;
  source: "edge" | "vertex" | "silhouette";
  /** Point on the source geometry, used to find it again after a recompute. */
  hint: Vec3;
  index?: number;
  count?: number;
  ref?: TopologyRef;
  /** Instance of another component the geometry is seen at (see `ProjectedGeometryRef`). */
  instanceId?: string;
}

/** Add a projected shape to the sketch. Returns the new reference, or null for a duplicate. */
export function addProjection(
  sketch: Sketch,
  shape: ProjectedShape,
  from: ProjectionSource,
): { sketch: Sketch; ref: ProjectedGeometryRef } | null {
  const duplicate = sketch.projections.some(
    (r) =>
      r.bodyId === from.bodyId &&
      (r.source ?? "edge") === from.source &&
      Math.hypot(r.hint.x - from.hint.x, r.hint.y - from.hint.y, r.hint.z - from.hint.z) < 1e-6,
  );
  if (duplicate) return null;
  const b = new SketchBuilder(sketch);
  const ids: EntityId[] = [];
  const point = (p: Vec2): EntityId => {
    const id = b.point(p.x, p.y);
    ids.push(id);
    return id;
  };
  switch (shape.type) {
    case "point":
      point(shape.at);
      break;
    case "line":
      ids.push(b.line(point(shape.a), point(shape.b)));
      break;
    case "circle":
      ids.push(b.circle(point(shape.center), shape.radius));
      break;
    case "arc":
      ids.push(b.arc(point(shape.center), point(shape.start), point(shape.end)));
      break;
    case "spline":
      ids.push(b.spline(shape.kind ?? "fit", shape.points.map(point), shape.closed));
      break;
  }
  const built = b.build();
  const ref: ProjectedGeometryRef = {
    id: `j${built.nextId}`,
    mode: "project",
    bodyId: from.bodyId,
    source: from.source,
    hint: from.hint,
    entityIds: ids,
  };
  if (from.ref) ref.ref = from.ref;
  if (from.instanceId) ref.instanceId = from.instanceId;
  if (from.index !== undefined && from.count !== undefined) {
    ref.index = from.index;
    ref.count = from.count;
  }
  return {
    sketch: { ...built, nextId: built.nextId + 1, projections: [...built.projections, ref] },
    ref,
  };
}

/**
 * Move the entities of an existing projection onto a freshly projected shape. Returns the same
 * sketch object when nothing moved, and null when the shape no longer has the same structure
 * (e.g. a line turned into an arc), in which case the projection is left as it is.
 */
export function updateProjection(
  sketch: Sketch,
  ref: ProjectedGeometryRef,
  shape: ProjectedShape,
  hint: Vec3,
): Sketch | null {
  const entities = ref.entityIds.map((id) => sketch.entities[id]);
  if (entities.some((e) => !e)) return null;
  const curve = entities.find((e) => e && e.type !== "point");
  const pointIds = ref.entityIds.filter((id) => sketch.entities[id]?.type === "point");

  let targets: Vec2[];
  let radius: number | null = null;
  switch (shape.type) {
    case "point":
      if (curve) return null;
      targets = [shape.at];
      break;
    case "line":
      if (curve?.type !== "line") return null;
      targets = [shape.a, shape.b];
      break;
    case "circle":
      if (curve?.type !== "circle") return null;
      targets = [shape.center];
      radius = shape.radius;
      break;
    case "arc":
      if (curve?.type !== "arc") return null;
      targets = [shape.center, shape.start, shape.end];
      break;
    case "spline":
      if (curve?.type !== "spline" || curve.points.length !== shape.points.length) return null;
      if (curve.kind !== (shape.kind ?? "fit")) return null;
      targets = shape.points;
      break;
  }
  if (targets.length !== pointIds.length) return null;

  const next = { ...sketch.entities };
  let moved = false;
  pointIds.forEach((id, i) => {
    const e = next[id]!;
    const t = targets[i]!;
    if (e.type !== "point") return;
    if (Math.abs(e.x - t.x) > 1e-9 || Math.abs(e.y - t.y) > 1e-9) {
      next[id] = { ...e, x: t.x, y: t.y };
      moved = true;
    }
  });
  if (radius !== null && curve?.type === "circle" && Math.abs(curve.radius - radius) > 1e-9) {
    next[curve.id] = { ...curve, radius };
    moved = true;
  }
  const hintMoved =
    Math.hypot(ref.hint.x - hint.x, ref.hint.y - hint.y, ref.hint.z - hint.z) > 1e-9;
  if (!moved && !hintMoved) return sketch;
  return {
    ...sketch,
    entities: next,
    projections: sketch.projections.map((r) => (r.id === ref.id ? { ...r, hint } : r)),
  };
}

/** Whether two projected shapes cover the same geometry (e.g. two edges seen edge-on). */
export function sameProjectedShape(a: ProjectedShape, b: ProjectedShape, tolerance = 1e-4): boolean {
  const near = (p: Vec2, q: Vec2): boolean => dist2(p, q) <= tolerance;
  if (a.type === "point" && b.type === "point") return near(a.at, b.at);
  if (a.type === "line" && b.type === "line") {
    return (near(a.a, b.a) && near(a.b, b.b)) || (near(a.a, b.b) && near(a.b, b.a));
  }
  if (a.type === "circle" && b.type === "circle") {
    return near(a.center, b.center) && Math.abs(a.radius - b.radius) <= tolerance;
  }
  if (a.type === "arc" && b.type === "arc") {
    return near(a.center, b.center) && near(a.start, b.start) && near(a.end, b.end);
  }
  if (a.type === "spline" && b.type === "spline" && a.points.length === b.points.length) {
    const same = (p: Vec2[], q: Vec2[]): boolean => p.every((x, i) => near(x, q[i]!));
    return (a.kind ?? "fit") === (b.kind ?? "fit") && (same(a.points, b.points) || same(a.points, [...b.points].reverse()));
  }
  return false;
}

/** The shapes that the projections of a sketch cover now, to avoid projecting one twice. */
export function projectedShapes(sketch: Sketch): ProjectedShape[] {
  const at = (id: EntityId): Vec2 | null => {
    const e = sketch.entities[id];
    return e?.type === "point" ? { x: e.x, y: e.y } : null;
  };
  const out: ProjectedShape[] = [];
  for (const ref of sketch.projections) {
    const curve = ref.entityIds.map((id) => sketch.entities[id]).find((e) => e && e.type !== "point");
    if (!curve) {
      const p = ref.entityIds[0] ? at(ref.entityIds[0]) : null;
      if (p) out.push({ type: "point", at: p });
    } else if (curve.type === "line") {
      const a = at(curve.p1);
      const b = at(curve.p2);
      if (a && b) out.push({ type: "line", a, b });
    } else if (curve.type === "circle") {
      const center = at(curve.center);
      if (center) out.push({ type: "circle", center, radius: curve.radius });
    } else if (curve.type === "arc") {
      const center = at(curve.center);
      const start = at(curve.start);
      const end = at(curve.end);
      if (center && start && end) out.push({ type: "arc", center, start, end });
    } else if (curve.type === "spline") {
      const points = curve.points.map(at);
      if (points.every((p) => p !== null)) {
        out.push({
          type: "spline",
          points: points as Vec2[],
          closed: curve.closed,
          ...(curve.kind === "control" ? { kind: "control" as const } : {}),
        });
      }
    }
  }
  return out;
}

/** Ids of all entities that belong to a projection. */
export function projectedEntityIds(sketch: Sketch): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const r of sketch.projections) for (const id of r.entityIds) out.add(id);
  return out;
}
