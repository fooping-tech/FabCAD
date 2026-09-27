import { entityToCurves, isCurve } from "@fabcad/sketch";
import { type CurveSvgInput, renderCurvesSvg } from "@fabcad/svg";
import { appState, toast } from "../app/appState";
import { documentStore, downloadBlob, safeFileName } from "../app/session";

/** The sketch that an export refers to: the one being edited, or the selected one. */
export function sketchForExport(): string | null {
  const state = appState.get();
  if (state.activeSketchId) return state.activeSketchId;
  const doc = documentStore.document;
  for (const s of state.selection) {
    const id =
      s.kind === "feature"
        ? s.featureId
        : s.kind === "entity" || s.kind === "profile" || s.kind === "dimension" || s.kind === "constraint"
          ? s.sketchId
          : null;
    if (id && doc.features[id]?.type === "sketch") return id;
  }
  return null;
}

/** SVG of the geometry of a sketch, in millimetres. Construction geometry is left out. */
export function sketchSvg(sketchId: string): string | null {
  const f = documentStore.document.features[sketchId];
  if (!f || f.type !== "sketch") return null;
  const inputs: CurveSvgInput[] = [];
  for (const e of Object.values(f.sketch.entities)) {
    if (!isCurve(e) || e.construction) continue;
    try {
      inputs.push({ id: e.id, curves: entityToCurves(f.sketch, e) });
    } catch {
      // Geometry that cannot be evaluated is skipped.
    }
  }
  return inputs.length > 0 ? renderCurvesSvg(inputs) : null;
}

export function exportSketchSvg(sketchId: string | null = sketchForExport()): void {
  if (!sketchId) {
    toast("Select a sketch first, or open one.", "warning");
    return;
  }
  const f = documentStore.document.features[sketchId];
  const svg = sketchSvg(sketchId);
  if (!f || !svg) {
    toast("This sketch has no geometry to export.", "warning");
    return;
  }
  const name = `${safeFileName(documentStore.document.name)}-${safeFileName(f.name)}.svg`;
  downloadBlob(svg, name, "image/svg+xml");
  toast(`Exported ${name}.`);
}
