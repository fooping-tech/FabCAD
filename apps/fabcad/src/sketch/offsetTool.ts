import { type SketchOffset, appState, toast } from "../app/appState";
import { documentStore, editSketchSolved } from "../app/session";
import { offsetSketch } from "./offsetGeometry";

/**
 * Sketch Offset: a click on a curve previews its offset; the distance and the side are then
 * changed in the tool window or by dragging the previewed curve, and OK (Enter) commits it.
 * The pending offset is `appState.sketchOffset`; its geometry is in `offsetGeometry.ts`.
 */

export function patchOffset(patch: Partial<Pick<SketchOffset, "distance" | "side">>): void {
  appState.set((s) => (s.sketchOffset ? { sketchOffset: { ...s.sketchOffset, ...patch } } : {}));
}

/** Add the pending offset to the sketch. Returns false when there is none or it failed. */
export function commitOffset(): boolean {
  const offset = appState.get().sketchOffset;
  if (!offset) return false;
  const feature = documentStore.document.features[offset.sketchId];
  if (feature?.type !== "sketch" || !offsetSketch(feature.sketch, offset)) {
    toast("This chain cannot be offset by that distance.", "warning");
    return false;
  }
  const ok = editSketchSolved(offset.sketchId, "Offset", (s) => {
    const result = offsetSketch(s, offset);
    if (!result) throw new Error("This chain cannot be offset by that distance.");
    return result;
  });
  appState.set((s) => ({
    sketchOffset: null,
    toolPanel: null,
    // The next offset starts from the distance that was used.
    toolOptions: { ...s.toolOptions, offsetDistance: offset.distance },
  }));
  return ok;
}

export function cancelOffset(): boolean {
  if (!appState.get().sketchOffset) return false;
  appState.set({ sketchOffset: null, toolPanel: null });
  return true;
}
