import {
  type Vec3,
  add3,
  cross3,
  dist3,
  dot3,
  len3,
  norm3,
  radToDeg,
  scale3,
  sub3,
} from "./vec";

/**
 * Measuring: what is picked is reduced to a geometric primitive in world space, and the
 * values are computed from the primitives alone. Nothing here knows about sketches, bodies
 * or the document, so the same code measures sketch geometry and B-Rep topology.
 */

export type MeasureItem =
  | { kind: "point"; at: Vec3 }
  | { kind: "segment"; from: Vec3; to: Vec3 }
  /** Circle or circular arc. `length` is the arc length. */
  | { kind: "circle"; center: Vec3; radius: number; length: number; closed: boolean; points: Vec3[] }
  /** Any other curve, as a polyline that follows it. */
  | { kind: "curve"; points: Vec3[]; length: number; closed: boolean }
  /** Planar face or region. `points` are points on its outline. */
  | { kind: "plane"; point: Vec3; normal: Vec3; area?: number; perimeter?: number; points: Vec3[] }
  /** Curved face. */
  | { kind: "surface"; area: number; perimeter?: number; points: Vec3[] }
  | { kind: "solid"; volume: number; area: number; min: Vec3; max: Vec3 };

export type MeasureUnit = "mm" | "mm²" | "mm³" | "°";

export interface MeasureValue {
  id: string;
  label: string;
  value: number;
  unit: MeasureUnit;
}

const PARALLEL = 1e-9;

const value = (id: string, label: string, v: number, unit: MeasureUnit): MeasureValue => ({
  id,
  label,
  value: Math.abs(v) < 1e-9 ? 0 : v,
  unit,
});

/** Values of one picked item. */
export function measureItem(item: MeasureItem): MeasureValue[] {
  switch (item.kind) {
    case "point":
      return [
        value("x", "X", item.at.x, "mm"),
        value("y", "Y", item.at.y, "mm"),
        value("z", "Z", item.at.z, "mm"),
      ];
    case "segment":
      return [value("length", "Length", dist3(item.from, item.to), "mm")];
    case "circle":
      return [
        value("radius", "Radius", item.radius, "mm"),
        value("diameter", "Diameter", item.radius * 2, "mm"),
        value("length", item.closed ? "Circumference" : "Arc length", item.length, "mm"),
        ...(item.closed
          ? [value("area", "Area", Math.PI * item.radius * item.radius, "mm²")]
          : [value("angle", "Arc angle", radToDeg(item.length / item.radius), "°")]),
      ];
    case "curve":
      return [value("length", "Length", item.length, "mm")];
    case "plane":
    case "surface":
      return [
        ...(item.area !== undefined ? [value("area", "Area", item.area, "mm²")] : []),
        ...(item.perimeter !== undefined ? [value("perimeter", "Perimeter", item.perimeter, "mm")] : []),
      ];
    case "solid":
      return [
        value("volume", "Volume", item.volume, "mm³"),
        value("area", "Surface area", item.area, "mm²"),
        value("size-x", "Size X", item.max.x - item.min.x, "mm"),
        value("size-y", "Size Y", item.max.y - item.min.y, "mm"),
        value("size-z", "Size Z", item.max.z - item.min.z, "mm"),
      ];
  }
}

// ------------------------------------------------------------------ distances

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const d = sub3(b, a);
  const l2 = dot3(d, d);
  if (l2 < 1e-18) return a;
  const t = Math.min(1, Math.max(0, dot3(sub3(p, a), d) / l2));
  return add3(a, scale3(d, t));
}

