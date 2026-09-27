import { type Vec2, EPS, cross2, dist2, norm2, perp2, sub2 } from "./vec";

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBounds2 = (): Bounds2 => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export function expandBounds2(b: Bounds2, p: Vec2): Bounds2 {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
  return b;
}

export function boundsOfPoints(points: Iterable<Vec2>): Bounds2 {
  const b = emptyBounds2();
  for (const p of points) expandBounds2(b, p);
  return b;
}

export const unionBounds2 = (a: Bounds2, b: Bounds2): Bounds2 => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/** Signed area: positive for counter-clockwise polygons. */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const isCCW = (poly: readonly Vec2[]): boolean => signedArea(poly) > 0;

export function ensureCCW(poly: readonly Vec2[]): Vec2[] {
  return isCCW(poly) ? poly.slice() : poly.slice().reverse();
}

export function ensureCW(poly: readonly Vec2[]): Vec2[] {
  return isCCW(poly) ? poly.slice().reverse() : poly.slice();
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonPerimeter(poly: readonly Vec2[]): number {
  let l = 0;
  for (let i = 0; i < poly.length; i++) l += dist2(poly[i]!, poly[(i + 1) % poly.length]!);
  return l;
}

/** Remove consecutive duplicate points and collinear vertices. */
export function cleanPolygon(poly: readonly Vec2[], tol = 1e-7): Vec2[] {
  const dedup: Vec2[] = [];
  for (const p of poly) {
    const last = dedup[dedup.length - 1];
    if (!last || dist2(last, p) > tol) dedup.push(p);
  }
  while (dedup.length > 1 && dist2(dedup[0]!, dedup[dedup.length - 1]!) <= tol) dedup.pop();
  if (dedup.length < 3) return dedup;
  const out: Vec2[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const prev = dedup[(i + dedup.length - 1) % dedup.length]!;
    const cur = dedup[i]!;
    const next = dedup[(i + 1) % dedup.length]!;
    const c = cross2(sub2(cur, prev), sub2(next, cur));
    const scale = dist2(prev, cur) * dist2(cur, next);
    if (Math.abs(c) > tol * Math.max(scale, 1e-12) * 10 || scale < EPS) out.push(cur);
  }
  return out.length >= 3 ? out : dedup;
}

/** Intersection of two infinite lines given as point + direction. Returns null when parallel. */
export function intersectLines(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross2(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross2(sub2(q, p), e) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

export interface OffsetResult {
  polygon: Vec2[];
  /** Indices of edges that collapsed or flipped direction because the offset was too large. */
  collapsedEdges: number[];
}

/**
 * Offset every edge of a polygon by its own distance and re-intersect neighbours (miter join).
 * Edge `i` runs from vertex `i` to vertex `i + 1`. Positive distances move the edge towards the
 * polygon interior for counter-clockwise input. Topology is preserved; edges that would flip are
 * reported rather than removed so callers can warn about unreproducible geometry.
 */
export function offsetPolygonEdges(poly: readonly Vec2[], inward: readonly number[]): OffsetResult {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const lines: { p: Vec2; d: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const d = norm2(sub2(b, a));
    const nrm = perp2(d); // left of travel = interior for CCW
    const off = (inward[i] ?? 0) * sign;
    lines.push({ p: { x: a.x + nrm.x * off, y: a.y + nrm.y * off }, d });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i + n - 1) % n]!;
    const cur = lines[i]!;
    const hit = intersectLines(prev.p, prev.d, cur.p, cur.d);
    if (hit) {
      out.push(hit);
    } else {
      // Collinear neighbours: project the original vertex onto the current offset line.
      const orig = poly[i]!;
      const t = (orig.x - cur.p.x) * cur.d.x + (orig.y - cur.p.y) * cur.d.y;
      out.push({ x: cur.p.x + cur.d.x * t, y: cur.p.y + cur.d.y * t });
    }
  }
  const collapsedEdges: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % n]!;
    const d = lines[i]!.d;
    const along = (b.x - a.x) * d.x + (b.y - a.y) * d.y;
    if (along <= 1e-9) collapsedEdges.push(i);
  }
  return { polygon: out, collapsedEdges };
}

/** Uniform offset. Positive = shrink (towards the interior), negative = grow. */
export function offsetPolygon(poly: readonly Vec2[], inward: number): OffsetResult {
  return offsetPolygonEdges(poly, poly.map(() => inward));
}

/** Interior angle (radians, 0..2π) at vertex `i` of a polygon, independent of winding. */
export function interiorAngle(poly: readonly Vec2[], i: number): number {
  const n = poly.length;
  const prev = poly[(i + n - 1) % n]!;
  const cur = poly[i]!;
  const next = poly[(i + 1) % n]!;
  const a = sub2(prev, cur);
  const b = sub2(next, cur);
  let ang = Math.atan2(cross2(b, a), a.x * b.x + a.y * b.y);
  if (signedArea(poly) < 0) ang = -ang;
  if (ang < 0) ang += 2 * Math.PI;
  return ang;
}

/** True when segments ab and cd properly intersect (shared endpoints do not count). */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const d1 = cross2(sub2(b, a), sub2(c, a));
  const d2 = cross2(sub2(b, a), sub2(d, a));
  const d3 = cross2(sub2(d, c), sub2(a, c));
  const d4 = cross2(sub2(d, c), sub2(b, c));
  return (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  );
}

/** Conservative overlap test between two simple polygons (edge crossings or containment). */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[], tol = 1e-6): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsIntersect(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!, tol)
      ) {
        return true;
      }
    }
  }
  const centroid = (p: readonly Vec2[]): Vec2 => {
    let x = 0;
    let y = 0;
    for (const q of p) {
      x += q.x;
      y += q.y;
    }
    return { x: x / p.length, y: y / p.length };
  };
  return pointInPolygon(centroid(a), b) || pointInPolygon(centroid(b), a);
}
