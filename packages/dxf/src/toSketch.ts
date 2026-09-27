import {
  type Bounds2,
  type Vec2,
  curveBounds,
  emptyBounds2,
  expandBounds2,
  normalizeAngle,
  unionBounds2,
} from "@fabcad/geometry";
import {
  type EntityId,
  type Sketch,
  SketchBuilder,
  entityToCurves,
  isCurve,
} from "@fabcad/sketch";
import { type DxfDrawing, type DxfEntity, bulgeArc, isFullEllipse } from "./parse";

/**
 * Conversion of a parsed DXF drawing into sketch entities. Everything is converted to
 * millimetres. The geometry is free geometry: no constraints and no dimensions are created,
 * but end points that coincide share one sketch point so that closed outlines are profiles.
 */

export interface DxfImportOptions {
  /** Used when the file is unitless. Default "mm". */
  assumeUnit?: "mm" | "inch";
  /** Override the unit found in the file. */
  forceUnit?: "mm" | "inch" | "cm" | "m";
  /** Layers to import (default: all). */
  layers?: string[];
  /** Layers whose geometry becomes construction geometry. */
  constructionLayers?: string[];
  /** Merge end points that coincide within this distance (mm) into shared sketch points so that closed outlines become closed profiles. Default 1e-4. */
  mergeTolerance?: number;
  /** Translate the drawing (applied after scaling), e.g. to place it at the sketch origin. */
  offset?: Vec2;
}

export interface DxfImportResult {
  sketch: Sketch;
  /** Ids of the created curve entities. */
  created: EntityId[];
  /** Ids of the sketch points created from POINT entities. */
  points: EntityId[];
  /** Layer of every created entity (curves and POINT entities), kept so that layer information is not lost. */
  layerOf: Record<EntityId, string>;
  /** Scale factor that was applied (e.g. 25.4 for inch). */
  scale: number;
  unit: "mm" | "inch" | "cm" | "m";
  /** Bounds of the imported geometry in mm, null when nothing was imported. */
  bounds: Bounds2 | null;
  /** Warnings of the conversion. The warnings of the parser are in `drawing.warnings`. */
  warnings: string[];
}

export const DXF_UNIT_SCALE: Record<"mm" | "inch" | "cm" | "m", number> = {
  mm: 1,
  inch: 25.4,
  cm: 10,
  m: 1000,
};

const TWO_PI = 2 * Math.PI;
/** Lengths and radii below this (mm) are degenerate. */
const MIN_SIZE = 1e-9;
/**
 * Points per full turn when an elliptical arc is replaced by a fit spline. The deviation is
 * largest in the first and the last span (the fit spline has natural end tangents): about
 * 2·10⁻⁴ of the major radius, and well below 10⁻⁶ of it elsewhere.
 */
const ELLIPSE_SAMPLES_PER_TURN = 96;
/** Points per knot span when a spline is replaced by a fit spline. */
const SPLINE_SAMPLES_PER_SPAN = 8;
const MAX_SPLINE_SAMPLES = 2000;

interface PooledPoint {
  id: EntityId;
  at: Vec2;
}

/** Spatial hash of the end points created so far; points within the tolerance are shared. */
class PointPool {
  private readonly grid = new Map<string, PooledPoint[]>();
  private readonly cell: number;

  constructor(
    private readonly builder: SketchBuilder,
    private readonly tolerance: number,
  ) {
    this.cell = Math.max(tolerance, 1e-9);
  }

  /** The existing point within the tolerance of `p`, or a new point. */
  shared(p: Vec2): PooledPoint {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    let best: PooledPoint | undefined;
    let bestDistance = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(q.at.x - p.x, q.at.y - p.y);
          if (d <= this.tolerance && d < bestDistance) {
            best = q;
            bestDistance = d;
          }
        }
      }
    }
    if (best) return best;
    const created: PooledPoint = { id: this.builder.point(p.x, p.y), at: { x: p.x, y: p.y } };
    const key = `${cx},${cy}`;
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(created);
    else this.grid.set(key, [created]);
    return created;
  }
}

const finite = (...values: number[]): boolean => values.every((v) => Number.isFinite(v));
const finitePoints = (points: readonly Vec2[]): boolean => points.every((p) => finite(p.x, p.y));

