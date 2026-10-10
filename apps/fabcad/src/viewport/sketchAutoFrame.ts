import type { Sketch } from "@fabcad/sketch";

/**
 * Decide whether a document edit is eligible to auto-frame an active sketch.
 *
 * Geometry and node-mode edits must never unexpectedly pan/zoom the user's view:
 * when zoomed into a glyph, the full sketch bounds are deliberately off-screen.
 * Only changes to driving dimensions or parameters can cause the old feature
 * geometry to jump to a fundamentally different extent.
 */
export function shouldAutoFrameSketchEdit(
  before: Sketch | undefined,
  after: Sketch,
  parametersChanged: boolean,
): boolean {
  if (!before) return false;
  if (parametersChanged) return true;

  const oldDimensions = before.dimensions;
  const newDimensions = after.dimensions;
  const oldIds = Object.keys(oldDimensions);
  if (oldIds.length !== Object.keys(newDimensions).length) return true;

  for (const id of oldIds) {
    const oldDimension = oldDimensions[id]!;
    const newDimension = newDimensions[id];
    if (!newDimension) return true;
    if (
      oldDimension.type !== newDimension.type ||
      oldDimension.expression !== newDimension.expression ||
      oldDimension.driving !== newDimension.driving ||
      oldDimension.refs.length !== newDimension.refs.length ||
      oldDimension.refs.some((ref, index) => ref !== newDimension.refs[index])
    ) return true;
  }
  return false;
}
