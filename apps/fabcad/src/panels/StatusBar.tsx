import { type ReactElement, useEffect, useState } from "react";
import { appState } from "../app/appState";
import { autosaveState, modelState, recoverPreviousAutosave, restartCadWorker, retryAutosave, sketchView, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";

const fmt = (v: number): string => v.toFixed(2);

export function StatusBar(): ReactElement {
  const doc = useDocument();
  const app = useStore(appState);
  const model = useStore(modelState);
  const autosave = useStore(autosaveState);
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
      <span title={autosave.message || "Browser-local recovery; export a .fabcad.json for a separate backup"}>
        {autosave.status === "saved" ? "Browser saved" :
          autosave.status === "saving" ? "Browser saving…" :
          autosave.status === "error" ? "Browser save FAILED" : "Browser unsaved"}
      </span>
      {autosave.status === "error" && <button className="btn small" onClick={retryAutosave}>Retry save</button>}
      <button className="btn small" onClick={() => void recoverPreviousAutosave()} title="Restore an earlier browser recovery snapshot">Recover</button>
      {model.busy && computeSeconds >= 8 && (
        <button className="btn small" onClick={() => void restartCadWorker()}>Stop / restart CAD ({computeSeconds}s)</button>
      )}
      <span>
        {model.cached && model.kernel !== "error"
          ? "Shown as last saved · computing…"
          : model.kernel === "loading"
          ? "Kernel loading…"
          : model.kernel === "error"
            ? "Kernel unavailable"
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
