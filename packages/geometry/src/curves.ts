import {
  type Vec2,
  add2,
  cross2,
  dist2,
  dot2,
  len2,
  lerp2,
  norm2,
  normalizeAngle,
  scale2,
  sub2,
} from "./vec";
import { type Bounds2, boundsOfPoints } from "./polygon";

/**
 * Kernel-neutral 2D curve segments. Every curve is parameterised over t ∈ [0, 1].
 * Sweeps are signed: positive = counter-clockwise.
 */
export interface LineCurve {
  type: "line";
  a: Vec2;
  b: Vec2;
}

export interface ArcCurve {
  type: "arc";
  center: Vec2;
  radius: number;
  startAngle: number;
  /** Signed sweep in radians, |sweep| ≤ 2π. A full circle has |sweep| = 2π. */
  sweep: number;
}

export interface EllipseArcCurve {
  type: "ellipseArc";
  center: Vec2;
  rx: number;
  ry: number;
  /** Rotation of the major axis from +X in radians. */
  rotation: number;
  startParam: number;
  sweep: number;
}

export interface BezierCurve {
  type: "bezier";
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export type Curve2 = LineCurve | ArcCurve | EllipseArcCurve | BezierCurve;

/** A closed chain of curves; the end of each curve is the start of the next. */
export interface Loop2 {
  curves: Curve2[];
}

/** A planar region: one outer loop (counter-clockwise) and any number of holes (clockwise). */
export interface Profile2 {
  outer: Loop2;
  holes: Loop2[];
}

export function curvePointAt(c: Curve2, t: number): Vec2 {
  switch (c.type) {
    case "line":
      return lerp2(c.a, c.b, t);
    case "arc": {
      const a = c.startAngle + c.sweep * t;
      return { x: c.center.x + c.radius * Math.cos(a), y: c.center.y + c.radius * Math.sin(a) };
    }
    case "ellipseArc": {
      const u = c.startParam + c.sweep * t;
      const lx = c.rx * Math.cos(u);
      const ly = c.ry * Math.sin(u);
      const cr = Math.cos(c.rotation);
      const sr = Math.sin(c.rotation);
      return { x: c.center.x + lx * cr - ly * sr, y: c.center.y + lx * sr + ly * cr };
    }
    case "bezier": {
      const s = 1 - t;
      const b0 = s * s * s;
      const b1 = 3 * s * s * t;
      const b2 = 3 * s * t * t;
      const b3 = t * t * t;
      return {
        x: b0 * c.p0.x + b1 * c.p1.x + b2 * c.p2.x + b3 * c.p3.x,
        y: b0 * c.p0.y + b1 * c.p1.y + b2 * c.p2.y + b3 * c.p3.y,
      };
    }
  }
}

/** Derivative with respect to t (not normalised). */
export function curveDerivativeAt(c: Curve2, t: number): Vec2 {
  switch (c.type) {
    case "line":
      return sub2(c.b, c.a);
    case "arc": {
      const a = c.startAngle + c.sweep * t;
      return { x: -c.radius * Math.sin(a) * c.sweep, y: c.radius * Math.cos(a) * c.sweep };
    }
    case "ellipseArc": {
      const u = c.startParam + c.sweep * t;
      const lx = -c.rx * Math.sin(u) * c.sweep;
      const ly = c.ry * Math.cos(u) * c.sweep;
      const cr = Math.cos(c.rotation);
      const sr = Math.sin(c.rotation);
      return { x: lx * cr - ly * sr, y: lx * sr + ly * cr };
    }
    case "bezier": {
      const s = 1 - t;
      const a = scale2(sub2(c.p1, c.p0), 3 * s * s);
      const b = scale2(sub2(c.p2, c.p1), 6 * s * t);
      const d = scale2(sub2(c.p3, c.p2), 3 * t * t);
      return add2(add2(a, b), d);
    }
  }
}

export function curveTangentAt(c: Curve2, t: number): Vec2 {
  let d = curveDerivativeAt(c, t);
  if (len2(d) < 1e-12) {
    // Degenerate control points: fall back to a finite difference.
    const t0 = Math.max(0, t - 1e-4);
    const t1 = Math.min(1, t + 1e-4);
    d = sub2(curvePointAt(c, t1), curvePointAt(c, t0));
  }
  return norm2(d);
}

export const curveStart = (c: Curve2): Vec2 => curvePointAt(c, 0);
export const curveEnd = (c: Curve2): Vec2 => curvePointAt(c, 1);

export function reverseCurve(c: Curve2): Curve2 {
  switch (c.type) {
    case "line":
      return { type: "line", a: c.b, b: c.a };
    case "arc":
      return { ...c, startAngle: c.startAngle + c.sweep, sweep: -c.sweep };
    case "ellipseArc":
      return { ...c, startParam: c.startParam + c.sweep, sweep: -c.sweep };
    case "bezier":
      return { type: "bezier", p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 };
  }
}

/** Sub-curve between parameters t0 < t1. */
export function subCurve(c: Curve2, t0: number, t1: number): Curve2 {
  switch (c.type) {
    case "line":
      return { type: "line", a: lerp2(c.a, c.b, t0), b: lerp2(c.a, c.b, t1) };
    case "arc":
      return { ...c, startAngle: c.startAngle + c.sweep * t0, sweep: c.sweep * (t1 - t0) };
    case "ellipseArc":
      return { ...c, startParam: c.startParam + c.sweep * t0, sweep: c.sweep * (t1 - t0) };
    case "bezier": {
      const right = splitBezier(c, t0)[1];
      const u = t1 >= 1 ? 1 : (t1 - t0) / (1 - t0);
      return splitBezier(right, u)[0];
    }
  }
}

function splitBezier(c: BezierCurve, t: number): [BezierCurve, BezierCurve] {
  const p01 = lerp2(c.p0, c.p1, t);
  const p12 = lerp2(c.p1, c.p2, t);
  const p23 = lerp2(c.p2, c.p3, t);
  const p012 = lerp2(p01, p12, t);
  const p123 = lerp2(p12, p23, t);
  const mid = lerp2(p012, p123, t);
  return [
    { type: "bezier", p0: c.p0, p1: p01, p2: p012, p3: mid },
    { type: "bezier", p0: mid, p1: p123, p2: p23, p3: c.p3 },
  ];
}

/** Number of straight segments needed to stay within `tolerance` of the true curve. */
export function curveSegmentCount(c: Curve2, tolerance: number): number {
  const tol = Math.max(tolerance, 1e-6);
  switch (c.type) {
    case "line":
      return 1;
    case "arc": {
      if (c.radius <= tol) return Math.max(2, Math.ceil(Math.abs(c.sweep) / (Math.PI / 2)));
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / c.radius)));
      return Math.max(2, Math.ceil(Math.abs(c.sweep) / Math.max(step, 1e-3)));
    }
    case "ellipseArc": {
      const r = Math.max(c.rx, c.ry);
      if (r <= tol) return 4;
      const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
      return Math.max(4, Math.ceil(Math.abs(c.sweep) / Math.max(step, 1e-3)));
    }
    case "bezier": {
      // Bound from the second differences of the control polygon.
      const d1 = len2(add2(sub2(c.p0, scale2(c.p1, 2)), c.p2));
      const d2 = len2(add2(sub2(c.p1, scale2(c.p2, 2)), c.p3));
      const m = Math.max(d1, d2);
      return Math.max(2, Math.min(512, Math.ceil(Math.sqrt((0.75 * m) / tol))));
    }
  }
}

