import { viewportApi } from "../viewport/api";
import {
  beginSketchPlanePick,
  closeDialog,
  commitDialog,
  deleteSelection,
  openDialog,
  setTool,
} from "./actions";
import { appState, setSelection } from "./appState";
import { redo, saveProject, undo } from "./session";

export interface ShortcutHooks {
  openProject(): void;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
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
  if (state.dialog) {
    closeDialog();
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
  if (state.activeSketchId) return viewportApi()?.confirm() ?? false;
  return false;
}

/** Shortcuts that start a solid feature; they also work while a sketch is open. */
const FEATURE_KEYS: Record<string, "extrude"> = {
  e: "extrude",
};

const SKETCH_KEYS: Record<string, string> = {
  l: "line",
  r: "rectangle-2point",
  c: "circle",
  a: "arc-3point",
  d: "dimension",
  t: "trim",
  o: "offset",
  m: "move",
  p: "point",
  s: "spline-fit",
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
      deleteSelection();
      return;
    }

    if (state.workspace !== "design" || e.altKey) return;

    if (key === "f") {
      viewportApi()?.fit();
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
      const feature = FEATURE_KEYS[key];
      if (feature) {
        e.preventDefault();
        openDialog(feature);
        return;
      }
      const tool = SKETCH_KEYS[key];
      if (tool) setTool(tool);
      return;
    }
    if (state.dialog && state.dialog.type !== "pick-sketch-plane") return;
    const feature = FEATURE_KEYS[key];
    if (feature) {
      openDialog(feature);
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
  return () => window.removeEventListener("keydown", onKey);
}
