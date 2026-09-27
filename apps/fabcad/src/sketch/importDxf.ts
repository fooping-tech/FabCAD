import {
  type DxfDrawing,
  type DxfImportOptions,
  DxfParseError,
  importDxfIntoSketch,
  parseDxf,
} from "@fabcad/dxf";
import type { OriginPlaneName } from "@fabcad/geometry";
import { startSketch } from "../app/actions";
import { appState, toast } from "../app/appState";
import { editSketchSolved, pickFile } from "../app/session";
import { viewportApi } from "../viewport/api";

/**
 * DXF import. The drawing becomes ordinary sketch geometry (free, without constraints), so
 * everything downstream (profiles, Extrude, fabrication) treats it like a drawn sketch.
 */

export interface DxfImportChoice {
  /** Unit of the file; only asked for when the file does not say. */
  unit: "mm" | "inch";
  layers: string[];
  constructionLayers: string[];
}

/** File → Import DXF: read the file and open the import dialog. */
export async function pickDxf(): Promise<void> {
  const file = await pickFile(".dxf,.DXF");
  if (!file) return;
  try {
    const drawing = parseDxf(await file.text());
    if (drawing.entities.length === 0) {
      const skipped = Object.keys(drawing.skipped);
      toast(
        skipped.length > 0
          ? `${file.name} has no geometry FabCAD can import (only ${skipped.join(", ")}).`
          : `${file.name} has no geometry.`,
        "warning",
        7000,
      );
      return;
    }
    appState.set({ dialog: { type: "import-dxf", fileName: file.name, drawing }, contextMenu: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast(err instanceof DxfParseError ? `${file.name}: ${message}` : message, "error", 7000);
  }
}

/** Plane of the sketch that an import creates when no sketch is open. */
export function importPlane(): OriginPlaneName {
  const picked = appState.get().selection.find((s) => s.kind === "origin-plane");
  return picked?.kind === "origin-plane" ? picked.plane : "XY";
}

/**
 * Import into the open sketch, or into a new sketch on the selected origin plane (XY when
 * none is selected). One undo step either way.
 */
export function importDxf(fileName: string, drawing: DxfDrawing, choice: DxfImportChoice): boolean {
  const options: DxfImportOptions = {
    // The unit was chosen in the dialog, so there is nothing to warn about.
    ...(drawing.units === "unitless" ? { forceUnit: choice.unit } : {}),
    layers: choice.layers,
    constructionLayers: choice.constructionLayers,
  };
  const warnings: string[] = [];
  let count = 0;
  const convert = (sketch: Parameters<typeof importDxfIntoSketch>[0]) => {
    const result = importDxfIntoSketch(sketch, drawing, options);
    count = result.created.length + result.points.length;
    warnings.push(...result.warnings);
    return count > 0 ? result.sketch : sketch;
  };

  const plane = importPlane();
  const active = appState.get().activeSketchId;
  appState.set({ dialog: null });
  if (active) {
    if (!editSketchSolved(active, "Import DXF", convert)) {
      if (count === 0) toast("Nothing was imported from the selected layers.", "warning");
      return false;
    }
  } else {
    startSketch({ type: "origin", plane }, convert);
    if (count === 0) {
      toast("Nothing was imported from the selected layers.", "warning");
      return false;
    }
  }
  toast(`Imported ${count} ${count === 1 ? "entity" : "entities"} from ${fileName}.`);
  for (const w of [...drawing.warnings, ...warnings]) toast(w, "warning", 8000);
  setTimeout(() => viewportApi()?.fit(), 50);
  return true;
}
