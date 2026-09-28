import { entityToCurves, isCurve, sketchTexts, textLoops } from "@fabcad/sketch";
import { renderCurvesDxf } from "@fabcad/dxf";
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
        : s.kind === "entity" ||
            s.kind === "profile" ||
            s.kind === "dimension" ||
            s.kind === "constraint" ||
            s.kind === "text"
          ? s.sketchId
          : null;
    if (id && doc.features[id]?.type === "sketch") return id;
  }
  return null;
}

/** Curves of a sketch, entity by entity. Construction geometry is left out. */
function sketchCurves(sketchId: string): CurveSvgInput[] {
  const f = documentStore.document.features[sketchId];
  if (!f || f.type !== "sketch") return [];
  const inputs: CurveSvgInput[] = [];
  for (const e of Object.values(f.sketch.entities)) {
    if (!isCurve(e) || e.construction) continue;
    try {
      inputs.push({ id: e.id, curves: entityToCurves(f.sketch, e) });
    } catch {
      // Geometry that cannot be evaluated is skipped.
    }
  }
  // Texts are exported as their outlines, one closed path per loop.
  for (const text of sketchTexts(f.sketch)) {
    if (text.construction) continue;
    for (const [i, curves] of textLoops(f.sketch, text).entries()) {
      inputs.push({ id: `${text.id}-${i}`, curves });
    }
  }
  return inputs;
}

/** SVG of the geometry of a sketch, in millimetres. */
export function sketchSvg(sketchId: string): string | null {
  const inputs = sketchCurves(sketchId);
  return inputs.length > 0 ? renderCurvesSvg(inputs) : null;
}

/** DXF of the geometry of a sketch, in millimetres and in sketch coordinates. */
export function sketchDxf(sketchId: string): string | null {
  const inputs = sketchCurves(sketchId);
  return inputs.length > 0 ? renderCurvesDxf(inputs) : null;
}

export function exportSketchDxf(sketchId: string | null = sketchForExport()): void {
  if (!sketchId) {
    toast("Select a sketch first, or open one.", "warning");
    return;
  }
  const f = documentStore.document.features[sketchId];
  const dxf = sketchDxf(sketchId);
  if (!f || !dxf) {
    toast("This sketch has no geometry to export.", "warning");
    return;
  }
  const name = `${safeFileName(documentStore.document.name)}-${safeFileName(f.name)}.dxf`;
  downloadBlob(dxf, name, "image/vnd.dxf");
  toast(`Exported ${name}.`);
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
