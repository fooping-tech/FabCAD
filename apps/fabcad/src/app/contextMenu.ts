import {
  setBodyVisible,
  setFeatureSuppressed,
  setSketchVisible,
} from "@fabcad/cad-document";
import { SKETCH_MODIFY_TOOLS, toggleConstruction } from "@fabcad/sketch";
import { CONSTRAINT_TOOLS } from "../sketch/constraintTools";
import { CREATE_TOOLS, createTool } from "../sketch/createTools";
import { exportSketchSvg } from "../sketch/exportSketch";
import type { MenuItem } from "../ui/Menu";
import { viewportApi } from "../viewport/api";
import {
  beginSketchPlanePick,
  commitDialog,
  deleteSelection,
  dialogProblem,
  editFeature,
  enterSketch,
  finishSketch,
  openDialog,
  repeatLastCommand,
  setTool,
} from "./actions";
import { appState, setSelection } from "./appState";
import { documentStore, editSketchSolved, redo, run, undo } from "./session";
import { pressEnter, pressEscape } from "./shortcuts";

/**
 * Context menu, modelled on the right-click menu of Fusion 360: OK / Cancel for the running
 * command, Repeat, what can be done with the selection, then the common commands.
 */
const DIALOG_LABELS: Record<string, string> = {
  extrude: "Extrude",
  revolve: "Revolve",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  combine: "Combine",
  "pick-sketch-plane": "Create Sketch",
};

function commandLabel(command: { kind: "tool" | "dialog"; id: string; label: string }): string {
  if (command.kind === "dialog") return DIALOG_LABELS[command.id] ?? command.label;
  if (command.id === "dimension") return "Sketch Dimension";
  if (command.id === "project") return "Project";
  return (
    CREATE_TOOLS.find((t) => t.id === command.id)?.label ??
    SKETCH_MODIFY_TOOLS.find((t) => t.id === command.id)?.label ??
    CONSTRAINT_TOOLS.find((t) => `constraint:${t.type}` === command.id)?.label ??
    command.label
  );
}

