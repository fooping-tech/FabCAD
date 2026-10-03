import { viewportApi } from "../viewport/api";
import { createTool } from "../sketch/createTools";
import { startsPointEntry } from "../sketch/pointEntry";
import { submitPointEntry } from "../panels/PointEntry";
import { runPaletteSelection } from "../panels/CommandPalette";
import { applyShapeDimensions } from "../panels/ShapeDimensionsPanel";
import {
  beginSketchPlanePick,
  closeDialog,
  commitDialog,
  deleteSelection,
  openDialog,
  setTool,
  startMeasure,
  stopMeasure,
} from "./actions";
import { appState, setSelection } from "./appState";
import {
  listInstances,
  setBodyVisible,
  setComponentVisible,
  setInstancesVisible,
  setPlaneVisible,
  setSketchVisible,
} from "@fabcad/cad-document";
import {
  cancelInstanceMove,
  cancelNewComponent,
  commitInstanceMove,
  openInstanceMove,
} from "./components";
import { documentStore, redo, run, saveProject, undo } from "./session";

export interface ShortcutHooks {
  openProject(): void;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  // A focused checkbox or radio button does not take text: shortcuts stay available.
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "range"].includes(target.type);
  }
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
};

/** Esc: cancel the picks of the running command first, then the command itself. */
export function pressEscape(): void {
  const state = appState.get();
  if (state.dimensionEdit) {
    appState.set({ dimensionEdit: null });
    return;
  }
  if (state.shapeDimensions) {
    appState.set({ shapeDimensions: null });
    return;
  }
  if (state.dialog) {
    closeDialog();
    return;
  }
  if (state.instanceMove) {
    cancelInstanceMove();
    return;
  }
  if (state.newComponent) {
    cancelNewComponent();
    return;
  }
  if (state.measuring) {
    stopMeasure();
    return;
  }
  if (state.activeSketchId) {
    const hadPicks = viewportApi()?.cancel() ?? false;
    if (state.tool === "select" || hadPicks) setSelection([]);
    else setTool("select");
    return;
  }
  setSelection([]);
}

/** Enter: confirm the open dialog or finish an open-ended sketch command. */
export function pressEnter(): boolean {
  const state = appState.get();
  if (state.dialog && state.dialog.type !== "parameters" && state.dialog.type !== "about") {
    commitDialog();
    return true;
  }
  if (state.instanceMove) {
    commitInstanceMove();
    return true;
  }
  if (state.activeSketchId) return viewportApi()?.confirm() ?? false;
  return false;
}

/**
 * Keys follow Fusion 360 where FabCAD has the command: L R C D T O X (sketch), E Q F H (solid),
 * M (Move: sketch geometry inside a sketch, bodies outside), P, V, Delete and F6. A (arc) and
 * S (spline) are FabCAD's own.
 */

/** Q, Press Pull: fillet when edges are selected, extrude otherwise. */
function pressPull(): void {
  const { selection } = appState.get();
  const edges = selection.length > 0 && selection.every((s) => s.kind === "edge");
  openDialog(edges ? "fillet" : "extrude");
}

/** V: show or hide the selected bodies, sketches, construction planes and instances. */
function toggleVisibility(): boolean {
  const { selection } = appState.get();
  const doc = documentStore.document;
  let done = false;
  const bodies = new Set<string>();
  for (const s of selection) {
    if ("bodyId" in s) bodies.add(s.bodyId);
    if (s.kind === "plane") {
      const f = doc.features[s.featureId];
      if (f?.type === "offset-plane") done = run(setPlaneVisible(f.id, !f.visible)) || done;
    }
    if (s.kind === "feature" || s.kind === "profile" || s.kind === "entity") {
      const id = s.kind === "feature" ? s.featureId : s.sketchId;
      const f = doc.features[id];
      if (f?.type === "sketch") done = run(setSketchVisible(id, !f.visible)) || done;
      if (f?.type === "offset-plane") done = run(setPlaneVisible(id, !f.visible)) || done;
      for (const b of Object.values(doc.bodies)) if (b.createdBy === id) bodies.add(b.id);
    }
    if (s.kind === "instance") {
      const i = doc.assembly.instances[s.instanceId];
      if (i) done = run(setInstancesVisible([i.id], !i.visible)) || done;
    }
    if (s.kind === "component") {
      const shown = listInstances(doc, s.componentId).some((i) => i.visible);
      done = run(setComponentVisible(s.componentId, !shown)) || done;
    }
  }
  for (const id of bodies) {
    const b = doc.bodies[id];
    if (b) done = run(setBodyVisible(id, !b.visible)) || done;
  }
  if (done) appState.set({ selection: [], hover: null });
  return done;
}

const SKETCH_KEYS: Record<string, string> = {
  l: "line",
  r: "rectangle-2point",
  c: "circle",
  a: "arc-3point",
  d: "dimension",
  t: "trim",
  o: "offset",
  m: "move",
  p: "project",
  s: "spline-fit",
  f: "fillet",
};