/**
 * Centre of the arc through `start` and `end` that is closest to `center`: the projection of
 * `center` onto the perpendicular bisector of the chord. End points that were merged into a
 * shared point are moved by up to the merge tolerance; re-centring keeps both of them exactly
 * on the arc, which profile detection needs to close the outline.
 */
function recenter(center: Vec2, start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return center;
  const nx = -dy / length;
  const ny = dx / length;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const along = (center.x - mx) * nx + (center.y - my) * ny;
  return { x: mx + nx * along, y: my + ny * along };
}

// ---------------------------------------------------------------------------------------------
// Splines
// ---------------------------------------------------------------------------------------------

/** Clamped uniform knot vector for `count` control points. */
function clampedUniformKnots(count: number, degree: number): number[] {
  const spans = count - degree;
  const knots: number[] = [];
  for (let i = 0; i < count + degree + 1; i++) knots.push(Math.max(0, Math.min(spans, i - degree)));
  return knots;
}

function isNonDecreasing(knots: readonly number[]): boolean {
  for (let i = 1; i < knots.length; i++) if (knots[i]! < knots[i - 1]! - 1e-12) return false;
  return true;
}

/** True when the knot vector is clamped at both ends with equally long spans in between. */
function isClampedUniform(knots: readonly number[], count: number, degree: number): boolean {
  if (knots.length !== count + degree + 1) return false;
  const lo = knots[0]!;
  const hi = knots[knots.length - 1]!;
  const range = hi - lo;
  if (!(range > 0)) return false;
  const eps = 1e-6 * range;
  const spans = count - degree;
  for (let i = 0; i < knots.length; i++) {
    const expected = lo + (Math.max(0, Math.min(spans, i - degree)) / spans) * range;
    if (Math.abs(knots[i]! - expected) > eps) return false;
  }
  return true;
}

/**
 * Point of a (rational) B-spline by de Boor's algorithm.
 *
 * With the knot span k (knots[k] ≤ u < knots[k+1]) only the control points k−degree … k are
 * involved. They are repeatedly blended, d[j] ← (1−α)·d[j−1] + α·d[j] with
 * α = (u − knots[i]) / (knots[i+degree−r+1] − knots[i]), i = k − degree + j, for the rounds
 * r = 1 … degree; the last remaining point is the point of the curve. Rational splines are
 * evaluated in homogeneous coordinates (x·w, y·w, w) and projected back at the end.
 */
export function evaluateBSpline(
  degree: number,
  knots: readonly number[],
  controlPoints: readonly Vec2[],
  weights: readonly number[] | undefined,
  u: number,
): Vec2 {
  const n = controlPoints.length;
  let k = degree;
  while (k < n - 1 && u >= knots[k + 1]!) k++;
  const d: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j <= degree; j++) {
    const index = k - degree + j;
    const p = controlPoints[index]!;
    const w = weights?.[index] ?? 1;
    d.push({ x: p.x * w, y: p.y * w, w });
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const span = knots[i + degree - r + 1]! - knots[i]!;
      const alpha = span > 0 ? (u - knots[i]!) / span : 0;
      const a = d[j - 1]!;
      const b = d[j]!;
      d[j] = {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        w: a.w + (b.w - a.w) * alpha,
      };
    }
  }
  const result = d[degree]!;
  return result.w !== 0 ? { x: result.x / result.w, y: result.y / result.w } : { x: result.x, y: result.y };
}

/** Points on a B-spline: every non-empty knot span is divided evenly. */
function sampleBSpline(
  degree: number,
  knots: readonly number[],
  controlPoints: readonly Vec2[],
  weights: readonly number[] | undefined,
): Vec2[] {
  const n = controlPoints.length;
  const spans: [number, number][] = [];
  for (let k = degree; k < n; k++) {
    const from = knots[k]!;
    const to = knots[k + 1]!;
    if (to - from > 1e-12) spans.push([from, to]);
  }
  if (spans.length === 0) return [];
  const perSpan = Math.max(2, Math.min(SPLINE_SAMPLES_PER_SPAN, Math.floor(MAX_SPLINE_SAMPLES / spans.length)));
  const out: Vec2[] = [];
  for (const [from, to] of spans) {
    for (let j = 0; j < perSpan; j++) {
      out.push(evaluateBSpline(degree, knots, controlPoints, weights, from + ((to - from) * j) / perSpan));
    }
  }
  // The end of the domain: the span search stops at the last span, so this is its end point.
  out.push(evaluateBSpline(degree, knots, controlPoints, weights, spans[spans.length - 1]![1]));
  return out;
}