export function buildContextMenu(): MenuItem[] {
  const state = appState.get();
  const doc = documentStore.document;
  const items: MenuItem[] = [];
  const sep = (): void => {
    const last = items[items.length - 1];
    if (last && !("separator" in last)) items.push({ separator: true });
  };
  const selection = state.selection;
  const every = (kind: string): boolean =>
    selection.length > 0 && selection.every((s) => s.kind === kind);
  const first = selection[0];

  // ------------------------------------------------ a command is running
  const dialog = state.dialog;
  if (dialog && dialog.type !== "parameters" && dialog.type !== "about") {
    if (dialog.type !== "pick-sketch-plane") {
      items.push({
        label: "OK",
        icon: "check",
        kbd: "Enter",
        disabled: dialogProblem(dialog) !== null,
        onSelect: () => void commitDialog(),
      });
    }
    items.push({ label: "Cancel", icon: "close", kbd: "Esc", onSelect: pressEscape });
    return items;
  }

  const repeat = state.lastCommand;
  const undoRedo = (): void => {
    items.push(
      { label: "Undo", icon: "undo", disabled: !documentStore.canUndo, onSelect: undo },
      { label: "Redo", icon: "redo", disabled: !documentStore.canRedo, onSelect: redo },
    );
  };

  // ------------------------------------------------------------ sketching
  if (state.activeSketchId) {
    const sketchId = state.activeSketchId;
    const feature = doc.features[sketchId];
    if (state.tool !== "select") {
      if (createTool(state.tool)?.clicks === "many") {
        items.push({ label: "OK", icon: "check", kbd: "Enter", onSelect: () => void pressEnter() });
      }
      items.push({ label: "Cancel", icon: "close", kbd: "Esc", onSelect: pressEscape });
      sep();
    }
    if (repeat?.kind === "tool") {
      items.push({ label: `Repeat ${commandLabel(repeat)}`, icon: repeat.id, onSelect: repeatLastCommand });
      sep();
    }
    if (selection.length > 0 && feature?.type === "sketch") {
      const entities = selection.flatMap((s) =>
        s.kind === "entity" && s.sketchId === sketchId ? [s.entityId] : [],
      );
      if (first?.kind === "dimension" && selection.length === 1) {
        items.push({
          label: "Edit Dimension",
          icon: "dimension",
          onSelect: () => viewportApi()?.editDimension(first.id),
        });
      }
      if (every("profile")) {
        items.push({ label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") });
        items.push({ label: "Revolve", icon: "revolve", onSelect: () => openDialog("revolve") });
      }
      const curves = entities.filter((id) => {
        const e = feature.sketch.entities[id];
        return e && e.type !== "point";
      });
      if (curves.length > 0) {
        items.push({
          label: "Normal / Construction",
          icon: "toggle-construction",
          kbd: "X",
          onSelect: () =>
            editSketchSolved(sketchId, "Normal / Construction", (s) => toggleConstruction(s, curves)),
        });
        items.push({ label: "Move", icon: "move", kbd: "M", onSelect: () => setTool("move") });
        items.push({ label: "Copy", icon: "copy", onSelect: () => setTool("copy") });
      }
      if (!every("profile")) {
        items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
      }
      sep();
    }
    items.push(
      { label: "Line", icon: "line", kbd: "L", onSelect: () => setTool("line") },
      { label: "2-Point Rectangle", icon: "rectangle-2point", kbd: "R", onSelect: () => setTool("rectangle-2point") },
      { label: "Center Diameter Circle", icon: "circle", kbd: "C", onSelect: () => setTool("circle") },
      { label: "Sketch Dimension", icon: "dimension", kbd: "D", onSelect: () => setTool("dimension") },
      { label: "Trim", icon: "trim", kbd: "T", onSelect: () => setTool("trim") },
      { label: "Offset", icon: "offset", kbd: "O", onSelect: () => setTool("offset") },
      { label: "Project", icon: "project", kbd: "P", onSelect: () => setTool("project") },
    );
    sep();
    undoRedo();
    sep();
    items.push({ label: "Export Sketch as SVG", icon: "export", onSelect: () => exportSketchSvg(sketchId) });
    items.push({ label: "Finish Sketch", icon: "finish", onSelect: finishSketch });
    return items;
  }

  // ---------------------------------------------------------------- solid
  if (repeat) {
    items.push({
      label: `Repeat ${commandLabel(repeat)}`,
      icon: repeat.kind === "dialog" ? (repeat.id === "combine" ? "combine" : repeat.id) : repeat.id,
      onSelect: repeatLastCommand,
    });
    sep();
  }

  if (first?.kind === "feature" && selection.length === 1) {
    const f = doc.features[first.featureId];
    if (f) {
      items.push({
        label: f.type === "sketch" ? "Edit Sketch" : "Edit Feature",
        icon: f.type === "sketch" ? "sketch" : "parameters",
        onSelect: () => editFeature(f.id),
      });
      if (f.type === "sketch") {
        items.push({
          label: f.visible ? "Hide" : "Show",
          icon: f.visible ? "eye-off" : "eye",
          kbd: "V",
          onSelect: () => run(setSketchVisible(f.id, !f.visible)),
        });
        items.push({ label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") });
        items.push({ label: "Export Sketch as SVG", icon: "export", onSelect: () => exportSketchSvg(f.id) });
      }
      items.push({
        label: f.suppressed ? "Unsuppress Features" : "Suppress Features",
        icon: "close",
        onSelect: () => run(setFeatureSuppressed(f.id, !f.suppressed)),
      });
      items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
      sep();
    }
  } else if (every("entity") && first?.kind === "entity") {
    const f = doc.features[first.sketchId];
    items.push({ label: "Edit Sketch", icon: "sketch", onSelect: () => enterSketch(first.sketchId) });
    items.push({
      label: "Export Sketch as SVG",
      icon: "export",
      onSelect: () => exportSketchSvg(first.sketchId),
    });
    if (f?.type === "sketch") {
      items.push({
        label: "Hide Sketch",
        icon: "eye-off",
        kbd: "V",
        onSelect: () => {
          run(setSketchVisible(f.id, false));
          setSelection([]);
        },
      });
    }
    sep();
  } else if (every("profile") && first?.kind === "profile") {
    items.push(
      { label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") },
      { label: "Revolve", icon: "revolve", onSelect: () => openDialog("revolve") },
      { label: "Edit Sketch", icon: "sketch", onSelect: () => enterSketch(first.sketchId) },
      {
        label: "Export Sketch as SVG",
        icon: "export",
        onSelect: () => exportSketchSvg(first.sketchId),
      },
    );
    sep();
  } else if (every("edge")) {
    items.push(
      { label: "Fillet", icon: "fillet-3d", kbd: "F", onSelect: () => openDialog("fillet") },
      { label: "Chamfer", icon: "chamfer-3d", onSelect: () => openDialog("chamfer") },
    );
    sep();
  } else if (every("face") && first?.kind === "face") {
    if (first.planar && selection.length === 1) {
      items.push({
        label: "Create Sketch",
        icon: "new-sketch",
        onSelect: () => beginSketchPlanePick(null),
      });
    }
    items.push({ label: "Shell", icon: "shell", onSelect: () => openDialog("shell") });
    sep();
  } else if (first?.kind === "origin-plane" && selection.length === 1) {
    items.push({
      label: "Create Sketch",
      icon: "new-sketch",
      onSelect: () => beginSketchPlanePick(null),
    });
    sep();
  }

  const bodyIds = [...new Set(selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : [])))];
  if (bodyIds.length > 0) {
    const visible = bodyIds.some((id) => doc.bodies[id]?.visible);
    items.push({
      label: visible ? "Hide Body" : "Show Body",
      icon: visible ? "eye-off" : "eye",
      kbd: "V",
      onSelect: () => {
        for (const id of bodyIds) run(setBodyVisible(id, !visible));
        setSelection([]);
      },
    });
    if (bodyIds.length > 1) {
      items.push({ label: "Combine", icon: "combine", onSelect: () => openDialog("combine") });
    }
    if (every("body")) {
      items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
    }
    sep();
  }

  if (!items.some((i) => "label" in i && i.label === "Create Sketch")) {
    items.push({
      label: "Create Sketch",
      icon: "new-sketch",
      kbd: "S",
      onSelect: () => beginSketchPlanePick(null),
    });
  }
  items.push(
    { label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") },
    { label: "Press Pull", icon: "extrude", kbd: "Q", onSelect: () => openDialog(every("edge") ? "fillet" : "extrude") },
    { label: "Fillet", icon: "fillet-3d", kbd: "F", onSelect: () => openDialog("fillet") },
  );
  sep();
  undoRedo();
  sep();
  items.push({ label: "Fit", icon: "fit", kbd: "F6", onSelect: () => viewportApi()?.fit() });
  return items;
}

/** `held`: opened by a long press, i.e. the finger is still on the screen. */
export function openContextMenu(x: number, y: number, held = false): void {
  appState.set({ contextMenu: { x, y, held } });
}

export function closeContextMenu(): void {
  if (appState.get().contextMenu) appState.set({ contextMenu: null });
}
