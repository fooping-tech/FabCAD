import { type MeasureValue, formatMeasure } from "@fabcad/geometry";
import { type ReactElement, useMemo } from "react";
import { stopMeasure } from "../app/actions";
import { appState, toast } from "../app/appState";
import { documentStore, modelState, sketchView, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";
import { type MeasureContext, type Measurement, measureSelection } from "./items";

export function measureContext(): MeasureContext {
  const doc = documentStore.document;
  return {
    doc,
    bodies: modelState.get().bodies,
    regions: (sketchId) => {
      const f = doc.features[sketchId];
      return f?.type === "sketch" ? sketchView(f.sketch, doc).regions : [];
    },
  };
}

/** The measurement of the current picks; used by the panel and by the viewport overlay. */
export function currentMeasurement(): Measurement | null {
  const state = appState.get();
  return state.measuring ? measureSelection(state.selection, measureContext()) : null;
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text}`);
  } catch {
    toast("The browser did not allow copying. Select the value and copy it by hand.", "warning");
  }
}

function Row({ v, main }: { v: MeasureValue; main?: boolean }): ReactElement {
  const text = formatMeasure(v);
  return (
    <div className={`measure-row${main ? " main" : ""}`}>
      <span className="name">{v.label}</span>
      <span className="value" data-measure={v.id}>
        {text}
      </span>
      <button title={`Copy ${text}`} aria-label={`Copy ${v.label}`} onClick={() => void copy(text)}>
        <Icon name="copy" size={13} />
      </button>
    </div>
  );
}

export function MeasurePanel(): ReactElement | null {
  const measuring = useStore(appState, (s) => s.measuring);
  const selection = useStore(appState, (s) => s.selection);
  const bodies = useStore(modelState, (s) => s.bodies);
  const doc = useDocument();
  const result = useMemo(
    () => (measuring ? measureSelection(selection, measureContext()) : null),
    // The document and the bodies are read through the context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measuring, selection, bodies, doc],
  );
  if (!measuring || !result) return null;
  const all = [
    ...(result.between?.values ?? []),
    ...result.picks.flatMap((p, i) => p.values.map((v) => ({ ...v, label: `${i + 1} ${v.label}` }))),
  ];
  return (
    <div className="floating measure" role="dialog" aria-label="Measure">
      <div className="floating-title">
        <span>Measure</span>
        <button className="icon-btn" aria-label="Close" onClick={stopMeasure}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="floating-body">
        {result.picks.length === 0 && (
          <p className="field-hint" style={{ margin: 0 }}>
            Select a point, an edge, a face or a body. Select a second one to measure between
            them.
          </p>
        )}
        {result.between && result.between.values.length > 0 && (
          <div className="measure-group">
            <h4>Between the selections</h4>
            {result.between.values.map((v) => (
              <Row key={v.id} v={v} main={v.id === "distance" || v.id === "angle"} />
            ))}
          </div>
        )}
        {result.picks.map((p, i) => (
          <div className="measure-group" key={i}>
            <h4>
              <span className="n">{i + 1}</span>
              {p.label}
            </h4>
            {p.values.map((v) => (
              <Row key={v.id} v={v} />
            ))}
          </div>
        ))}
        {result.picks.length > 0 && (
          <div className="form-actions">
            <button className="btn small" onClick={() => appState.set({ selection: [] })}>
              Restart
            </button>
            <button
              className="btn small"
              onClick={() =>
                void copy(all.map((v) => `${v.label}: ${formatMeasure(v)}`).join("\n"))
              }
            >
              Copy all
            </button>
            <button className="btn small primary" onClick={stopMeasure}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