/** Polyline approximation including both end points. */
export function flattenCurve(c: Curve2, tolerance = 0.01): Vec2[] {
  const n = curveSegmentCount(c, tolerance);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(curvePointAt(c, i / n));
  return pts;
}

/** Polygon approximation of a closed loop (closing point not repeated). */
export function flattenLoop(loop: Loop2, tolerance = 0.01): Vec2[] {
  const pts: Vec2[] = [];
  for (const c of loop.curves) {
    const seg = flattenCurve(c, tolerance);
    for (let i = 0; i < seg.length - 1; i++) pts.push(seg[i]!);
  }
  return pts;
}

export function curveLength(c: Curve2): number {
  switch (c.type) {
    case "line":
      return dist2(c.a, c.b);
    case "arc":
      return Math.abs(c.sweep) * c.radius;
    default: {
      const pts = flattenCurve(c, 1e-3);
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += dist2(pts[i - 1]!, pts[i]!);
      return l;
    }
  }
}

export function curveBounds(c: Curve2): Bounds2 {
  if (c.type === "line") return boundsOfPoints([c.a, c.b]);
  if (c.type === "arc") {
    // Exact: the ends plus every axis direction that the arc sweeps over.
    const pts = [curveStart(c), curveEnd(c)];
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      if (Math.abs(c.sweep) >= 2 * Math.PI - 1e-12 || angleToArcParam(c, angle) !== null) {
        pts.push({
          x: c.center.x + c.radius * Math.cos(angle),
          y: c.center.y + c.radius * Math.sin(angle),
        });
      }
    }
    return boundsOfPoints(pts);
  }
  return boundsOfPoints(flattenCurve(c, 1e-4));
}

