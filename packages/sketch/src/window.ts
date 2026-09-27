import type { Bounds2, Vec2 } from "@fabcad/geometry";

/**
 * Window selection. Works on polylines in the space the window was dragged in (the screen),
 * so that what is selected is exactly what the rectangle shows, whatever the view.
 *
 * - "window" (dragged left → right): only what lies completely inside.
 * - "crossing" (dragged right → left): everything the rectangle touches.
 */
export type WindowMode = "window" | "crossing";

export interface WindowItem<T> {
  id: T;
  /** One point for a point, a polyline that follows the curve otherwise. */
  points: Vec2[];
}

export const windowMode = (start: Vec2, end: Vec2): WindowMode =>
  end.x >= start.x ? "window" : "crossing";

export const windowBounds = (a: Vec2, b: Vec2): Bounds2 => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

const inside = (p: Vec2, r: Bounds2): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Liang–Barsky: does the segment a–b touch the rectangle? */
function segmentTouches(a: Vec2, b: Vec2, r: Bounds2): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.minX) &&
    clip(dx, r.maxX - a.x) &&
    clip(-dy, a.y - r.minY) &&
    clip(dy, r.maxY - a.y)
  );
}

export function windowSelect<T>(items: readonly WindowItem<T>[], rect: Bounds2, mode: WindowMode): T[] {
  const out: T[] = [];
  for (const item of items) {
    const pts = item.points;
    if (pts.length === 0) continue;
    if (mode === "window") {
      if (pts.every((p) => inside(p, rect))) out.push(item.id);
      continue;
    }
    let hit = pts.length === 1 && inside(pts[0]!, rect);
    for (let i = 0; !hit && i + 1 < pts.length; i++) hit = segmentTouches(pts[i]!, pts[i + 1]!, rect);
    if (hit) out.push(item.id);
  }
  return out;
}
