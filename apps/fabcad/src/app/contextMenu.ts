import { editText, explodeTexts } from "../text/textCommands";
import {
  listInstances,
  setBodyVisible,
  setComponentVisible,
  setFeatureSuppressed,
  setInstancesVisible,
  setPlaneVisible,
  setSketchVisible,
} from "@fabcad/cad-document";
import {
  activateComponent,
  activeComponentId,
  duplicateSelectedInstances,
  newComponent,
  newInstance,
  openInstanceMove,
} from "./components";
import { SKETCH_MODIFY_TOOLS, toggleConstruction } from "@fabcad/sketch";
import { CONSTRAINT_TOOLS } from "../sketch/constraintTools";
import { CREATE_TOOLS, createTool } from "../sketch/createTools";
import { exportSketchDxf, exportSketchSvg } from "../sketch/exportSketch";
import type { MenuItem } from "../ui/Menu";
import { viewportApi } from "../viewport/api";
import {
  DIALOG_COMMANDS,
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
  startSketchOnPlane,
} from "./actions";
import { type Dialog, appState, setSelection } from "./appState";
import { documentStore, editSketchSolved, redo, run, undo } from "./session";
import { freePoints } from "./solidDialogs";
import { pressEnter, pressEscape } from "./shortcuts";

/**
 * Context menu, modelled on the right-click menu of Fusion 360: OK / Cancel for the running
 * command, Repeat, what can be done with the selection, then the common commands.
 */
const dialogCommand = (id: string): { label: string; icon: string } | undefined =>
  (DIALOG_COMMANDS as Record<string, { label: string; icon: string } | undefined>)[id];

/** Menu entry that starts the command of a feature dialog. */
function dialogItem(type: Dialog["type"], kbd?: string): MenuItem {
  const c = dialogCommand(type);
  return {
    label: c?.label ?? type,
    icon: c?.icon,
    ...(kbd ? { kbd } : {}),
    onSelect: () => openDialog(type),
  };
}

