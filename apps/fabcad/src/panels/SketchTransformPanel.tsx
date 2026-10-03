import { type ReactElement, useMemo } from "react";
import { appState, lastViewportPoint } from "../app/appState";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { PICKS, type PickField, TRANSFORM_TITLES, VALUES, transformResult } from "../sketch/transformDialog";
import { cancelTransform, commitTransform, patchTransform, transformEvaluate } from "../sketch/transformTool";
import { FloatingPanel } from "../ui/FloatingPanel";

/**
 * The window of Move, Copy, Scale, Mirror and the patterns of the sketch, as in Fusion: the
 * selection inputs (click one, then pick in the view), the numbers, a live preview in the
 * sketch, and OK.
 */
export function SketchTransformPanel(): ReactElement | null {
  const t = useStore(appState, (s) => s.sketchTransform);
  const active = useStore(appState, (s) => s.activeSketchId);
  const doc = useDocument();
  const anchor = useMemo(() => lastViewportPoint(), [t?.tool, t?.sketchId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t || t.sketchId !== active) return null;
  const feature = doc.features[t.sketchId];
  if (feature?.type !== "sketch") return null;
  const result = transformResult(feature.sketch, t, transformEvaluate);

  const pickState = (field: PickField): string => {
    if (field === "objects") return t.objects.length > 0 ? `${t.objects.length} selected` : "Select";
    if (field === "axis") return t.axis ? "1 line" : "Select";
    const p = t[field];
    return p ? `${round(p.position.x)}, ${round(p.position.y)}` : "Select";
  };
  const clear = (field: PickField): void => {
    if (field === "objects") {
      patchTransform({ objects: [], picking: "objects" });
      appState.set({ selection: [] });
    } else {
      patchTransform({ [field]: null, picking: field });
    }
  };

  return (
    <FloatingPanel
      id="sketch-transform"
      anchor={anchor}
      title={TRANSFORM_TITLES[t.tool]}
      className="tool-window transform-window"
      onClose={cancelTransform}
      closeLabel="Cancel (Esc)"
    >
      <div className="floating-body">
        <div className="form">
          {PICKS[t.tool].map(({ field, label }) => {
            const set = pickState(field) !== "Select";
            return (
              <div key={field} className="field tool-field">
                <span className="label">{label}</span>
                <span className="pick-row">
                  <button
                    type="button"
                    className={`pickbox${t.picking === field ? " picking" : ""}${set ? " set" : ""}`}
                    aria-pressed={t.picking === field}
                    title={t.picking === field ? "Click in the sketch" : "Click to pick in the sketch"}
                    onClick={() => patchTransform({ picking: field })}
                  >
                    {t.picking === field && !set ? "Pick in sketch…" : pickState(field)}
                  </button>
                  {set && (
                    <button type="button" className="pick-clear" aria-label={`Clear ${label}`} onClick={() => clear(field)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {VALUES[t.tool].map((v) => (
            <label key={v.id} className="field tool-field">
              <span className="label">{v.label}</span>
              <span className="tool-input">
                <input
                  value={t.values[v.id] ?? ""}
                  aria-label={v.label}
                  inputMode="decimal"
                  enterKeyHint="done"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => patchTransform({ values: { ...t.values, [v.id]: e.target.value } })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTransform();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelTransform();
                    }
                  }}
                />
                {v.kind === "length" && <span className="unit">mm</span>}
                {v.kind === "angle" && <span className="unit">deg</span>}
              </span>
            </label>
          ))}
          {t.tool === "mirror" && (
            <label className="field tool-field check">
              <input type="checkbox" checked={t.symmetry} onChange={(e) => patchTransform({ symmetry: e.target.checked })} />
              Symmetry constraints
            </label>
          )}
        </div>
        <div className="form-actions" style={{ alignItems: "center" }}>
          {!result.ok && (
            <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
              {result.problem}
            </span>
          )}
          <button className="btn" onClick={cancelTransform}>
            Cancel
          </button>
          <button className="btn accent" disabled={!result.ok} onClick={commitTransform}>
            OK
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}

const round = (v: number): number => Math.round(v * 100) / 100;
