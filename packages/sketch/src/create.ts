import {
  type Vec2,
  add2,
  arcThroughPoints,
  circumcenter,
  dist2,
  dot2,
  norm2,
  perp2,
  scale2,
  sub2,
} from "@fabcad/geometry";
import type { EntityId } from "./model";
import { type SketchBuilder, getPoint } from "./edit";

/**
 * Sketch Create tools. Every tool only emits generic entities (points, lines, arcs, circles…)
 * plus constraints, so nothing downstream needs to know that a shape was "a rectangle" or
 * "a slot". All tools operate on a `SketchBuilder` and are meant to be composed inside
 * `editSketch`.
 */

export interface CreateResult {
  /** Created curve entities (and the point for `createPoint`), in creation order. */
  entities: EntityId[];
  /**
   * Defining points of the created shape, in a tool-specific documented order. Existing points
   * passed in by id are reused and listed here as well.
   */
  points: EntityId[];
  /** Ids of the constraints added by the tool. */
  constraints: string[];
}

/** An existing point id (snapping / shared points) or coordinates for a new point. */
export type PointInput = EntityId | Vec2;

const posOf = (b: SketchBuilder, p: PointInput): Vec2 =>
  typeof p === "string" ? getPoint(b.current, p) : p;

const resolve = (b: SketchBuilder, p: PointInput, construction = false): EntityId =>
  typeof p === "string" ? p : b.point(p.x, p.y, construction);

/** Create a point (or return the existing one when an id is passed). */
export function createPoint(b: SketchBuilder, p: PointInput, construction = false): CreateResult {
  const id = resolve(b, p, construction);
  return { entities: [id], points: [id], constraints: [] };
}

/** Line between two points. `points` = [p1, p2]. */
export function createLine(
  b: SketchBuilder,
  p1: PointInput,
  p2: PointInput,
  construction = false,
): CreateResult {
  const a = resolve(b, p1);
  const c = resolve(b, p2);
  return { entities: [b.line(a, c, construction)], points: [a, c], constraints: [] };
}

/** Construction (reference) line; ignored by profile detection. */
export function createConstructionLine(
  b: SketchBuilder,
  p1: PointInput,
  p2: PointInput,
): CreateResult {
  return createLine(b, p1, p2, true);
}

/** Chain of lines sharing their end points. `closed` adds a line from the last to the first. */
export function createPolyline(
  b: SketchBuilder,
  points: PointInput[],
  closed = false,
  construction = false,
): CreateResult {
  if (points.length < 2) throw new Error("A polyline needs at least two points");
  const ids = points.map((p) => resolve(b, p));
  const entities: EntityId[] = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    entities.push(b.line(ids[i]!, ids[i + 1]!, construction));
  }
  if (closed && ids.length > 2) {
    entities.push(b.line(ids[ids.length - 1]!, ids[0]!, construction));
  }
  return { entities, points: ids, constraints: [] };
}

function closedLines(b: SketchBuilder, ids: EntityId[], construction: boolean): EntityId[] {
  return ids.map((id, i) => b.line(id, ids[(i + 1) % ids.length]!, construction));
}

/**
 * Axis-aligned rectangle from two opposite corners. `points` = [p1, (x2,y1), p2, (x1,y2)];
 * lines 0 and 2 are horizontal, 1 and 3 vertical.
 */
export function createRectangle2Point(
  b: SketchBuilder,
  p1: PointInput,
  p2: PointInput,
  construction = false,
): CreateResult {
  const a = posOf(b, p1);
  const c = posOf(b, p2);
  const ids = [resolve(b, p1), b.point(c.x, a.y), resolve(b, p2), b.point(a.x, c.y)];
  const lines = closedLines(b, ids, construction);
  const constraints = [
    b.constrain("horizontal", lines[0]!),
    b.constrain("vertical", lines[1]!),
    b.constrain("horizontal", lines[2]!),
    b.constrain("vertical", lines[3]!),
  ];
  return { entities: lines, points: ids, constraints };
}

/**
 * Rotated rectangle: p1→p2 is the first edge, the distance of p3 from that edge sets the height
 * (p3 itself is only used for its position). Adds 2 parallel + 1 perpendicular constraints.
 */