/** Global keyboard handling. There is always exactly one running command to cancel. */
export function installShortcuts(hooks: ShortcutHooks): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const meta = e.metaKey || e.ctrlKey;
    // With a Japanese (or other) input method switched on, `key` is "Process" and the letter
    // is only available from the physical key code.
    const physical = /^Key([A-Z])$/.exec(e.code);
    const composing = e.key === "Process" || e.key === "Unidentified" || e.isComposing;
    const key =
      physical && (composing || e.key.length !== 1 || !/^[\x20-\x7e]$/.test(e.key))
        ? physical[1]!.toLowerCase()
        : e.key.length === 1
          ? e.key.toLowerCase()
          : e.key;

    if (meta && key === "s") {
      e.preventDefault();
      saveProject();
      return;
    }
    if (meta && key === "o") {
      e.preventDefault();
      hooks.openProject();
      return;
    }
    if (isEditable(e.target)) return;
    // Keys that arrive before the palette's box has the focus belong to it.
    const palette = appState.get().commandPalette;
    if (palette && !meta) {
      if (e.key === "Enter") runPaletteSelection();
      else if (e.key === "Escape") appState.set({ commandPalette: null });
      else if (e.key === "Backspace") appState.set({ commandPalette: { query: palette.query.slice(0, -1) } });
      else if (e.key.length === 1) appState.set({ commandPalette: { query: palette.query + e.key } });
      else return;
      e.preventDefault();
      return;
    }
    // Once a number has started the first dimension of the shape just drawn, the keys that
    // arrive before its field has the focus belong to it.
    const shape = appState.get().shapeDimensions;
    if (shape?.typed && appState.get().activeSketchId && !meta) {
      if (e.key === "Enter") applyShapeDimensions();
      else if (e.key === "Escape") appState.set({ shapeDimensions: null });
      else if (e.key === "Backspace") appState.set({ shapeDimensions: { ...shape, typed: { ...shape.typed, text: shape.typed.text.slice(0, -1) } } });
      else if (e.key.length === 1) appState.set({ shapeDimensions: { ...shape, typed: { ...shape.typed, text: shape.typed.text + e.key } } });
      else return;
      e.preventDefault();
      return;
    }
    // Keys that arrive before the point box has the focus belong to it.
    const entry = appState.get().pointEntry;
    if (entry && appState.get().activeSketchId && !meta) {
      if (e.key === "Enter") submitPointEntry();
      else if (e.key === "Escape") appState.set({ pointEntry: null });
      else if (e.key === "Backspace") appState.set({ pointEntry: { text: entry.text.slice(0, -1) } });
      else if (e.key.length === 1) appState.set({ pointEntry: { text: entry.text + e.key } });
      else return;
      e.preventDefault();
      return;
    }
    // Letters typed through an input method must not reach the page as text.
    if (composing && physical && !meta) e.preventDefault();

    if (meta && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (meta) return;

    const state = appState.get();

    if (key === "Escape") {
      e.preventDefault();
      pressEscape();
      return;
    }

    if (key === "Enter") {
      if (pressEnter()) e.preventDefault();
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      // What is picked for measuring is only being looked at.
      if (!state.measuring) deleteSelection();
      return;
    }

    if (state.workspace !== "design" || e.altKey) return;

    // A shortcut letter must not end up in the field that the command focuses next.
    if (key.length === 1) e.preventDefault();

    if (key === "F6") {
      e.preventDefault();
      viewportApi()?.fit();
      return;
    }
    if (key === "i" && (!state.dialog || state.dialog.type === "pick-sketch-plane")) {
      startMeasure();
      return;
    }
    if (key === "v" && !state.dialog) {
      toggleVisibility();
      return;
    }
    if (state.activeSketchId) {
      if (key === "x") {
        appState.set((s) => ({
          toolOptions: { ...s.toolOptions, construction: !s.toolOptions.construction },
        }));
        return;
      }
      // Like Fusion: a feature shortcut finishes the sketch and starts the feature on it.
      if (key === "e" || key === "q") {
        e.preventDefault();
        openDialog("extrude");
        return;
      }
      if (key === "h") {
        openDialog("hole");
        return;
      }
      // Digits (and @ - . ( ) start a typed point of the running Create tool.
      const typed = composing ? (/^Digit(\d)$/.exec(e.code)?.[1] ?? "") : e.key;
      // With the dimensions of the shape just drawn on screen, a number is one of them.
      const dims = state.shapeDimensions;
      if (dims && startsPointEntry(typed)) {
        appState.set({ shapeDimensions: { ...dims, typed: { text: typed, at: Date.now() } } });
        return;
      }
      if (createTool(state.tool) && startsPointEntry(typed)) {
        appState.set({ pointEntry: { text: typed } });
        return;
      }
      const tool = SKETCH_KEYS[key];
      if (tool) setTool(tool);
      return;
    }
    if (state.dialog && state.dialog.type !== "pick-sketch-plane") return;
    if (key === "e") {
      openDialog("extrude");
      return;
    }
    if (key === "q") {
      pressPull();
      return;
    }
    if (key === "f") {
      openDialog("fillet");
      return;
    }
    if (key === "h") {
      openDialog("hole");
      return;
    }
    if (key === "m") {
      // M on one instance places it; Move/Copy works on bodies.
      const only = appState.get().selection;
      if (only.length === 1 && only[0]!.kind === "instance") {
        openInstanceMove(only[0]!.instanceId);
        e.preventDefault();
        return;
      }
      openDialog("move");
      return;
    }
    if (key === "s") {
      beginSketchPlanePick(null);
      return;
    }
    // A sketch tool outside a sketch asks for the plane first, then starts the tool.
    const tool = SKETCH_KEYS[key];
    if (tool) beginSketchPlanePick(tool);
  };
  window.addEventListener("keydown", onKey);
  // Ctrl / Cmd + K opens the command palette from anywhere, also from fields that keep their
  // keys to themselves: it is looked at on the way down, before any field sees it.
  const onPaletteKey = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "k" && e.code !== "KeyK") return;
    e.preventDefault();
    e.stopPropagation();
    appState.set((st) => ({ commandPalette: st.commandPalette ? null : { query: "" }, contextMenu: null }));
  };
  window.addEventListener("keydown", onPaletteKey, { capture: true });
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keydown", onPaletteKey, { capture: true });
  };
}
