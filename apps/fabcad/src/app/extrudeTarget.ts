import { extrudeReach, resolveSketchPlane } from "@fabcad/features";
import type { Dialog } from "./appState";
import { type HandleContext, referencePatch } from "./dialogHandles";
import { resolvePoint } from "./moveTransform";

type ExtrudeDialog = Extract<Dialog, { type: "extrude" }>;

/**
 * How far the extrusion of the dialog reaches when it goes up to a target: as the feature
 * engine will measure it (`extrudeReach`), or why it cannot. Null while the dialog extrudes by
 * a distance, or the sketch or the target are not picked yet. Pure.
 */
export function extrudeTargetReach(
  dialog: ExtrudeDialog,
  ctx: HandleContext,
): { reach: number } | { error: string } | null {
  if (dialog.extent !== "to" || !dialog.to || !dialog.sketchId) return null;
  const f = ctx.doc.features[dialog.sketchId];
  if (f?.type !== "sketch") return null;
  const target = dialog.to;
  const isPlane = target.type === "origin-plane" || target.type === "face" || target.type === "plane";
  const plane = isPlane ? referencePatch(target, ctx)?.plane : undefined;
  const point = isPlane ? undefined : resolvePoint(target, ctx);
  if (!plane && !point) return { error: "What to extrude to no longer exists." };
  try {
    return { reach: extrudeReach(resolveSketchPlane(f.sketch.plane), plane ? { plane } : { point: point! }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The extent along the sketch normal: up to the target, or by distance and direction. */
export const reachSpan = (reach: number): [number, number] => (reach < 0 ? [reach, 0] : [0, reach]);
