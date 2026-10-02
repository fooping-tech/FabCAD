import type { Vec2 } from "@fabcad/geometry";
import { type EntityId, type Sketch, hitTestSketch, offsetEntities } from "@fabcad/sketch";
import type { SketchOffset } from "../app/appState";

/** Geometry of the Sketch Offset command (`offsetTool.ts`). Pure functions. */

/** The sketch with the offset added, or null when the chain cannot be offset that far. */
export function offsetSketch(sketch: Sketch, offset: Pick<SketchOffset, "chain" | "distance" | "side">): Sketch | null {
  if (!(offset.distance > 0)) return null;
  try {
    const r = offsetEntities(sketch, offset.chain, offset.side * offset.distance);
    return r.created.length > 0 ? r.sketch : null;
  } catch {
    return null;
  }
}

/** Distance from `p` to the curves `ids` of `sketch` (and only to those). */
function distanceToCurves(sketch: Sketch, ids: Iterable<EntityId>, p: Vec2): number {
  const keep = new Set(ids);
  const only: Sketch = {
    ...sketch,
    entities: Object.fromEntries(
      Object.entries(sketch.entities).filter(([id, e]) => e.type === "point" || keep.has(id)),
    ),
  };
  return hitTestSketch(only, p, Infinity, { points: false })?.distance ?? Infinity;
}

/** The new curves of an offset result. */
function createdCurves(before: Sketch, after: Sketch): EntityId[] {
  return Object.keys(after.entities).filter(
    (id) => !before.entities[id] && after.entities[id]!.type !== "point",
  );
}

/** The side whose offset by `distance` passes closest to `at`; null when neither works. */
export function offsetSideAt(sketch: Sketch, chain: EntityId[], distance: number, at: Vec2): 1 | -1 | null {
  let best: { side: 1 | -1; d: number } | null = null;
  for (const side of [1, -1] as const) {
    const result = offsetSketch(sketch, { chain, distance, side });
    if (!result) continue;
    const d = distanceToCurves(result, createdCurves(sketch, result), at);
    if (!best || d < best.d) best = { side, d };
  }
  return best?.side ?? null;
}

/**
 * Distance and side of an offset that passes through `at` (dragging the previewed curve),
 * rounded to `step`. Null when no offset can go there.
 */
export function offsetThrough(
  sketch: Sketch,
  chain: EntityId[],
  at: Vec2,
  step: number,
): { distance: number; side: 1 | -1 } | null {
  const raw = distanceToCurves(sketch, chain, at);
  if (!Number.isFinite(raw)) return null;
  const distance = Math.max(step, Math.round(raw / step) * step);
  const rounded = Math.round(distance * 1e6) / 1e6;
  const side = offsetSideAt(sketch, chain, rounded, at);
  return side === null ? null : { distance: rounded, side };
}

/** Whether `at` is on one of the previewed offset curves, within `tolerance`. */
export function onOffsetPreview(sketch: Sketch, offset: SketchOffset, at: Vec2, tolerance: number): boolean {
  const result = offsetSketch(sketch, offset);
  if (!result) return false;
  return distanceToCurves(result, createdCurves(sketch, result), at) <= tolerance;
}