// ---------------------------------------------------------------------------------------------

interface Counters {
  degenerate: number;
  ellipseArcs: number;
  sampledSplines: number;
  repairedKnots: number;
}

export function importDxfIntoSketch(
  sketch: Sketch,
  drawing: DxfDrawing,
  options: DxfImportOptions = {},
): DxfImportResult {
  const warnings: string[] = [];
  let unit: "mm" | "inch" | "cm" | "m";
  if (options.forceUnit) {
    unit = options.forceUnit;
  } else if (drawing.units !== "unitless") {
    unit = drawing.units;
  } else {
    unit = options.assumeUnit ?? "mm";
    warnings.push(
      `The file does not specify a unit; ${unit === "mm" ? "millimetres" : "inches"} were assumed.`,
    );
  }
  const scale = DXF_UNIT_SCALE[unit];
  const offset = options.offset ?? { x: 0, y: 0 };
  const tolerance = Math.max(0, options.mergeTolerance ?? 1e-4);
  const layerFilter = options.layers ? new Set(options.layers) : null;
  const constructionLayers = new Set(options.constructionLayers ?? []);

  // The builder copies the entity maps, the input sketch is not modified.
  const builder = new SketchBuilder(sketch);
  const pool = new PointPool(builder, tolerance);
  const created: EntityId[] = [];
  const points: EntityId[] = [];
  const layerOf: Record<EntityId, string> = {};
  const counters: Counters = { degenerate: 0, ellipseArcs: 0, sampledSplines: 0, repairedKnots: 0 };

  const map = (p: Vec2): Vec2 => ({ x: p.x * scale + offset.x, y: p.y * scale + offset.y });

  const addLine = (a: PooledPoint, b: PooledPoint, layer: string, construction: boolean): boolean => {
    if (a.id === b.id || Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y) < MIN_SIZE) return false;
    const id = builder.line(a.id, b.id, construction);
    created.push(id);
    layerOf[id] = layer;
    return true;
  };

  /** Counter-clockwise arc from `start` to `end` (positions in mm). */
  const addArc = (
    center: Vec2,
    radius: number,
    start: Vec2,
    end: Vec2,
    sweep: number,
    layer: string,
    construction: boolean,
  ): boolean => {
    if (!finite(center.x, center.y, radius, sweep) || radius < MIN_SIZE || radius * sweep < MIN_SIZE) {
      return false;
    }
    const s = pool.shared(start);
    const e = pool.shared(end);
    let id: EntityId;
    if (s.id === e.id) {
      // The end points fell together: either a full turn or an arc shorter than the tolerance.
      if (sweep < Math.PI) return false;
      id = builder.circle(center, radius, construction);
    } else {
      id = builder.arc(recenter(center, s.at, e.at), s.id, e.id, construction);
    }
    created.push(id);
    layerOf[id] = layer;
    return true;
  };

  const addFitSpline = (
    samples: readonly Vec2[],
    closed: boolean,
    layer: string,
    construction: boolean,
  ): boolean => {
    const pts: Vec2[] = [];
    for (const p of samples) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_SIZE) continue;
      pts.push(p);
    }
    let isClosed = closed;
    if (pts.length > 2) {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(tolerance, MIN_SIZE) && closed) pts.pop();
    }
    if (isClosed && pts.length < 3) isClosed = false;
    if (pts.length < 2 || !finitePoints(pts)) return false;
    const ids: EntityId[] = pts.map((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      return !isClosed && isEnd ? pool.shared(p).id : builder.point(p.x, p.y);
    });
    if (ids.length === 2 && ids[0] === ids[1]) return false;
    const id = builder.spline("fit", ids, isClosed, construction);
    created.push(id);
    layerOf[id] = layer;
    return true;
  };

  const convert = (e: DxfEntity): void => {
    const construction = constructionLayers.has(e.layer);
    switch (e.type) {
      case "point": {
        const at = map(e.at);
        if (!finite(at.x, at.y)) {
          counters.degenerate++;
          return;
        }
        const id = builder.point(at.x, at.y, construction);
        points.push(id);
        layerOf[id] = e.layer;
        return;
      }
      case "line": {
        const a = map(e.a);
        const b = map(e.b);
        if (!finitePoints([a, b]) || Math.hypot(b.x - a.x, b.y - a.y) < MIN_SIZE) {
          counters.degenerate++;
          return;
        }
        if (!addLine(pool.shared(a), pool.shared(b), e.layer, construction)) counters.degenerate++;
        return;
      }
      case "circle": {
        const center = map(e.center);
        const radius = Math.abs(e.radius) * scale;
        if (!finite(center.x, center.y, radius) || radius < MIN_SIZE) {
          counters.degenerate++;
          return;
        }
        const id = builder.circle(center, radius, construction);
        created.push(id);
        layerOf[id] = e.layer;
        return;
      }
      case "arc": {
        const center = map(e.center);
        const radius = Math.abs(e.radius) * scale;
        let sweep = normalizeAngle(e.endAngle - e.startAngle);
        // Equal start and end angles denote a full circle.
        if (sweep < 1e-12) sweep = TWO_PI;
        const at = (angle: number): Vec2 => ({
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        });
        if (!addArc(center, radius, at(e.startAngle), at(e.endAngle), sweep, e.layer, construction)) {
          counters.degenerate++;
        }
        return;
      }
      case "polyline": {
        const n = e.vertices.length;
        if (n < 2 || !finitePoints(e.vertices.map((v) => v.point))) {
          counters.degenerate++;
          return;
        }
        const nodes = e.vertices.map((v) => pool.shared(map(v.point)));
        const count = e.closed ? n : n - 1;
        let segments = 0;
        for (let i = 0; i < count; i++) {
          const from = nodes[i]!;
          const to = nodes[(i + 1) % n]!;
          // Repeated vertices (e.g. a closing vertex equal to the first) give no segment.
          if (from.id === to.id) continue;
          // The arc is computed from the shared points, so that both lie exactly on it.
          const arc = bulgeArc(from.at, to.at, e.vertices[i]!.bulge);
          if (arc && finite(arc.center.x, arc.center.y, arc.radius)) {
            const start = arc.clockwise ? to : from;
            const end = arc.clockwise ? from : to;
            const id = builder.arc(arc.center, start.id, end.id, construction);
            created.push(id);
            layerOf[id] = e.layer;
            segments++;
          } else if (addLine(from, to, e.layer, construction)) {
            segments++;
          }
        }
        if (segments === 0) counters.degenerate++;
        return;
      }
      case "ellipse": {
        const center = map(e.center);
        let major = { x: e.majorAxis.x * scale, y: e.majorAxis.y * scale };
        let ratio = Math.abs(e.ratio);
        let start = e.startParam;
        let end = e.endParam;
        if (ratio > 1) {
          // The "major" axis of the file is the shorter one: use the other axis, a quarter
          // turn further, and shift the parameters accordingly.
          major = { x: -major.y * ratio, y: major.x * ratio };
          ratio = 1 / ratio;
          start -= Math.PI / 2;
          end -= Math.PI / 2;
        }
        const majorRadius = Math.hypot(major.x, major.y);
        const minorRadius = majorRadius * ratio;
        if (
          !finite(center.x, center.y, major.x, major.y, ratio, start, end) ||
          majorRadius < MIN_SIZE ||
          minorRadius < MIN_SIZE
        ) {
          counters.degenerate++;
          return;
        }
        if (isFullEllipse(start, end)) {
          const id = builder.ellipse(
            center,
            { x: center.x + major.x, y: center.y + major.y },
            minorRadius,
            construction,
          );
          created.push(id);
          layerOf[id] = e.layer;
          return;
        }
        // The sketch has no elliptical arc: a fit spline through points of the arc replaces it.
        const sweep = normalizeAngle(end - start);
        const steps = Math.max(12, Math.ceil((sweep / TWO_PI) * ELLIPSE_SAMPLES_PER_TURN));
        const samples: Vec2[] = [];
        for (let i = 0; i <= steps; i++) {
          const t = start + (sweep * i) / steps;
          const c = Math.cos(t);
          const s = Math.sin(t);
          samples.push({
            x: center.x + c * major.x - s * major.y * ratio,
            y: center.y + c * major.y + s * major.x * ratio,
          });
        }
        if (addFitSpline(samples, false, e.layer, construction)) counters.ellipseArcs++;
        else counters.degenerate++;
        return;
      }
      case "spline": {
        const fit = e.fitPoints.map(map);
        if (fit.length >= 2) {
          if (!addFitSpline(fit, e.closed, e.layer, construction)) counters.degenerate++;
          return;
        }
        const control = e.controlPoints.map(map);
        const n = control.length;
        const degree = e.degree;
        if (n < 2 || degree < 1 || n < degree + 1 || !finitePoints(control)) {
          counters.degenerate++;
          return;
        }
        const weights =
          e.weights && e.weights.length === n && e.weights.every((w) => Number.isFinite(w) && w > 0)
            ? e.weights
            : undefined;
        let knots = e.knots;
        if (knots.length !== n + degree + 1 || !isNonDecreasing(knots) || !finite(...knots)) {
          if (knots.length > 0) counters.repairedKnots++;
          knots = clampedUniformKnots(n, degree);
        }
        const uniform = isClampedUniform(knots, n, degree);

        if (degree === 1) {
          // A polygon through the control points.
          const nodes = control.map((p) => pool.shared(p));
          let segments = 0;
          const count = e.closed ? n : n - 1;
          for (let i = 0; i < count; i++) {
            if (addLine(nodes[i]!, nodes[(i + 1) % n]!, e.layer, construction)) segments++;
          }
          if (segments === 0) counters.degenerate++;
          return;
        }
        const first = control[0]!;
        const last = control[n - 1]!;
        const ringed = Math.hypot(first.x - last.x, first.y - last.y) <= Math.max(tolerance, MIN_SIZE);
        // Sketch control splines are clamped uniform cubic B-splines (three control points:
        // a quadratic Bézier), which is exactly what these files describe.
        const exact =
          !weights && uniform && !ringed && ((degree === 3 && n >= 4) || (degree === 2 && n === 3));
        if (exact) {
          const ids = control.map((p, i) =>
            i === 0 || i === n - 1 ? pool.shared(p).id : builder.point(p.x, p.y),
          );
          const id = builder.spline("control", ids, false, construction);
          created.push(id);
          layerOf[id] = e.layer;
          return;
        }
        const samples = sampleBSpline(degree, knots, control, weights);
        const a = samples[0];
        const b = samples[samples.length - 1];
        const closed =
          !!a && !!b && samples.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(tolerance, MIN_SIZE);
        if (addFitSpline(samples, closed, e.layer, construction)) counters.sampledSplines++;
        else counters.degenerate++;
        return;
      }
    }
  };

  for (const e of drawing.entities) {
    if (layerFilter && !layerFilter.has(e.layer)) continue;
    convert(e);
  }

  const result = builder.build();

  let bounds: Bounds2 | null = null;
  if (created.length + points.length > 0) {
    let b = emptyBounds2();
    for (const id of created) {
      const entity = result.entities[id];
      if (!isCurve(entity)) continue;
      for (const c of entityToCurves(result, entity)) b = unionBounds2(b, curveBounds(c));
    }
    for (const id of points) {
      const p = result.entities[id];
      if (p?.type === "point") expandBounds2(b, { x: p.x, y: p.y });
    }
    if (finite(b.minX, b.minY, b.maxX, b.maxY)) bounds = b;
  }

  if (counters.degenerate > 0) {
    warnings.push(
      counters.degenerate === 1
        ? "1 degenerate entity (zero length or zero radius) was skipped."
        : `${counters.degenerate} degenerate entities (zero length or zero radius) were skipped.`,
    );
  }
  if (counters.ellipseArcs > 0) {
    warnings.push(
      counters.ellipseArcs === 1
        ? "1 elliptical arc was converted to a spline through points of the arc (approximation)."
        : `${counters.ellipseArcs} elliptical arcs were converted to splines through points of the arcs (approximation).`,
    );
  }
  if (counters.sampledSplines > 0) {
    warnings.push(
      counters.sampledSplines === 1
        ? "1 spline (rational, closed, non-uniform or not of degree 3) was converted to a spline through points of the curve (approximation)."
        : `${counters.sampledSplines} splines (rational, closed, non-uniform or not of degree 3) were converted to splines through points of the curve (approximation).`,
    );
  }
  if (counters.repairedKnots > 0) {
    warnings.push(
      counters.repairedKnots === 1
        ? "1 spline has an invalid knot vector; a uniform one was used instead."
        : `${counters.repairedKnots} splines have an invalid knot vector; a uniform one was used instead.`,
    );
  }
  if (layerFilter && created.length + points.length === 0 && drawing.entities.length > 0) {
    warnings.push("No entity lies on the selected layers.");
  }

  return { sketch: result, created, points, layerOf, scale, unit, bounds, warnings };
}
