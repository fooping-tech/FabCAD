import { evaluateAs } from "@fabcad/cad-document";
import { appState, toast } from "../app/appState";
import { currentScope, documentStore, editSketchSolved } from "../app/session";
import { TRANSFORM_TITLES, type SketchTransform, transformResult } from "./transformDialog";

/** Values of the transform window, with the parameters of the document. */
export const transformEvaluate = (expression: string, kind: "length" | "angle" | "none"): number =>
  evaluateAs(expression, kind, currentScope());

export function patchTransform(patch: Partial<SketchTransform>): void {
  appState.set((s) => (s.sketchTransform ? { sketchTransform: { ...s.sketchTransform, ...patch } } : {}));
}

/** OK of the transform window: apply it as one step and go back to Select. */
export function commitTransform(): boolean {
  const t = appState.get().sketchTransform;
  if (!t) return false;
  const feature = documentStore.document.features[t.sketchId];
  if (feature?.type !== "sketch") return false;
  const check = transformResult(feature.sketch, t, transformEvaluate);
  if (!check.ok) {
    toast(check.problem, "warning");
    return false;
  }
  const ok = editSketchSolved(t.sketchId, TRANSFORM_TITLES[t.tool], (s) => {
    const r = transformResult(s, t, transformEvaluate);
    if (!r.ok) throw new Error(r.problem);
    return r.sketch;
  });
  if (!ok) return false;
  // The numbers used are where the next command starts.
  const n = (id: string): number | null => {
    try {
      const v = transformEvaluate(t.values[id] ?? "", "none");
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  appState.set((s) => ({
    sketchTransform: null,
    tool: "select",
    selection: [],
    toolOptions: {
      ...s.toolOptions,
      patternCount: n(t.tool === "circular-pattern" ? "count" : "countX") ?? s.toolOptions.patternCount,
      patternCountY: n("countY") ?? s.toolOptions.patternCountY,
      patternSpacing: n("spacingX") ?? s.toolOptions.patternSpacing,
      scaleFactor: n("factor") ?? s.toolOptions.scaleFactor,
      mirrorSymmetry: t.symmetry,
    },
  }));
  return true;
}

export function cancelTransform(): void {
  appState.set({ sketchTransform: null, tool: "select" });
}