export function reverseLoop(loop: Loop2): Loop2 {
  return { curves: loop.curves.map(reverseCurve).reverse() };
}

export function translateCurve(c: Curve2, d: Vec2): Curve2 {
  switch (c.type) {
    case "line":
      return { type: "line", a: add2(c.a, d), b: add2(c.b, d) };
    case "arc":
    case "ellipseArc":
      return { ...c, center: add2(c.center, d) };
    case "bezier":
      return {
        type: "bezier",
        p0: add2(c.p0, d),
        p1: add2(c.p1, d),
        p2: add2(c.p2, d),
        p3: add2(c.p3, d),
      };
  }
}

/** Parameter of the point on the curve closest to `p`. */
export function closestParam(c: Curve2, p: Vec2): number {
  if (c.type === "line") {
    const d = sub2(c.b, c.a);
    const l2 = dot2(d, d);
    if (l2 < 1e-18) return 0;
    return Math.max(0, Math.min(1, dot2(sub2(p, c.a), d) / l2));
  }
  if (c.type === "arc") {
    const a = Math.atan2(p.y - c.center.y, p.x - c.center.x);
    const t = angleToArcParam(c, a);
    if (t !== null) return t;
    return dist2(p, curveStart(c)) <= dist2(p, curveEnd(c)) ? 0 : 1;
  }
  const n = Math.max(32, curveSegmentCount(c, 0.01));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= n; i++) {
    const d = dist2(curvePointAt(c, i / n), p);
    if (d < bestD) {
      bestD = d;
      best = i / n;
    }
  }
  let lo = Math.max(0, best - 1 / n);
  let hi = Math.min(1, best + 1 / n);
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist2(curvePointAt(c, m1), p) < dist2(curvePointAt(c, m2), p)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

export function distanceToCurve(c: Curve2, p: Vec2): number {
  return dist2(curvePointAt(c, closestParam(c, p)), p);
}

/** Map an absolute angle to the arc parameter, or null when the angle is outside the sweep. */
export function angleToArcParam(c: ArcCurve, angle: number, tol = 1e-9): number | null {
  if (Math.abs(c.sweep) < 1e-15) return null;
  const delta =
    c.sweep > 0 ? normalizeAngle(angle - c.startAngle) : -normalizeAngle(c.startAngle - angle);
  let t = delta / c.sweep;
  if (t > 1 + tol) {
    // The start angle itself may have wrapped by a full turn.
    const alt = (Math.abs(delta) - 2 * Math.PI) / Math.abs(c.sweep);
    if (Math.abs(alt) <= tol) return 0;
    return null;
  }
  if (t < 0) t = 0;
  return Math.min(1, t);
}

export interface CurveIntersection {
  point: Vec2;
  ta: number;
  tb: number;
}

const PARAM_TOL = 1e-9;

function lineLine(a: LineCurve, b: LineCurve): CurveIntersection[] {
  const d = sub2(a.b, a.a);
  const e = sub2(b.b, b.a);
  const den = cross2(d, e);
  if (Math.abs(den) < 1e-12 * Math.max(1, len2(d) * len2(e))) return [];
  const w = sub2(b.a, a.a);
  const ta = cross2(w, e) / den;
  const tb = cross2(w, d) / den;
  const ea = 1e-7 / Math.max(len2(d), 1e-9);
  const eb = 1e-7 / Math.max(len2(e), 1e-9);
  if (ta < -ea || ta > 1 + ea || tb < -eb || tb > 1 + eb) return [];
  const cta = Math.max(0, Math.min(1, ta));
  return [{ point: lerp2(a.a, a.b, cta), ta: cta, tb: Math.max(0, Math.min(1, tb)) }];
}

function lineArc(l: LineCurve, c: ArcCurve): CurveIntersection[] {
  const d = sub2(l.b, l.a);
  const f = sub2(l.a, c.center);
  const A = dot2(d, d);
  if (A < 1e-18) return [];
  const B = 2 * dot2(f, d);
  const C = dot2(f, f) - c.radius * c.radius;
  let disc = B * B - 4 * A * C;
  const scale = Math.max(1, A * c.radius * c.radius);
  if (disc < -1e-9 * scale) return [];
  if (disc < 0) disc = 0;
  const s = Math.sqrt(disc);
  const roots = disc < 1e-12 * scale ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  const out: CurveIntersection[] = [];
  const e = 1e-7 / Math.sqrt(A);
  for (const t of roots) {
    if (t < -e || t > 1 + e) continue;
    const ct = Math.max(0, Math.min(1, t));
    const p = lerp2(l.a, l.b, ct);
    const tb = angleToArcParam(c, Math.atan2(p.y - c.center.y, p.x - c.center.x), 1e-7);
    if (tb === null) continue;
    out.push({ point: p, ta: ct, tb });
  }
  return out;
}

