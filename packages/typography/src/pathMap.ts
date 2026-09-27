import {
  type Curve2,
  type Vec2,
  curveEnd,
  curveLength,
  curvePointAt,
  curveSegmentCount,
  curveStart,
  curveTangentAt,
  dist2,
  reverseCurve,
} from "@fabcad/geometry";

export interface PathFrame {
  point: Vec2;
  /** Unit tangent in travel direction. */
  tangent: Vec2;
}

interface Piece {
  curve: Curve2;
  /** Arc length at the start of the piece. */
  from: number;
  length: number;
  /** Cumulative length at t = i / (table.length - 1); null when the length is linear in t. */
  table: Float64Array | null;
}

/** Arc-length parameterisation of a chain of curves: length along the path → point and tangent. */
export interface PathMap {
  readonly length: number;
  /** True when the chain ends where it starts (e.g. a full circle); positions then wrap around. */
  readonly closed: boolean;
  /**
   * Frame at arc length `s`. Closed paths wrap; open paths continue straight along the end
   * tangents before the start and after the end.
   */
  frameAt(s: number): PathFrame;
}

const MIN_LENGTH = 1e-9;

function buildPiece(curve: Curve2, from: number): Piece | null {
  if (curve.type === "line" || curve.type === "arc") {
    const length = curveLength(curve);
    return length > MIN_LENGTH ? { curve, from, length, table: null } : null;
  }
  const n = Math.min(4096, Math.max(64, curveSegmentCount(curve, 1e-5) * 2));
  const table = new Float64Array(n + 1);
  let prev = curvePointAt(curve, 0);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const p = curvePointAt(curve, i / n);
    total += dist2(prev, p);
    table[i] = total;
    prev = p;
  }
  return total > MIN_LENGTH ? { curve, from, length: total, table } : null;
}

function paramAt(piece: Piece, s: number): number {
  const local = Math.min(Math.max(s - piece.from, 0), piece.length);
  const table = piece.table;
  if (!table) return local / piece.length;
  const n = table.length - 1;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid]! <= local) lo = mid;
    else hi = mid;
  }
  const a = table[lo]!;
  const b = table[hi]!;
  const f = b > a ? (local - a) / (b - a) : 0;
  return (lo + f) / n;
}

/** Returns null when the chain has no length. */
export function createPathMap(curves: readonly Curve2[], flip = false): PathMap | null {
  const ordered = flip ? curves.map(reverseCurve).reverse() : curves;
  const pieces: Piece[] = [];
  let length = 0;
  for (const curve of ordered) {
    const piece = buildPiece(curve, length);
    if (!piece) continue;
    pieces.push(piece);
    length += piece.length;
  }
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!first || !last) return null;

  const startPoint = curveStart(first.curve);
  const endPoint = curveEnd(last.curve);
  const startTangent = curveTangentAt(first.curve, 0);
  const endTangent = curveTangentAt(last.curve, 1);
  const closed = dist2(startPoint, endPoint) <= 1e-6;

  const frameAt = (s: number): PathFrame => {
    let at = s;
    if (closed) {
      at %= length;
      if (at < 0) at += length;
    } else if (at < 0) {
      return {
        point: { x: startPoint.x + startTangent.x * at, y: startPoint.y + startTangent.y * at },
        tangent: startTangent,
      };
    } else if (at > length) {
      const d = at - length;
      return {
        point: { x: endPoint.x + endTangent.x * d, y: endPoint.y + endTangent.y * d },
        tangent: endTangent,
      };
    }
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const piece = pieces[mid]!;
      if (at > piece.from + piece.length) lo = mid + 1;
      else hi = mid;
    }
    const piece = pieces[lo]!;
    const t = paramAt(piece, at);
    return { point: curvePointAt(piece.curve, t), tangent: curveTangentAt(piece.curve, t) };
  };

  return { length, closed, frameAt };
}
