import { type Bounds2, type Vec2, boundsOfPoints, dist2 } from "@fabcad/geometry";
import type { FlatPath } from "@fabcad/fabrication-core";

/** Bounds of the final manufacturing paths (falls back to `fallback` when there are none). */
export function boundsOfPaths(paths: readonly FlatPath[], fallback: readonly Vec2[]): Bounds2 {
  const pts: Vec2[] = [];
  for (const path of paths) for (const p of path.points) pts.push(p);
  if (pts.length === 0) for (const p of fallback) pts.push(p);
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return boundsOfPoints(pts);
}

/** Append a point unless it repeats the previous one. */
export function pushPoint(out: Vec2[], p: Vec2, tol = 1e-9): void {
  const last = out[out.length - 1];
  if (last && dist2(last, p) <= tol) return;
  out.push(p);
}

/** Drop a closing point that repeats the first point of a closed loop. */
export function closeLoop(points: Vec2[], tol = 1e-9): Vec2[] {
  while (points.length > 1 && dist2(points[0]!, points[points.length - 1]!) <= tol) points.pop();
  return points;
}

/** Make names unique by appending `-2`, `-3`, … in order of appearance. */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    return n === 1 ? name : `${name}-${n}`;
  });
}