export function createRectangle3Point(
  b: SketchBuilder,
  p1: PointInput,
  p2: PointInput,
  p3: PointInput,
  construction = false,
): CreateResult {
  const a = posOf(b, p1);
  const c = posOf(b, p2);
  if (dist2(a, c) < 1e-12) throw new Error("Rectangle edge has zero length");
  const n = perp2(norm2(sub2(c, a)));
  const h = scale2(n, dot2(sub2(posOf(b, p3), a), n));
  const q2 = add2(c, h);
  const q3 = add2(a, h);
  const ids = [resolve(b, p1), resolve(b, p2), b.point(q2.x, q2.y), b.point(q3.x, q3.y)];
  const lines = closedLines(b, ids, construction);
  const constraints = [
    b.constrain("parallel", lines[0]!, lines[2]!),
    b.constrain("parallel", lines[1]!, lines[3]!),
    b.constrain("perpendicular", lines[0]!, lines[1]!),
  ];
  return { entities: lines, points: ids, constraints };
}

/**
 * Axis-aligned rectangle around a center. `points` = [corner0..corner3, center] where corner0 is
 * the picked corner; `entities` = [4 lines, construction diagonal]. The center is held by a
 * `midpoint` constraint on the diagonal corner0–corner2.
 */
export function createRectangleCenter(
  b: SketchBuilder,
  center: PointInput,
  corner: PointInput,
  construction = false,
): CreateResult {
  const c = posOf(b, center);
  const k = posOf(b, corner);
  const d = sub2(k, c);
  const ids = [
    resolve(b, corner),
    b.point(c.x - d.x, k.y),
    b.point(c.x - d.x, c.y - d.y),
    b.point(k.x, c.y - d.y),
  ];
  const lines = closedLines(b, ids, construction);
  const centerId = resolve(b, center);
  const diagonal = b.line(ids[0]!, ids[2]!, true);
  const constraints = [
    b.constrain("horizontal", lines[0]!),
    b.constrain("vertical", lines[1]!),
    b.constrain("horizontal", lines[2]!),
    b.constrain("vertical", lines[3]!),
    b.constrain("midpoint", centerId, diagonal),
  ];
  return { entities: [...lines, diagonal], points: [...ids, centerId], constraints };
}

/** Circle from center and radius. `points` = [center]. */
export function createCircle(
  b: SketchBuilder,
  center: PointInput,
  radius: number,
  construction = false,
): CreateResult {
  if (!(radius > 0)) throw new Error("Circle radius must be positive");
  const c = resolve(b, center);
  return { entities: [b.circle(c, radius, construction)], points: [c], constraints: [] };
}

/**
 * Circle through three points. `points` = [center, p1, p2, p3]; each picked point gets a
 * point-on-circle `coincident` constraint.
 */
export function createCircle3Point(
  b: SketchBuilder,
  p1: PointInput,
  p2: PointInput,
  p3: PointInput,
  construction = false,
): CreateResult {
  const a = posOf(b, p1);
  const c = circumcenter(a, posOf(b, p2), posOf(b, p3));
  if (!c) throw new Error("The three points are collinear");
  const picked = [resolve(b, p1), resolve(b, p2), resolve(b, p3)];
  const center = b.point(c.x, c.y);
  const circle = b.circle(center, dist2(c, a), construction);
  const constraints = picked.map((p) => b.constrain("coincident", p, circle));
  return { entities: [circle], points: [center, ...picked], constraints };
}

/**
 * Center point arc running from `start` to `end`, counter-clockwise when `ccw` (default) and
 * clockwise otherwise. The model stores arcs CCW, so a clockwise arc is stored end→start.
 * An `end` given as coordinates is projected onto the radius defined by `start`.
 * `points` = [center, start, end] as picked.
 */
