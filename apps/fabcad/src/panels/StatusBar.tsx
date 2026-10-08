import { type ReactElement, useEffect, useState } from "react";
import { appState } from "../app/appState";
import {
  autosaveState,
  keepThisTabsAutosave,
  modelState,
  restartCadWorker,
  resumeRecompute,
  retryAutosave,
  sketchView,
  stopCadWorker,
  useDocument,
} from "../app/session";
import { useStore } from "../app/tinyStore";
import { useHelpTrigger } from "../help/useHelpTrigger";

/** A computation running this long can be stopped from the status bar. */
const STOP_AFTER_S = 8;

const AUTOSAVE_LABEL = {
  saved: "Autosaved",
  saving: "Autosaving…",
  unsaved: "Not autosaved yet",
  error: "Autosave failed",
  conflict: "Autosave stopped: another tab",
} as const;

/** Help on right-click or long press, for status bar items that have no click of their own. */
function useHelpHandlers(id: string, title: string) {
  const trigger = useHelpTrigger({ id, title });
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return { guard, handlers };
}

const fmt = (v: number): string => v.toFixed(2);

export function StatusBar(): ReactElement {
  const doc = useDocument();
  const app = useStore(appState);
  const model = useStore(modelState);
  const autosave = useStore(autosaveState);
  const saveHelp = useHelpHandlers("file.autosave", "Autosave");
  const stopHelp = useHelpHandlers("model.stop", "Stop Computation");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!model.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [model.busy]);
  const computeSeconds = model.computeStartedAt ? Math.max(0, Math.floor((now - model.computeStartedAt) / 1000)) : 0;
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
        {...saveHelp.handlers}
      >
        {AUTOSAVE_LABEL[autosave.status]}
      </span>
      {autosave.status === "error" && (
        <button className="btn small" {...saveHelp.handlers} onClick={saveHelp.guard(retryAutosave)}>
          Retry
        </button>
      )}
      {autosave.status === "conflict" && (
        <button
          className="btn small"
          title="Save this tab's project in place of the other tab's (that one stays in Recover autosave…)"
          {...saveHelp.handlers}
          onClick={saveHelp.guard(() => void keepThisTabsAutosave())}
        >
          Keep this tab
        </button>
      )}
      {model.busy && computeSeconds >= STOP_AFTER_S && (
        <button className="btn small" {...stopHelp.handlers} onClick={stopHelp.guard(() => void stopCadWorker())}>
          Stop ({computeSeconds} s)
        </button>
      )}
      {model.kernel === "error" && (
        <button className="btn small" {...stopHelp.handlers} onClick={stopHelp.guard(() => void restartCadWorker())}>
          Restart CAD
        </button>
      )}
      {model.paused && model.kernel === "ready" && (
        <button className="btn small" {...stopHelp.handlers} onClick={stopHelp.guard(resumeRecompute)}>
          Resume
        </button>
      )}
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
