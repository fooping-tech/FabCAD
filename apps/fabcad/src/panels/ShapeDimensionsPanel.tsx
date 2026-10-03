import { evaluateAs } from "@fabcad/cad-document";
import { editSketch } from "@fabcad/sketch";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { appState } from "../app/appState";
import { currentScope, editSketchSolved, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

/** Applies the open window; set while it is open (Enter before a field has the focus). */
let applyOpen: (() => void) | null = null;
export function applyShapeDimensions(): void {
  applyOpen?.();
}

/**
 * The dimensions of the shape just drawn (length, width and height, diameter …), beside it.
 * A value typed here becomes a driving dimension of the sketch; values left as drawn add
 * nothing. Enter applies, Esc closes, and the next shape closes it too.
 */
export function ShapeDimensionsPanel(): ReactElement | null {
  const dims = useStore(appState, (s) => s.shapeDimensions);
  const active = useStore(appState, (s) => s.activeSketchId);
  const doc = useDocument();
  if (!dims || dims.sketchId !== active) return null;
  const feature = doc.features[dims.sketchId];
  // Undone, or the sketch was left: there is nothing to dimension any more.
  if (feature?.type !== "sketch" || dims.fields.some((f) => f.refs.some((r) => !feature.sketch.entities[r]))) {
    return null;
  }
  // A new window for every shape: its fields start from what was drawn.
  return <Body key={`${dims.sketchId}:${dims.fields.map((f) => f.refs.join(",")).join("|")}`} />;
}

function Body(): ReactElement | null {
  const dims = useStore(appState, (s) => s.shapeDimensions)!;
  const [values, setValues] = useState(() => dims.fields.map((f) => f.value));
  const [errors, setErrors] = useState<(string | null)[]>(() => dims.fields.map(() => null));
  // Typed values become dimensions, also when they repeat the size as drawn.
  const [edited, setEdited] = useState<boolean[]>(() => dims.fields.map(() => false));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  // A number typed in the view starts the first value. The keys that follow are collected in
  // `typed` until the field has the focus (`shortcuts.ts`), then they go to the field itself.
  const typed = dims.typed;
  const focused = useRef(false);
  const programmatic = useRef(false);
  useEffect(() => {
    if (!typed) return;
    setValues((v) => [typed.text, ...v.slice(1)]);
    setEdited((d) => [true, ...d.slice(1)]);
  }, [typed?.text, typed?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = inputs.current[0];
    if (!typed || !el || focused.current) return;
    focused.current = true;
    programmatic.current = true;
    el.focus();
    programmatic.current = false;
    el.setSelectionRange(el.value.length, el.value.length);
    // From now on the field takes the keys.
    appState.set((st) => (st.shapeDimensions ? { shapeDimensions: { ...st.shapeDimensions, typed: undefined } } : {}));
  }, [values]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (): void => appState.set({ shapeDimensions: null });
  const apply = (): void => {
    const changed = dims.fields
      .map((f, i) => ({ f, expression: values[i]!.trim(), i }))
      .filter(({ expression, i }) => edited[i] && expression !== "");
    if (changed.length === 0) {
      close();
      return;
    }
    const problems = dims.fields.map((f, i) => {
      const e = values[i]!.trim();
      if (!edited[i] || e === "") return null;
      try {
        const v = evaluateAs(e, f.unit === "deg" ? "angle" : "length", currentScope());
        return v > 0 ? null : "Must be greater than zero";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });
    setErrors(problems);
    if (problems.some((p) => p !== null)) return;
    const ok = editSketchSolved(
      dims.sketchId,
      "Dimension",
      (sketch) =>
        editSketch(sketch, (b) => {
          for (const { f, expression } of changed) b.dimension(f.type, f.refs, expression);
        }),
      { rejectOverConstrained: true },
    );
    if (ok) close();
  };
  applyOpen = apply;
  useEffect(() => () => {
    applyOpen = null;
  }, []);

  return (
    <FloatingPanel id="shape-dimensions" anchor={dims.anchor} title={dims.title} className="tool-window" onClose={close} closeLabel="Close (Esc)">
      <div className="floating-body">
        <div className="form">
          {dims.fields.map((f, i) => (
            <label key={f.label} className="field tool-field">
              <span className="label">{f.label}</span>
              <span className="tool-input">
                <input
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={values[i]}
                  aria-label={f.label}
                  aria-invalid={errors[i] !== null}
                  inputMode="decimal"
                  enterKeyHint="done"
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={(e) => {
                    if (!programmatic.current) e.currentTarget.select();
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((all) => all.map((x, j) => (j === i ? v : x)));
                    setEdited((all) => all.map((x, j) => x || j === i));
                    setErrors((all) => all.map((x, j) => (j === i ? null : x)));
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      apply();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      close();
                    }
                  }}
                />
                <span className="unit">{f.unit}</span>
              </span>
              {errors[i] && <span className="field-error">{errors[i]}</span>}
            </label>
          ))}
        </div>
        <div className="form-actions" style={{ alignItems: "center" }}>
          <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
            Typed values become dimensions.
          </span>
          <button className="btn accent" onClick={apply}>
            OK
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
