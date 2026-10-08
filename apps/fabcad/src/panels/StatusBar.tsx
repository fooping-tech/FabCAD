import type { ReactElement } from "react";
import { appState } from "../app/appState";
import { autosaveState, modelState, sketchView, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { StatusActions } from "./StatusActions";

const AUTOSAVE_LABEL = {
  saved: "Autosaved",
  saving: "Autosaving…",
  unsaved: "Not autosaved yet",
  error: "Autosave failed",
  conflict: "Autosave stopped: another tab",
} as const;

const fmt = (v: number): string => v.toFixed(2);

export function StatusBar(): ReactElement {
  const doc = useDocument();
  const app = useStore(appState);
  const model = useStore(modelState);
  const autosave = useStore(autosaveState);
  // The state itself has no click: help on right-click or long press.
  const { guard: _guard, ...saveHelp } = useHelpTrigger({ id: "file.autosave", title: "Autosave" }) ?? { guard: null };
  const sketch = app.activeSketchId ? doc.features[app.activeSketchId] : undefined;
  const view = sketch?.type === "sketch" ? sketchView(sketch.sketch, doc) : null;
  const errors = Object.values(model.features).filter((f) => f.state === "error");

  let hint = app.hint;
  if (!app.activeSketchId && !app.dialog && app.workspace === "design") {
    hint = "Left-drag or right-drag: orbit · Middle-drag or two-finger swipe: pan · Wheel or pinch: zoom · Click: select";
  } else if (app.activeSketchId && !hint) {
    hint = "Right-drag: orbit · Middle-drag or two-finger swipe: pan · Wheel or pinch: zoom";
  }

  return (
    <footer className="status">
      <span>{hint}</span>
      <span className="spacer" />
      {view && (
        <span
          className={
            view.status === "fully-constrained"
              ? "state-ok"
              : view.status === "over-constrained"
                ? "state-danger"
                : "state-warn"
          }
        >
          {view.status === "fully-constrained"
            ? "Fully constrained"
            : view.status === "over-constrained"
              ? "Over-constrained"
              : `Under-constrained (${view.degreesOfFreedom} DOF)`}
        </span>
      )}
      {app.cursor && app.activeSketchId && (
        <span className="mono">
          X {fmt(app.cursor.x)} mm  Y {fmt(app.cursor.y)} mm
        </span>
      )}
      {app.selection.length > 0 && <span>{app.selection.length} selected</span>}
      {errors.length > 0 && (
        <span className="state-danger" title={errors.map((e) => e.message).join("\n")}>
          {errors.length} feature {errors.length === 1 ? "error" : "errors"}
        </span>
      )}
      <span
        className={autosave.status === "error" || autosave.status === "conflict" ? "state-danger" : undefined}
        title={autosave.message || "Kept in this browser only. Save project keeps a file as well."}
        {...saveHelp}
      >
        {AUTOSAVE_LABEL[autosave.status]}
      </span>
      <StatusActions />
      <span>
        {model.cached && model.kernel !== "error"
          ? "Shown as last saved · computing…"
          : model.kernel === "loading"
          ? "Kernel loading…"
          : model.kernel === "error"
            ? "Kernel unavailable"
            : model.paused
              ? "Paused"
              : model.busy
                ? "Computing…"
                : `Ready · ${model.lastDurationMs} ms`}
      </span>
      <span>
        <strong>mm</strong> · deg
      </span>
    </footer>
  );
}