export function createArcCenter(
  b: SketchBuilder,
  center: PointInput,
  start: PointInput,
  end: PointInput,
  ccw = true,
  construction = false,
): CreateResult {
  const c = posOf(b, center);
  const r = dist2(c, posOf(b, start));
  if (r < 1e-12) throw new Error("Arc radius must be positive");
  const cId = resolve(b, center);
  const sId = resolve(b, start);
  let eId: EntityId;
  if (typeof end === "string") {
    eId = end;
  } else {
    const dir = norm2(sub2(end, c));
    const e = dist2(end, c) < 1e-12 ? posOf(b, start) : add2(c, scale2(dir, r));
    eId = b.point(e.x, e.y);
  }
  const arc = ccw ? b.arc(cId, sId, eId, construction) : b.arc(cId, eId, sId, construction);
  return { entities: [arc], points: [cId, sId, eId], constraints: [] };
}

/**
 * Arc from `start` to `end` passing through `through` (used for its position only).
 * `points` = [center, start, end] as picked; the stored arc is swapped when needed to stay CCW.
 */
export function createArc3Point(
  b: SketchBuilder,
  start: PointInput,
  end: PointInput,
  through: PointInput,
  construction = false,
): CreateResult {
  const geom = arcThroughPoints(posOf(b, start), posOf(b, through), posOf(b, end));
  if (!geom) throw new Error("The three points are collinear");
  const sId = resolve(b, start);
  const eId = resolve(b, end);
  const cId = b.point(geom.center.x, geom.center.y);
  const arc =
    geom.sweep > 0 ? b.arc(cId, sId, eId, construction) : b.arc(cId, eId, sId, construction);
  return { entities: [arc], points: [cId, sId, eId], constraints: [] };
}

/** Full ellipse. `points` = [center, majorPoint]. */
export function createEllipse(
  b: SketchBuilder,
  center: PointInput,
  majorPoint: PointInput,
  minorRadius: number,
  construction = false,
): CreateResult {
  if (!(minorRadius > 0)) throw new Error("Ellipse minor radius must be positive");
  const c = resolve(b, center);
  const m = resolve(b, majorPoint);
  return {
    entities: [b.ellipse(c, m, minorRadius, construction)],
    points: [c, m],
    constraints: [],
  };
}

/**
 * Regular polygon. `inscribed`: the pick is the first vertex and all vertices lie on the
 * construction circle. `circumscribed`: the pick is the midpoint of the first edge and all edges
 * are tangent to the construction circle. `entities` = [n lines, construction circle];
 * `points` = [n vertices, center].
 */
export function createPolygon(
  b: SketchBuilder,
  center: PointInput,
  vertex: PointInput,
  sides: number,
  mode: "inscribed" | "circumscribed" = "inscribed",
  construction = false,
): CreateResult {
  const n = Math.floor(sides);
  if (n < 3) throw new Error("A polygon needs at least three sides");
  const c = posOf(b, center);
  const v = posOf(b, vertex);
  const radius = dist2(c, v);
  if (radius < 1e-12) throw new Error("Polygon radius must be positive");
  const a0 = Math.atan2(v.y - c.y, v.x - c.x);
  const inscribed = mode === "inscribed";
  const vertexRadius = inscribed ? radius : radius / Math.cos(Math.PI / n);
  const first = inscribed ? a0 : a0 - Math.PI / n;
  const ids: EntityId[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 && inscribed) {
      ids.push(resolve(b, vertex));
      continue;
    }
    const a = first + (2 * Math.PI * i) / n;
    ids.push(b.point(c.x + vertexRadius * Math.cos(a), c.y + vertexRadius * Math.sin(a)));
  }
  const lines = closedLines(b, ids, construction);
  const centerId = resolve(b, center);
  const circle = b.circle(centerId, radius, true);
  const constraints: string[] = [];
  if (inscribed) for (const p of ids) constraints.push(b.constrain("coincident", p, circle));
  else for (const l of lines) constraints.push(b.constrain("tangent", l, circle));
  for (let i = 0; i + 1 < n; i++) {
    constraints.push(b.constrain("equal", lines[i]!, lines[i + 1]!));
  }
  return { entities: [...lines, circle], points: [...ids, centerId], constraints };
}

/**
 * Center-to-center slot. With d = direction c1→c2 and n = left normal, the boundary runs CCW:
 * line (c1−n·r → c2−n·r), arc around c2, line (c2+n·r → c1+n·r), arc around c1.
 * `entities` = [line, arc, line, arc, construction center line];
 * `points` = [c1, c2, and the four boundary points in loop order].
 */
