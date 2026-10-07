import { SKETCH_MODIFY_TOOLS } from "@fabcad/sketch";
import type { Dialog } from "./appState";
import { appState } from "./appState";
import {
  DIALOG_COMMANDS,
  beginSketchPlanePick,
  finishSketch,
  importStep,
  openExportModel,
  openDialog,
  setTool,
  setWorkspace,
  startMeasure,
} from "./actions";
import type { PaletteEntry } from "./commandSearch";
import { copyHistoryLog } from "./copyHistoryLog";
import { redo, saveProject, undo } from "./session";
import { applyConstraintToSelection, toggleSelectedConstruction } from "./sketchCommands";
import { CONSTRAINT_TOOLS } from "../sketch/constraintTools";
import { CREATE_TOOLS } from "../sketch/createTools";
import { exportSketchDxf, exportSketchSvg } from "../sketch/exportSketch";
import { viewportApi } from "../viewport/api";
import type { ViewName } from "../viewport/scene";

export interface PaletteCommand extends PaletteEntry {
  /** One line under the name. */
  detail?: string;
  run(): void;
}

export interface PaletteHooks {
  exportFabrication(format: "svg" | "dxf"): void;
  exportPrint(format: "stl" | "3mf"): void;
}

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "iso", label: "Iso" },
];

/** Shortcuts of the sketch tools (`shortcuts.ts`), shown next to their names. */
const SKETCH_SHORTCUTS: Record<string, string> = {
  line: "L",
  "rectangle-2point": "R",
  circle: "C",
  "arc-3point": "A",
  trim: "T",
  offset: "O",
  move: "M",
  "spline-fit": "S",
  fillet: "F",
};

/**
 * The commands that can be run in the current state, for the command palette (Ctrl / Cmd + K).
 * They come from the same registries as the ribbon and run the same actions.
 */
export function paletteCommands(hooks: PaletteHooks): PaletteCommand[] {
  const state = appState.get();
  const out: PaletteCommand[] = [];
  const add = (c: PaletteCommand): void => {
    out.push(c);
  };

  if (state.workspace === "fabrication") {
    add({ id: "ws.design", label: "Switch to DESIGN", group: "Workspace", run: () => setWorkspace("design") });
    add({ id: "export.svg", label: "Export SVG — laser cutting", group: "Export", keywords: "download file", run: () => hooks.exportFabrication("svg") });
    add({ id: "export.dxf", label: "Export DXF — laser cutting", group: "Export", keywords: "download file", run: () => hooks.exportFabrication("dxf") });
    add({ id: "export.3mf", label: "Export 3MF — 3D print", group: "Export", keywords: "download file print", run: () => hooks.exportPrint("3mf") });
    add({ id: "export.stl-print", label: "Export STL — 3D print", group: "Export", keywords: "download file print", run: () => hooks.exportPrint("stl") });
  } else if (state.activeSketchId) {
    add({ id: "sketch.finish", label: "Finish Sketch", group: "Sketch", run: finishSketch });
    for (const t of CREATE_TOOLS) {
      add({ id: `create.${t.id}`, label: t.label, group: "Sketch: create", detail: t.description, shortcut: SKETCH_SHORTCUTS[t.id], keywords: "draw", run: () => setTool(t.id) });
    }
    add({ id: "create.text", label: "Text", group: "Sketch: create", detail: "Click where the text starts, then write it", run: () => setTool("text") });
    add({ id: "sketch.project", label: "Project", group: "Sketch", detail: "Bring edges, faces or vertices of a body into the sketch", shortcut: "P", run: () => setTool("project") });
    add({ id: "sketch.dimension", label: "Sketch Dimension", group: "Sketch", detail: "Give a length, radius or angle a value", shortcut: "D", keywords: "size", run: () => setTool("dimension") });
    for (const t of SKETCH_MODIFY_TOOLS) {
      const run = t.id === "toggle-construction" ? toggleSelectedConstruction : () => setTool(t.id);
      add({ id: `modify.${t.id}`, label: t.label, group: "Sketch: modify", detail: t.description, shortcut: SKETCH_SHORTCUTS[t.id], run });
    }
    for (const c of CONSTRAINT_TOOLS) {
      add({ id: `constraint.${c.type}`, label: c.label, group: "Constraint", detail: c.hint, keywords: "constrain", run: () => applyConstraintToSelection(c.type) });
    }
  } else {
    add({ id: "sketch.create", label: "Create Sketch", group: "Sketch", detail: "Pick a plane or a planar face", run: () => beginSketchPlanePick(null) });
    for (const [type, def] of Object.entries(DIALOG_COMMANDS) as [Dialog["type"], { label: string }][]) {
      if (type === "pick-sketch-plane") continue;
      add({ id: `solid.${type}`, label: def.label, group: "Solid", keywords: "feature", run: () => openDialog(type) });
    }
    add({ id: "solid.import-step", label: "Import STEP…", group: "File", keywords: "open file", run: () => void importStep() });
    for (const t of CREATE_TOOLS) {
      add({ id: `create.${t.id}`, label: `${t.label} (new sketch)`, group: "Sketch: create", detail: t.description, keywords: "draw", run: () => beginSketchPlanePick(t.id) });
    }
    add({ id: "ws.fabrication", label: "Switch to FABRICATION", group: "Workspace", keywords: "laser print svg", run: () => setWorkspace("fabrication") });
    add({ id: "export.step", label: "Export STEP", group: "Export", keywords: "download file", run: () => openExportModel("step") });
    add({ id: "export.stl", label: "Export STL", group: "Export", keywords: "download file", run: () => openExportModel("stl") });
    add({ id: "export.sketch-svg", label: "Export SVG — selected sketch", group: "Export", keywords: "download file", run: () => exportSketchSvg() });
    add({ id: "export.sketch-dxf", label: "Export DXF — selected sketch", group: "Export", keywords: "download file", run: () => exportSketchDxf() });
  }

  if (state.workspace === "design") {
    add({ id: "measure", label: "Measure", group: "Inspect", shortcut: "I", keywords: "distance angle", run: startMeasure });
    add({ id: "view.fit", label: "Fit", group: "View", shortcut: "F6", keywords: "zoom all", run: () => viewportApi()?.fit() });
    for (const v of VIEWS) {
      add({ id: `view.${v.id}`, label: `View: ${v.label}`, group: "View", run: () => viewportApi()?.setView(v.id) });
    }
  }
  add({ id: "parameters", label: "Parameters…", group: "File", keywords: "variables expressions", run: () => openDialog("parameters") });
  add({ id: "undo", label: "Undo", group: "Edit", shortcut: "Ctrl+Z", run: undo });
  add({ id: "redo", label: "Redo", group: "Edit", shortcut: "Ctrl+Y", run: redo });
  add({ id: "share-link", label: "Share link…", group: "File", detail: "A link that opens this project", keywords: "url copy send", run: () => appState.set({ shareLinkOpen: true }) });
  add({ id: "save", label: "Save project", group: "File", shortcut: "Ctrl+S", keywords: "download", run: saveProject });
  add({ id: "history-log", label: "History Log", group: "Help", detail: "The steps, their status and the bodies", keywords: "bug report timeline errors", run: () => appState.set({ historyLogOpen: true }) });
  add({ id: "copy-log", label: "Copy History Log", group: "Help", keywords: "bug report timeline", run: () => void copyHistoryLog() });
  return out;
}
