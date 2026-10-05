import {
  featureMoveRange,
  listFeatures,
  moveFeature,
  setFeatureSuppressed,
  setTimelineCursor,
} from "@fabcad/cad-document";
import { type ReactElement, useState } from "react";
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
  // Dragging a step to another place in the history (`featureMoveRange` says where it may go).
  const [drag, setDrag] = useState<{ id: string; from: number; range: ReturnType<typeof featureMoveRange> } | null>(null);
  const [over, setOver] = useState<{ index: number; side: "before" | "after"; to: number; ok: boolean } | null>(null);
  const dropAt = (index: number, side: "before" | "after"): { to: number; ok: boolean } | null => {
    if (!drag) return null;
    const place = side === "before" ? index : index + 1;
    const to = place > drag.from ? place - 1 : place;
    return { to, ok: to >= drag.range.min && to <= drag.range.max };
  };
  const refusal = (to: number): string => {
    if (!drag) return "";
    const name = (id?: string): string => (id ? (doc.features[id]?.name ?? id) : "");
    const moved = name(drag.id);
    return to < drag.range.min
      ? `${moved} is built on ${name(drag.range.after)}: it has to stay after it.`
      : `${name(drag.range.before)} is built on ${moved}: ${moved} has to stay before it.`;
  };
  const trackHelp = useHelpTrigger({ id: "timeline", title: "Timeline" });
  // Help on the empty part of the timeline; the steps have a context menu of their own.
  const onTrack = <E extends { target: EventTarget; currentTarget: EventTarget }>(
    handler: ((e: E) => void) | undefined,
  ) => (handler ? (e: E) => e.target === e.currentTarget && handler(e) : undefined);

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
      <div
        className="timeline-track"
        onContextMenu={onTrack(trackHelp?.onContextMenu)}
        onPointerDown={onTrack(trackHelp?.onPointerDown)}
        onPointerMove={trackHelp?.onPointerMove}
        onPointerUp={trackHelp?.onPointerUp}
        onPointerCancel={trackHelp?.onPointerCancel}
        onPointerLeave={trackHelp?.onPointerLeave}
      >
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
            "Double-click to edit · Alt-click to suppress · Drag to move in the history",
          ]
            .filter(Boolean)
            .join("\n");
          return [
            i === cursor && cursor < features.length ? marker : null,
            <button
              key={f.id}
              data-feature-id={f.id}
              className={`timeline-item ${state}${selected ? " selected" : ""}${activeSketchId === f.id ? " editing" : ""}${other ? " other-component" : ""}${
                over?.index === i ? ` drop-${over.side}${over.ok ? "" : " drop-refused"}` : ""
              }${drag?.id === f.id ? " dragging" : ""}`}
              title={title}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", f.name);
                setDrag({ id: f.id, from: i, range: featureMoveRange(documentStore.document, f.id) });
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                const r = e.currentTarget.getBoundingClientRect();
                const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
                const at = dropAt(i, side);
                if (!at) return;
                // Taken either way, so that a refused place can say why on drop.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over?.index !== i || over.side !== side || over.ok !== at.ok) setOver({ index: i, side, ...at });
              }}
              onDragLeave={() => setOver((o) => (o?.index === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const at = dropAt(i, e.clientX < r.left + r.width / 2 ? "before" : "after");
                if (drag && at) {
                  if (at.ok) run(moveFeature(drag.id, at.to));
                  else toast(refusal(at.to), "warning", 6000);
                }
                setDrag(null);
                setOver(null);
              }}
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
                e.stopPropagation();
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