export function createSlot(
  b: SketchBuilder,
  c1: PointInput,
  c2: PointInput,
  width: number,
  construction = false,
): CreateResult {
  if (!(width > 0)) throw new Error("Slot width must be positive");
  const a = posOf(b, c1);
  const c = posOf(b, c2);
  if (dist2(a, c) < 1e-12) throw new Error("Slot centers coincide");
  const n = scale2(perp2(norm2(sub2(c, a))), width / 2);
  const c1Id = resolve(b, c1);
  const c2Id = resolve(b, c2);
  const pt = (p: Vec2): EntityId => b.point(p.x, p.y);
  const r1 = pt(sub2(a, n));
  const r2 = pt(sub2(c, n));
  const l2 = pt(add2(c, n));
  const l1 = pt(add2(a, n));
  const lineA = b.line(r1, r2, construction);
  const arcA = b.arc(c2Id, r2, l2, construction);
  const lineB = b.line(l2, l1, construction);
  const arcB = b.arc(c1Id, l1, r1, construction);
  const axis = b.line(c1Id, c2Id, true);
  const constraints = [
    b.constrain("tangent", lineA, arcA),
    b.constrain("tangent", lineB, arcA),
    b.constrain("tangent", lineB, arcB),
    b.constrain("tangent", lineA, arcB),
    b.constrain("parallel", lineA, lineB),
  ];
  return {
    entities: [lineA, arcA, lineB, arcB, axis],
    points: [c1Id, c2Id, r1, r2, l2, l1],
    constraints,
  };
}

/** Fit point or control point spline. */
export function createSpline(
  b: SketchBuilder,
  kind: "fit" | "control",
  points: PointInput[],
  closed = false,
  construction = false,
): CreateResult {
  if (points.length < 2) throw new Error("A spline needs at least two points");
  if (closed && points.length < 3) throw new Error("A closed spline needs at least three points");
  const ids = points.map((p) => resolve(b, p));
  return { entities: [b.spline(kind, ids, closed, construction)], points: ids, constraints: [] };
}

export interface SketchToolDescriptor {
  id: string;
  label: string;
  group: "create";
  /** Number of point picks needed, or "many" for open-ended tools. */
  clicks: number | "many";
  description: string;
}

const tool = (
  id: string,
  label: string,
  clicks: number | "many",
  description: string,
): SketchToolDescriptor => ({ id, label, group: "create", clicks, description });

/** Registry of the create tools so a UI can build its toolbar generically. */
export const SKETCH_CREATE_TOOLS: SketchToolDescriptor[] = [
  tool("point", "Point", 1, "Place a sketch point"),
  tool("line", "Line", 2, "Line between two points"),
  tool("construction-line", "Construction Line", 2, "Reference line ignored by profiles"),
  tool("polyline", "Polyline", "many", "Chain of connected lines"),
  tool("rectangle-2point", "2-Point Rectangle", 2, "Rectangle from two opposite corners"),
  tool("rectangle-3point", "3-Point Rectangle", 3, "Rotated rectangle: edge, then height"),
  tool("rectangle-center", "Center Rectangle", 2, "Rectangle from its center and a corner"),
  tool("circle", "Center Diameter Circle", 2, "Circle from center and a point on it"),
  tool("circle-3point", "3-Point Circle", 3, "Circle through three points"),
  tool("arc-center", "Center Point Arc", 3, "Arc from center, start and end"),
  tool("arc-3point", "3-Point Arc", 3, "Arc from start, end and a point on the arc"),
  tool("ellipse", "Ellipse", 3, "Ellipse from center, major axis end and minor radius"),
  tool("polygon-inscribed", "Inscribed Polygon", 2, "Regular polygon with vertices on a circle"),
  tool(
    "polygon-circumscribed",
    "Circumscribed Polygon",
    2,
    "Regular polygon with edges tangent to a circle",
  ),
  tool("slot", "Center to Center Slot", 3, "Slot from two arc centers and a width"),
  tool("spline-fit", "Fit Point Spline", "many", "Spline through the picked points"),
  tool("spline-control", "Control Point Spline", "many", "Spline from a control polygon"),
];