/** Closest points of two segments (Ericson, Real-Time Collision Detection). */
function closestSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): [Vec3, Vec3] {
  const d1 = sub3(q1, p1);
  const d2 = sub3(q2, p2);
  const r = sub3(p1, p2);
  const a = dot3(d1, d1);
  const e = dot3(d2, d2);
  const f = dot3(d2, r);
  let s = 0;
  let t = 0;
  if (a < 1e-18 && e < 1e-18) return [p1, p2];
  if (a < 1e-18) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot3(d1, r);
    if (e < 1e-18) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot3(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-18 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return [add3(p1, scale3(d1, s)), add3(p2, scale3(d2, t))];
}

/** Line segments that stand for an item when nothing more exact is known. */
function segmentsOf(item: MeasureItem): [Vec3, Vec3][] {
  switch (item.kind) {
    case "point":
      return [[item.at, item.at]];
    case "segment":
      return [[item.from, item.to]];
    case "solid": {
      const { min, max } = item;
      return [[min, max]];
    }
    default: {
      const out: [Vec3, Vec3][] = [];
      const pts = item.points;
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
      if (pts.length === 1) out.push([pts[0]!, pts[0]!]);
      return out;
    }
  }
}

function minimumDistance(a: MeasureItem, b: MeasureItem): { distance: number; from: Vec3; to: Vec3 } | null {
  let best: { distance: number; from: Vec3; to: Vec3 } | null = null;
  for (const [a0, a1] of segmentsOf(a)) {
    for (const [b0, b1] of segmentsOf(b)) {
      const [from, to] = closestSegments(a0, a1, b0, b1);
      const distance = dist3(from, to);
      if (!best || distance < best.distance) best = { distance, from, to };
    }
  }
  return best;
}

const directionOf = (item: MeasureItem): Vec3 | null =>
  item.kind === "segment" && dist3(item.from, item.to) > 1e-12
    ? norm3(sub3(item.to, item.from))
    : null;

const anchorOf = (item: MeasureItem): Vec3 | null => {
  switch (item.kind) {
    case "point":
      return item.at;
    case "segment":
      return item.from;
    case "circle":
      return item.center;
    case "plane":
      return item.point;
    default:
      return null;
  }
};

export interface MeasureResult {
  values: MeasureValue[];
  /** The two points the distance was measured between, for drawing. */
  line: { from: Vec3; to: Vec3 } | null;
}

/**
 * Values between two picked items: the distance (perpendicular for parallel lines and planes,
 * the shortest distance otherwise), the angle for lines and planes, and the components of the
 * distance for points.
 */
export function measureBetween(a: MeasureItem, b: MeasureItem): MeasureResult {
  const values: MeasureValue[] = [];
  let line: MeasureResult["line"] = null;
  if (a.kind === "solid" || b.kind === "solid") {
    return { values, line };
  }

  const da = directionOf(a);
  const db = directionOf(b);
  const na = a.kind === "plane" ? norm3(a.normal) : null;
  const nb = b.kind === "plane" ? norm3(b.normal) : null;

  let angle: number | null = null;
  let parallel = false;
  if (da && db) {
    // Lines have no direction: the angle between them is at most 90°.
    const c = Math.min(1, Math.abs(dot3(da, db)));
    angle = radToDeg(Math.acos(c));
    parallel = len3(cross3(da, db)) < PARALLEL;
  } else if (na && nb) {
    const c = Math.max(-1, Math.min(1, dot3(na, nb)));
    // Angle between the planes themselves, not between their outward normals.
    angle = radToDeg(Math.acos(Math.min(1, Math.abs(c))));
    parallel = len3(cross3(na, nb)) < PARALLEL;
  } else if ((da && nb) || (db && na)) {
    const d = (da ?? db)!;
    const n = (nb ?? na)!;
    const s = Math.min(1, Math.abs(dot3(d, n)));
    angle = radToDeg(Math.asin(s));
    parallel = s < PARALLEL;
  }

  // Perpendicular distances where they are defined.
  let exact: { distance: number; from: Vec3; to: Vec3 } | null = null;
  const plane = a.kind === "plane" ? a : b.kind === "plane" ? b : null;
  const other = plane === a ? b : a;
  if (plane && (other.kind === "point" || parallel)) {
    const n = norm3(plane.normal);
    const p = anchorOf(other);
    if (p) {
      const h = dot3(sub3(p, plane.point), n);
      exact = { distance: Math.abs(h), from: p, to: sub3(p, scale3(n, h)) };
    }
  } else if (da && db && parallel && a.kind === "segment" && b.kind === "segment") {
    const v = sub3(b.from, a.from);
    const along = dot3(v, da);
    const foot = add3(a.from, scale3(da, along));
    exact = { distance: dist3(foot, b.from), from: foot, to: b.from };
  }

  const found = exact ?? minimumDistance(a, b);
  if (found) {
    values.push(value("distance", "Distance", found.distance, "mm"));
    line = { from: found.from, to: found.to };
  }
  if (angle !== null) values.push(value("angle", "Angle", angle, "°"));

  if (a.kind === "circle" || b.kind === "circle") {
    const ca = a.kind === "circle" ? a.center : anchorOf(a);
    const cb = b.kind === "circle" ? b.center : anchorOf(b);
    if (ca && cb && (a.kind === "circle" ? b.kind !== "segment" && b.kind !== "plane" : true)) {
      if (a.kind === "circle" && b.kind === "circle") {
        values.push(value("center-distance", "Centre distance", dist3(ca, cb), "mm"));
      } else if (a.kind === "point" || b.kind === "point") {
        values.push(value("center-distance", "Distance to centre", dist3(ca, cb), "mm"));
      }
    }
  }

  if (a.kind === "point" && b.kind === "point") {
    values.push(
      value("dx", "Delta X", b.at.x - a.at.x, "mm"),
      value("dy", "Delta Y", b.at.y - a.at.y, "mm"),
      value("dz", "Delta Z", b.at.z - a.at.z, "mm"),
    );
  }
  return { values, line };
}

/** Point of an item closest to `p`; used to show where a distance is measured. */
export function closestPointOn(item: MeasureItem, p: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let distance = Infinity;
  for (const [a, b] of segmentsOf(item)) {
    const q = closestOnSegment(p, a, b);
    const d = dist3(p, q);
    if (d < distance) {
      distance = d;
      best = q;
    }
  }
  return best;
}

/** Text of a value as it is shown and copied. */
export function formatMeasure(v: MeasureValue, decimals = 3): string {
  const text = v.value.toFixed(decimals);
  const trimmed = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  return `${trimmed === "-0" ? "0" : trimmed} ${v.unit}`;
}
