import { listFeatures, setFeatureSuppressed, setTimelineCursor } from "@fabcad/cad-document";
import type { ReactElement } from "react";
import { editFeature, featureIcon, pickInDialog } from "../app/actions";
import { appState, isAdditiveClick, isSelected, select, toast } from "../app/appState";
import { historyLog } from "../app/historyLog";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { openContextMenu } from "../app/contextMenu";
import { documentStore, modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

/** Copy the history log (steps, bodies and the project) for a bug report. */
async function copyHistoryLog(): Promise<void> {
  const { features, bodies } = modelState.get();
  const text = historyLog(documentStore.document, features, bodies, {
    version: __APP_VERSION__,
    date: new Date(),
  });
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied the history log.");
  } catch {
    toast("The browser did not allow copying.", "warning");
  }
}

function CopyLogButton(): ReactElement {
  const title = "Copy history log — the steps, their errors and the project, for a bug report";
  const trigger = useHelpTrigger({ id: "timeline.copy-log", title: "Copy History Log" });
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return (
    <button
      className="icon-btn"
      title={title}
      aria-label="Copy history log"
      {...handlers}
      onClick={guard(() => void copyHistoryLog())}
    >
      <Icon name="copy" size={14} />
    </button>
  );
}

export function Timeline(): ReactElement {
  const doc = useDocument();
  const statuses = useStore(modelState, (s) => s.features);
  const selection = useStore(appState, (s) => s.selection);
  const activeSketchId = useStore(appState, (s) => s.activeSketchId);
  const features = listFeatures(doc);
  const cursor = doc.timelineCursor ?? features.length;

  const marker = (
    <div
      key="marker"
      className="timeline-marker"
      title="History marker: features to the right are not computed"
      role="separator"
    />
  );

  return (
    <div className="timeline" aria-label="Timeline">
      <div className="timeline-controls">
        <button className="icon-btn" title="Move the history marker to the start" aria-label="History to start" disabled={cursor === 0} onClick={() => run(setTimelineCursor(0))}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4h2v12H4zM16 4v12L7 10z" /></svg>
        </button>
        <button className="icon-btn" title="Step back" aria-label="History step back" disabled={cursor === 0} onClick={() => run(setTimelineCursor(cursor - 1))}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M14 4v12L5 10z" /></svg>
        </button>
        <button className="icon-btn" title="Step forward" aria-label="History step forward" disabled={cursor >= features.length} onClick={() => run(setTimelineCursor(cursor + 1))}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4v12l9-6z" /></svg>
        </button>
        <button className="icon-btn" title="Move the history marker to the end" aria-label="History to end" disabled={cursor >= features.length} onClick={() => run(setTimelineCursor(null))}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M14 4h2v12h-2zM4 4v12l9-6z" /></svg>
        </button>
        <CopyLogButton />
      </div>
      <div className="timeline-track">
        {features.length === 0 && (
          <span className="timeline-empty">
            The design history appears here. Start with Create Sketch.
          </span>
        )}
        {features.map((f, i) => {
          const status = statuses[f.id];
          const state = f.suppressed
            ? "suppressed"
            : i >= cursor
              ? "rolled-back"
              : status?.state === "error"
                ? "error"
                : "";
          const selected = isSelected(selection, { kind: "feature", featureId: f.id });
          const title = [
            f.name,
            status?.message,
            f.suppressed ? "Suppressed" : "",
            "Double-click to edit · Alt-click to suppress",
          ]
            .filter(Boolean)
            .join("\n");
          return [
            i === cursor && cursor < features.length ? marker : null,
            <button
              key={f.id}
              className={`timeline-item ${state}${selected ? " selected" : ""}${activeSketchId === f.id ? " editing" : ""}`}
              title={title}
              onClick={(e) => {
                if (e.altKey) {
                  run(setFeatureSuppressed(f.id, !f.suppressed));
                  return;
                }
                const additive = isAdditiveClick(e);
                // An open feature dialog takes the click as a pick (the source of a pattern).
                if (pickInDialog({ kind: "feature", featureId: f.id }, additive)) return;
                select({ kind: "feature", featureId: f.id }, additive);
              }}
              onDoubleClick={() => editFeature(f.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                appState.set({ selection: [{ kind: "feature", featureId: f.id }] });
                openContextMenu(e.clientX, e.clientY);
              }}
            >
              <Icon name={featureIcon(f)} size={18} />
              <span>{f.name}</span>
            </button>,
          ];
        })}
        {features.length > 0 && cursor >= features.length && marker}
      </div>
    </div>
  );
}
