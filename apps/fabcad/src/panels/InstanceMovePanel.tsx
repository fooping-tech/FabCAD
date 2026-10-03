import { anglesFromQuaternion, quaternionFromAngles } from "@fabcad/assembly";
import { evaluateAs } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useState } from "react";
import { appState } from "../app/appState";
import { cancelInstanceMove, commitInstanceMove, previewInstanceMove } from "../app/components";
import { currentScope, documentStore } from "../app/session";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

const FIELDS = [
  { id: "x", label: "X", kind: "length" },
  { id: "y", label: "Y", kind: "length" },
  { id: "z", label: "Z", kind: "length" },
  { id: "rx", label: "Rotate X", kind: "angle" },
  { id: "ry", label: "Rotate Y", kind: "angle" },
  { id: "rz", label: "Rotate Z", kind: "angle" },
] as const;

type FieldId = (typeof FIELDS)[number]["id"];

const round = (v: number): string => String(Math.round(v * 1000) / 1000 + 0);

/** The values of the window for the instance as it is placed now. */
function valuesOf(instanceId: string): Record<FieldId, string> | null {
  const i = documentStore.document.assembly.instances[instanceId];
  if (!i) return null;
  const [rx, ry, rz] = anglesFromQuaternion(i.transform.rotation);
  const [x, y, z] = i.transform.position;
  return { x: round(x), y: round(y), z: round(z), rx: round(rx), ry: round(ry), rz: round(rz) };
}

/**
 * Move / Rotate of a component instance: where its origin goes (X, Y, Z in mm) and how it is
 * turned (about the world X, then Y, then Z axis, in degrees). The instance follows as values
 * are typed; OK keeps the placement as one step.
 */
export function InstanceMovePanel(): ReactElement | null {
  const move = useStore(appState, (s) => s.instanceMove);
  const [values, setValues] = useState<Record<FieldId, string> | null>(null);

  useEffect(() => {
    setValues(move ? valuesOf(move.instanceId) : null);
  }, [move?.instanceId]);

  if (!move || !values) return null;
  const instance = documentStore.document.assembly.instances[move.instanceId];
  if (!instance) return null;

  const evaluate = (next: Record<FieldId, string>): { numbers: Record<FieldId, number> } | { problem: string } => {
    const numbers = {} as Record<FieldId, number>;
    for (const f of FIELDS) {
      try {
        numbers[f.id] = evaluateAs(next[f.id], f.kind, currentScope());
      } catch (err) {
        return { problem: `${f.label}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { numbers };
  };
  const result = evaluate(values);

  const change = (id: FieldId, text: string): void => {
    const next = { ...values, [id]: text };
    setValues(next);
    const r = evaluate(next);
    if ("numbers" in r) {
      const n = r.numbers;
      previewInstanceMove({ position: [n.x, n.y, n.z], rotation: quaternionFromAngles(n.rx, n.ry, n.rz) });
    }
  };

  return (
    <FloatingPanel
      id="instance-move"
      anchor={move.anchor}
      title={`Move / Rotate ${instance.name}`}
      className="tool-window"
      onClose={cancelInstanceMove}
      closeLabel="Cancel (Esc)"
    >
      <div className="floating-body">
        <div className="form">
          {FIELDS.map((f) => (
            <label key={f.id} className="field tool-field">
              <span className="label">{f.label}</span>
              <span className="tool-input">
                <input
                  value={values[f.id]}
                  aria-label={f.label}
                  inputMode="decimal"
                  enterKeyHint="done"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => change(f.id, e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && "numbers" in result) {
                      e.preventDefault();
                      commitInstanceMove();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelInstanceMove();
                    }
                  }}
                />
                <span className="unit">{f.kind === "length" ? "mm" : "deg"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="form-actions" style={{ alignItems: "center" }}>
          {"problem" in result && (
            <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
              {result.problem}
            </span>
          )}
          <button className="btn" onClick={cancelInstanceMove}>
            Cancel
          </button>
          <button className="btn accent" disabled={"problem" in result} onClick={commitInstanceMove}>
            OK
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
