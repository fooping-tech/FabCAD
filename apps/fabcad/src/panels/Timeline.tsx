import { listFeatures, setFeatureSuppressed, setTimelineCursor } from "@fabcad/cad-document";
import type { ReactElement } from "react";
import { editFeature, featureIcon, pickInDialog } from "../app/actions";
import { appState, isAdditiveClick, isSelected, select, toast } from "../app/appState";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { openContextMenu } from "../app/contextMenu";
import { documentStore, modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { useActiveComponentId } from "../app/components";
import { Icon } from "../ui/Icon";

function CopyLogButton(): ReactElement {
  const title = "History log — the steps, their errors and the bodies; Copy adds the project, for a bug report";
  const trigger = useHelpTrigger({ id: "timeline.copy-log", title: "History Log" });
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return (
    <button
      className="icon-btn"
      title={title}
      aria-label="History log"
      {...handlers}
      onClick={guard(() => appState.set((st) => ({ historyLogOpen: !st.historyLogOpen })))}
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
  const activeComponent = useActiveComponentId();
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
          // One timeline for all components; the steps of the others step back.
          const other = f.componentId !== activeComponent;
          const owner = doc.assembly.components[f.componentId];
          const title = [
            f.name,
            f.componentId !== doc.assembly.rootComponentId && owner ? `Component: ${owner.name}` : "",
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
              className={`timeline-item ${state}${selected ? " selected" : ""}${activeSketchId === f.id ? " editing" : ""}${other ? " other-component" : ""}`}
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