function commandLabel(command: { kind: "tool" | "dialog" | "measure"; id: string; label: string }): string {
  if (command.kind === "dialog") return dialogCommand(command.id)?.label ?? command.label;
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
      const texts = selection.flatMap((s) =>
        s.kind === "text" && s.sketchId === sketchId ? [s.textId] : [],
      );
      if (texts.length > 0) {
        if (texts.length === 1) {
          items.push({ label: "Edit Text", icon: "text", onSelect: () => editText(sketchId, texts[0]!) });
        }
        items.push({
          label: "Explode Text",
          icon: "explode",
          onSelect: () => void explodeTexts(sketchId, texts),
        });
      }
      if (every("profile")) {
        items.push({ label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") });
        items.push({ label: "Revolve", icon: "revolve", onSelect: () => openDialog("revolve") });
        items.push(dialogItem("sweep"), dialogItem("loft"));
      }
      if (
        entities.length > 0 &&
        entities.length === selection.length &&
        entities.every((id) => feature.sketch.entities[id]?.type === "point")
      ) {
        items.push(dialogItem("hole", "H"));
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
      { label: "Text", icon: "text", onSelect: () => setTool("text") },
      { label: "Sketch Dimension", icon: "dimension", kbd: "D", onSelect: () => setTool("dimension") },
      { label: "Trim", icon: "trim", kbd: "T", onSelect: () => setTool("trim") },
      { label: "Offset", icon: "offset", kbd: "O", onSelect: () => setTool("offset") },
      { label: "Project", icon: "project", kbd: "P", onSelect: () => setTool("project") },
    );
    sep();
    undoRedo();
    sep();
    items.push({ label: "Export Sketch as SVG", icon: "export", onSelect: () => exportSketchSvg(sketchId) });
    items.push({ label: "Save As DXF", icon: "export", onSelect: () => exportSketchDxf(sketchId) });
    items.push({ label: "Finish Sketch", icon: "finish", onSelect: finishSketch });
    return items;
  }

  // ---------------------------------------------------------------- solid
  if (repeat) {
    items.push({
      label: `Repeat ${commandLabel(repeat)}`,
      icon: repeat.kind === "dialog" ? (dialogCommand(repeat.id)?.icon ?? repeat.id) : repeat.id,
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
      if (f.type === "offset-plane") {
        items.push(
          {
            label: "Create Sketch",
            icon: "new-sketch",
            onSelect: () => void startSketchOnPlane(f.id),
          },
          {
            label: f.visible ? "Hide" : "Show",
            icon: f.visible ? "eye-off" : "eye",
            kbd: "V",
            onSelect: () => run(setPlaneVisible(f.id, !f.visible)),
          },
        );
      } else if (f.type === "sketch") {
        items.push({
          label: f.visible ? "Hide" : "Show",
          icon: f.visible ? "eye-off" : "eye",
          kbd: "V",
          onSelect: () => run(setSketchVisible(f.id, !f.visible)),
        });
        items.push({ label: "Extrude", icon: "extrude", kbd: "E", onSelect: () => openDialog("extrude") });
        if (freePoints(f.sketch).length > 0) items.push(dialogItem("hole", "H"));
        items.push({ label: "Export Sketch as SVG", icon: "export", onSelect: () => exportSketchSvg(f.id) });
        items.push({ label: "Save As DXF", icon: "export", onSelect: () => exportSketchDxf(f.id) });
      } else {
        items.push(
          dialogItem("rectangular-pattern"),
          dialogItem("circular-pattern"),
          dialogItem("mirror"),
        );
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
    const points =
      f?.type === "sketch" &&
      selection.every(
        (s) => s.kind === "entity" && f.sketch.entities[s.entityId]?.type === "point",
      );
    if (points) items.push(dialogItem("hole", "H"));
    items.push({ label: "Edit Sketch", icon: "sketch", onSelect: () => enterSketch(first.sketchId) });
    items.push({
      label: "Export Sketch as SVG",
      icon: "export",
      onSelect: () => exportSketchSvg(first.sketchId),
    });
    items.push({
      label: "Save As DXF",
      icon: "export",
      onSelect: () => exportSketchDxf(first.sketchId),
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
      dialogItem("sweep"),
      dialogItem("loft"),
      { label: "Edit Sketch", icon: "sketch", onSelect: () => enterSketch(first.sketchId) },
      {
        label: "Export Sketch as SVG",
        icon: "export",
        onSelect: () => exportSketchSvg(first.sketchId),
      },
      { label: "Save As DXF", icon: "export", onSelect: () => exportSketchDxf(first.sketchId) },
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
      items.push(dialogItem("offset-plane"));
    }
    items.push({ label: "Shell", icon: "shell", onSelect: () => openDialog("shell") });
    if (selection.every((s) => s.kind === "face" && s.planar)) items.push(dialogItem("align"));
    sep();
  } else if (first?.kind === "origin-plane" && selection.length === 1) {
    items.push({
      label: "Create Sketch",
      icon: "new-sketch",
      onSelect: () => beginSketchPlanePick(null),
    });
    items.push(dialogItem("offset-plane"));
    sep();
  } else if (first?.kind === "plane" && selection.length === 1) {
    const f = doc.features[first.featureId];
    if (f?.type === "offset-plane") {
      items.push(
        { label: "Create Sketch", icon: "new-sketch", onSelect: () => beginSketchPlanePick(null) },
        { label: "Edit Plane", icon: "parameters", onSelect: () => editFeature(f.id) },
        dialogItem("offset-plane"),
        {
          label: f.visible ? "Hide" : "Show",
          icon: f.visible ? "eye-off" : "eye",
          kbd: "V",
          onSelect: () => run(setPlaneVisible(f.id, !f.visible)),
        },
        { label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection },
      );
      sep();
    }
  }

  // ------------------------------------------------------- components
  if (first?.kind === "component" && selection.length === 1) {
    const c = doc.assembly.components[first.componentId];
    if (c) {
      const isActive = activeComponentId(doc) === c.id;
      const own = listInstances(doc, c.id);
      const shown = own.some((i) => i.visible);
      items.push(
        isActive
          ? { label: "Activate Root", icon: "document", onSelect: () => activateComponent(null) }
          : { label: "Activate Component", icon: "component", onSelect: () => activateComponent(c.id) },
        { label: "Create Instance", icon: "instance", onSelect: () => newInstance(c.id) },
        { label: "Rename", icon: "parameters", onSelect: () => appState.set({ renaming: `component:${c.id}` }) },
      );
      if (own.length > 0) {
        items.push({
          label: shown ? "Hide" : "Show",
          icon: shown ? "eye-off" : "eye",
          kbd: "V",
          onSelect: () => run(setComponentVisible(c.id, !shown)),
        });
      }
      items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
      sep();
    }
  } else if (every("instance")) {
    const ids = selection.flatMap((s) => (s.kind === "instance" ? [s.instanceId] : []));
    const one = ids.length === 1 ? doc.assembly.instances[ids[0]!] : undefined;
    const shown = ids.some((id) => doc.assembly.instances[id]?.visible);
    if (one) {
      items.push(
        { label: "Move / Rotate", icon: "move-3d", kbd: "M", onSelect: () => openInstanceMove(one.id) },
        { label: "Activate Component", icon: "component", onSelect: () => activateComponent(one.componentId) },
      );
    }
    items.push(
      { label: "Duplicate", icon: "copy", onSelect: duplicateSelectedInstances },
      {
        label: shown ? "Hide" : "Show",
        icon: shown ? "eye-off" : "eye",
        kbd: "V",
        onSelect: () => run(setInstancesVisible(ids, !shown)),
      },
    );
    if (one) {
      items.push({ label: "Rename", icon: "parameters", onSelect: () => appState.set({ renaming: `instance:${one.id}` }) });
    }
    items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
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
      items.push(dialogItem("move", "M"));
      items.push({ label: "Create Component", icon: "new-component", onSelect: newComponent });
      if (bodyIds.length === 1) items.push(dialogItem("split"));
      items.push(
        dialogItem("mirror"),
        dialogItem("rectangular-pattern"),
        dialogItem("circular-pattern"),
      );
      items.push({ label: "Delete", icon: "trash", kbd: "Del", onSelect: deleteSelection });
    }
    sep();
  }

  if (
    activeComponentId(doc) !== doc.assembly.rootComponentId &&
    !items.some((i) => "label" in i && i.label === "Activate Root")
  ) {
    items.push({ label: "Activate Root", icon: "document", onSelect: () => activateComponent(null) });
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
    dialogItem("hole", "H"),
    dialogItem("move", "M"),
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
