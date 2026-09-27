import { viewportApi } from "../viewport/api";
import { closeDialog, commitDialog, deleteSelection, openDialog, setTool } from "./actions";
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
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

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
      if (state.dimensionEdit) {
        appState.set({ dimensionEdit: null });
        return;
      }
      if (state.dialog) {
        closeDialog();
        return;
      }
      if (state.activeSketchId) {
        // First Esc cancels the picks of the running command, the next one the command itself.
        const hadPicks = viewportApi()?.cancel() ?? false;
        if (state.tool === "select") setSelection([]);
        else if (hadPicks) setSelection([]);
        else setTool("select");
        return;
      }
      setSelection([]);
      return;
    }

    if (key === "Enter") {
      if (state.dialog && state.dialog.type !== "parameters" && state.dialog.type !== "about") {
        e.preventDefault();
        commitDialog();
        return;
      }
      if (state.activeSketchId) {
        e.preventDefault();
        viewportApi()?.confirm();
      }
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
      const tool = SKETCH_KEYS[key];
      if (tool) {
        setTool(tool);
        return;
      }
      return;
    }
    if (state.dialog) return;
    if (key === "e") openDialog("extrude");
    else if (key === "s") openDialog("pick-sketch-plane");
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