function arcArc(a: ArcCurve, b: ArcCurve): CurveIntersection[] {
  const d = dist2(a.center, b.center);
  if (d < 1e-9) return [];
  if (d > a.radius + b.radius + 1e-9 || d < Math.abs(a.radius - b.radius) - 1e-9) return [];
  const x = (d * d + a.radius * a.radius - b.radius * b.radius) / (2 * d);
  let h2 = a.radius * a.radius - x * x;
  if (h2 < 0) h2 = 0;
  const h = Math.sqrt(h2);
  const dir = norm2(sub2(b.center, a.center));
  const base = add2(a.center, scale2(dir, x));
  const n = { x: -dir.y, y: dir.x };
  const cands = h < 1e-7 ? [base] : [add2(base, scale2(n, h)), sub2(base, scale2(n, h))];
  const out: CurveIntersection[] = [];
  for (const p of cands) {
    const ta = angleToArcParam(a, Math.atan2(p.y - a.center.y, p.x - a.center.x), 1e-7);
    const tb = angleToArcParam(b, Math.atan2(p.y - b.center.y, p.x - b.center.x), 1e-7);
    if (ta === null || tb === null) continue;
    out.push({ point: p, ta, tb });
  }
  return out;
}

function numericIntersections(a: Curve2, b: Curve2): CurveIntersection[] {
  const na = Math.max(16, curveSegmentCount(a, 0.005));
  const nb = Math.max(16, curveSegmentCount(b, 0.005));
  const pa: Vec2[] = [];
  const pb: Vec2[] = [];
  for (let i = 0; i <= na; i++) pa.push(curvePointAt(a, i / na));
  for (let j = 0; j <= nb; j++) pb.push(curvePointAt(b, j / nb));
  const out: CurveIntersection[] = [];
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const hit = lineLine(
        { type: "line", a: pa[i]!, b: pa[i + 1]! },
        { type: "line", a: pb[j]!, b: pb[j + 1]! },
      )[0];
      if (!hit) continue;
      let ta = (i + hit.ta) / na;
      let tb = (j + hit.tb) / nb;
      // Newton refinement on F(ta, tb) = A(ta) - B(tb).
      for (let k = 0; k < 8; k++) {
        const f = sub2(curvePointAt(a, ta), curvePointAt(b, tb));
        if (len2(f) < 1e-11) break;
        const da = curveDerivativeAt(a, ta);
        const db = curveDerivativeAt(b, tb);
        const det = -da.x * db.y + db.x * da.y;
        if (Math.abs(det) < 1e-14) break;
        const dta = (f.x * db.y - db.x * f.y) / det;
        const dtb = (da.y * f.x - da.x * f.y) / det;
        ta = Math.max(0, Math.min(1, ta + dta));
        tb = Math.max(0, Math.min(1, tb + dtb));
      }
      const p = curvePointAt(a, ta);
      if (dist2(p, curvePointAt(b, tb)) > 1e-4) {
        ta = (i + hit.ta) / na;
        tb = (j + hit.tb) / nb;
      }
      const point = curvePointAt(a, ta);
      if (!out.some((o) => dist2(o.point, point) < 1e-6)) out.push({ point, ta, tb });
    }
  }
  return out;
}

/** All intersection points between two curve segments. Overlapping collinear parts are ignored. */
export function intersectCurves(a: Curve2, b: Curve2): CurveIntersection[] {
  let res: CurveIntersection[];
  if (a.type === "line" && b.type === "line") res = lineLine(a, b);
  else if (a.type === "line" && b.type === "arc") res = lineArc(a, b);
  else if (a.type === "arc" && b.type === "line") {
    res = lineArc(b, a).map((r) => ({ point: r.point, ta: r.tb, tb: r.ta }));
  } else if (a.type === "arc" && b.type === "arc") res = arcArc(a, b);
  else res = numericIntersections(a, b);
  return res.filter((r) => r.ta >= -PARAM_TOL && r.tb >= -PARAM_TOL);
}

