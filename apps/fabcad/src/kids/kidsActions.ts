import { type CreatedRef, listBodies, updateFeature } from "@fabcad/cad-document";
import {
  beginSketchPlanePick,
  closeDialog,
  commitDialog,
  deleteSelection,
  finishSketch,
  openDialog,
  patchDialog,
  setTool,
  setWorkspace,
  startSketchOnOrigin,
} from "../app/actions";
import { type Dialog, appState } from "../app/appState";
import { activeComponentId } from "../app/components";
import {
  documentStore,
  editSketchSolved,
  modelState,
  openProjectFile,
  pickFile,
  run,
  saveProject,
  solver,
} from "../app/session";
import { viewportApi } from "../viewport/api";
import { type KidsNotice, type UiMode, browserStorage, saveUiMode } from "./kidsModel";
import { type KidsShape, kidsShapeCommand, nextShapeSpot } from "./presets";
import type { SizeField } from "./sizeFields";

/** Dialogs that have a Kids Mode window; any other one is closed when Kids Mode starts. */
const KIDS_DIALOGS: ReadonlySet<Dialog["type"]> = new Set(["extrude", "move", "sphere"]);

/**
 * Switch between the normal screen and Kids Mode. Only the screen changes: the document, its
 * undo history and the selection stay as they are.
 */
export function setUiMode(mode: UiMode): void {
  const s = appState.get();
  if (s.uiMode === mode) return;
  saveUiMode(browserStorage(), mode);
  if (mode === "kids") {
    if (s.dialog && !KIDS_DIALOGS.has(s.dialog.type)) closeDialog();
    appState.set({
      uiMode: mode,
      kidsPanel: null,
      kidsNotice: null,
      commandPalette: null,
      historyLogOpen: false,
      shareLinkOpen: false,
      exportModel: null,
      contextMenu: null,
      measuring: false,
      fabricationProcess: "laser",
    });
  } else {
    appState.set({ uiMode: mode, kidsPanel: null, kidsNotice: null });
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Show what just happened in the guide line for a few seconds. */
export function notify(notice: KidsNotice): void {
  appState.set({ kidsNotice: notice });
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => appState.set({ kidsNotice: null }), 3500);
}

export function openPanel(panel: "shapes" | "size" | null): void {
  appState.set({ kidsPanel: panel });
}

/** Make a box, a cylinder or a ball next to what is there, and select it. */
export function makeShape(shape: KidsShape): void {
  const doc = documentStore.document;
  const componentId = activeComponentId(doc);
  const bodies = modelState.get().bodies;
  let maxX: number | null = null;
  for (const b of listBodies(doc, componentId)) {
    const x = bodies[b.id]?.geometry.bounds.max.x;
    if (x !== undefined && b.visible) maxX = maxX === null ? x : Math.max(maxX, x);
  }
  const out: CreatedRef = {};
  const ok = run(kidsShapeCommand(shape, solver, { at: nextShapeSpot(maxX), componentId }, out));
  appState.set({ kidsPanel: null });
  if (!ok || !out.bodyId) return;
  appState.set({ selection: [{ kind: "body", bodyId: out.bodyId }] });
  notify("made");
}

/** おえかき: on the flat face that is selected, or on the ground (the XY plane). */
export function startDrawing(): void {
  const first = appState.get().selection[0];
  if (first?.kind === "face" && first.planar) beginSketchPlanePick("line");
  else {
    startSketchOnOrigin("XY");
    setTool("line");
  }
}

/**
 * たかくする: Extrude. A drawing on the ground becomes a shape of its own; a drawing on a face
 * of a shape is added to that shape only (the normal default would join every visible body).
 */
export function startExtrude(): void {
  openDialog("extrude");
  const d = appState.get().dialog;
  if (d?.type !== "extrude" || d.editing) return;
  const sketch = d.sketchId ? documentStore.document.features[d.sketchId] : undefined;
  const plane = sketch?.type === "sketch" ? sketch.sketch.plane : null;
  if (plane?.type === "face" && documentStore.document.bodies[plane.bodyId]) {
    patchDialog({ operation: "join", targetBodyIds: [plane.bodyId] });
  } else {
    patchDialog({ operation: "new", targetBodyIds: [] });
  }
}

/** うごかす / まわす: the free mode of Move, which turns about the middle of the bodies. */
export function startMove(panel: "move" | "rotate"): void {
  openDialog("move");
  const d = appState.get().dialog;
  if (d?.type !== "move") return;
  patchDialog({ mode: "free" });
  appState.set({ kidsPanel: panel });
}

export function finishCommand(): void {
  const type = appState.get().dialog?.type;
  if (commitDialog()) {
    appState.set({ kidsPanel: null });
    if (type === "extrude" || type === "sphere") notify("made");
  }
}

export function cancelCommand(): void {
  closeDialog();
  appState.set({ kidsPanel: null });
}

export function removeSelection(): void {
  const before = documentStore.document;
  deleteSelection();
  if (documentStore.document !== before) notify("deleted");
}

export function finishDrawing(): void {
  finishSketch();
}

/** てんかいず: the preview of the laser workspace, with its settings hidden. */
export function showUnfold(): void {
  appState.set({ kidsPanel: null, fabricationProcess: "laser", fabricationTab: "parts" });
  setWorkspace("fabrication");
}

export function leaveUnfold(): void {
  setWorkspace("design");
}

export function kidsSave(): void {
  saveProject();
  notify("saved");
}

/** ひらく: the same as File → Open, with the question in words a child can read. */
export async function kidsOpen(): Promise<void> {
  if (documentStore.dirty && documentStore.document.timeline.length > 0) {
    if (!window.confirm("ほぞん していない ところが きえるよ。ひらいて いい？")) return;
  }
  const file = await pickFile(".json,.fabcad.json,application/json");
  if (file) await openProjectFile(file);
}

/** The house button: a view from the front corner that shows everything. */
export function homeView(): void {
  const api = viewportApi();
  api?.setView("iso");
  api?.fit();
}

/** Change one size of a body (see `sizeFields`). One press is one undo step. */
export function setSize(field: SizeField, expression: string): boolean {
  if (expression === field.expression) return false;
  if (field.kind === "feature") {
    return run(updateFeature(field.featureId, { [field.key]: expression }, "Change size"));
  }
  return editSketchSolved(
    field.sketchId,
    "Change size",
    (s) => {
      const d = s.dimensions[field.dimensionId];
      if (!d) return s;
      return { ...s, dimensions: { ...s.dimensions, [field.dimensionId]: { ...d, expression } } };
    },
    { rejectOverConstrained: true },
  );
}