/** Build an arc through three points. Returns null for collinear input. */
export function arcThroughPoints(p0: Vec2, p1: Vec2, p2: Vec2): ArcCurve | null {
  const c = circumcenter(p0, p1, p2);
  if (!c) return null;
  const radius = dist2(c, p0);
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
  const ccwTo1 = normalizeAngle(a1 - a0);
  const ccwTo2 = normalizeAngle(a2 - a0);
  const sweep = ccwTo1 <= ccwTo2 ? ccwTo2 : ccwTo2 - 2 * Math.PI;
  return { type: "arc", center: c, radius, startAngle: a0, sweep };
}

export function circumcenter(p0: Vec2, p1: Vec2, p2: Vec2): Vec2 | null {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const d = 2 * (ax * by - ay * bx);
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  return { x: p0.x + (by * a2 - ay * b2) / d, y: p0.y + (ax * b2 - bx * a2) / d };
}

/**
 * Interpolating spline through fit points as cubic Béziers (centripetal-free Catmull-Rom with
 * natural end tangents). `closed` wraps around.
 */
export function fitSplineToBeziers(points: readonly Vec2[], closed = false): BezierCurve[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) {
    const [a, b] = [points[0]!, points[1]!];
    return [{ type: "bezier", p0: a, p1: lerp2(a, b, 1 / 3), p2: lerp2(a, b, 2 / 3), p3: b }];
  }
  const at = (i: number): Vec2 => {
    if (closed) return points[((i % n) + n) % n]!;
    if (i < 0) return sub2(scale2(points[0]!, 2), points[1]!);
    if (i >= n) return sub2(scale2(points[n - 1]!, 2), points[n - 2]!);
    return points[i]!;
  };
  const out: BezierCurve[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    out.push({
      type: "bezier",
      p0: p1,
      p1: add2(p1, scale2(sub2(p2, p0), 1 / 6)),
      p2: sub2(p2, scale2(sub2(p3, p1), 1 / 6)),
      p3: p2,
    });
  }
  return out;
}

/** Clamped uniform cubic B-spline through a control polygon, converted to Béziers. */
export function controlSplineToBeziers(points: readonly Vec2[], closed = false): BezierCurve[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) return fitSplineToBeziers(points);
  if (n === 3 && !closed) {
    // Quadratic elevated to cubic.
    const [a, b, c] = [points[0]!, points[1]!, points[2]!];
    return [{ type: "bezier", p0: a, p1: lerp2(a, b, 2 / 3), p2: lerp2(c, b, 2 / 3), p3: c }];
  }
  if (n === 4 && !closed) {
    return [{ type: "bezier", p0: points[0]!, p1: points[1]!, p2: points[2]!, p3: points[3]! }];
  }
  const out: BezierCurve[] = [];
  if (closed) {
    const at = (i: number): Vec2 => points[((i % n) + n) % n]!;
    for (let i = 0; i < n; i++) {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const d = at(i + 2);
      out.push({
        type: "bezier",
        p0: scale2(add2(add2(a, scale2(b, 4)), c), 1 / 6),
        p1: lerp2(b, c, 1 / 3),
        p2: lerp2(b, c, 2 / 3),
        p3: scale2(add2(add2(b, scale2(c, 4)), d), 1 / 6),
      });
    }
    return out;
  }
  // Clamped: evaluate with de Boor on a clamped uniform knot vector and extract Bézier spans.
  const degree = 3;
  const spans = n - degree;
  const knots: number[] = [];
  for (let i = 0; i < n + degree + 1; i++) {
    knots.push(Math.max(0, Math.min(spans, i - degree)));
  }
  const deBoor = (u: number): Vec2 => {
    let k = Math.min(Math.floor(u), spans - 1) + degree;
    if (u >= spans) k = n - 1;
    const d: Vec2[] = [];
    for (let j = 0; j <= degree; j++) d.push(points[j + k - degree]!);
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = j + k - degree;
        const den = knots[i + degree - r + 1]! - knots[i]!;
        const alpha = den === 0 ? 0 : (u - knots[i]!) / den;
        d[j] = lerp2(d[j - 1]!, d[j]!, alpha);
      }
    }
    return d[degree]!;
  };
  const deriv = (u: number): Vec2 => {
    const h = 1e-5;
    const u0 = Math.max(0, u - h);
    const u1 = Math.min(spans, u + h);
    return scale2(sub2(deBoor(u1), deBoor(u0)), 1 / (u1 - u0));
  };
  for (let s = 0; s < spans; s++) {
    const p0 = deBoor(s);
    const p3 = deBoor(s + 1);
    out.push({
      type: "bezier",
      p0,
      p1: add2(p0, scale2(deriv(s), 1 / 3)),
      p2: sub2(p3, scale2(deriv(s + 1), 1 / 3)),
      p3,
    });
  }
  return out;
}
