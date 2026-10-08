import { LegalLinks } from "../legal/LegalLinks";
import {
  type Parameter,
  type ParameterUnit,
  addParameter,
  buildDependencyGraph,
  formatQuantity,
  isValidParameterName,
  paramNode,
  removeParameter,
  renameParameter,
  updateParameter,
} from "@fabcad/cad-document";
import { type ReactElement, useState } from "react";
import { closeDialog } from "../app/actions";
import { toast } from "../app/appState";
import { parameterEvaluation, run, useDocument } from "../app/session";
import { Icon } from "../ui/Icon";

function CommitInput({
  value,
  label,
  invalid,
  mono,
  onCommit,
}: {
  value: string;
  label: string;
  invalid?: boolean;
  mono?: boolean;
  onCommit: (value: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <input
      value={shown}
      aria-label={label}
      className={invalid ? "invalid" : ""}
      style={mono ? { fontFamily: "var(--mono)", fontSize: 11.5 } : undefined}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          setTimeout(() => (e.target as HTMLInputElement).blur(), 0);
        }
      }}
    />
  );
}

export function ParametersDialog(): ReactElement {
  const doc = useDocument();
  const evaluation = parameterEvaluation(doc);
  const graph = buildDependencyGraph(doc);
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [unit, setUnit] = useState<ParameterUnit>("mm");

  const usage = (p: Parameter): number => graph.dependents.get(paramNode(p.name))?.size ?? 0;

  const add = (): void => {
    const n = name.trim();
    if (!isValidParameterName(n)) {
      toast(
        "Parameter names start with a letter and contain letters, digits and _. Units and function names are reserved.",
        "warning",
      );
      return;
    }
    if (doc.parameters.some((p) => p.name === n)) {
      toast(`A parameter named "${n}" already exists.`, "warning");
      return;
    }
    if (expression.trim() === "") {
      toast("Enter a value or expression.", "warning");
      return;
    }
    if (run(addParameter({ name: n, expression: expression.trim(), unit }))) {
      setName("");
      setExpression("");
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal" role="dialog" aria-label="Parameters">
        <div className="modal-title">
          <span>Parameters</span>
          <button className="icon-btn" aria-label="Close" onClick={closeDialog}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Name</th>
                <th style={{ width: "9%" }}>Unit</th>
                <th>Expression</th>
                <th style={{ width: "17%" }}>Value</th>
                <th style={{ width: "18%" }}>Comment</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {doc.parameters.map((p) => {
                const error = evaluation.errors[p.id];
                const value = evaluation.values[p.name];
                const used = usage(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <CommitInput
                        value={p.name}
                        label={`Name of ${p.name}`}
                        mono
                        onCommit={(v) => {
                          if (!run(renameParameter(p.id, v.trim()))) {
                            toast(`"${v}" cannot be used as a parameter name.`, "warning");
                          }
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={p.unit}
                        aria-label={`Unit of ${p.name}`}
                        onChange={(e) =>
                          run(updateParameter(p.id, { unit: e.target.value as ParameterUnit }))
                        }
                      >
                        <option value="mm">mm</option>
                        <option value="deg">deg</option>
                        <option value="">—</option>
                      </select>
                    </td>
                    <td>
                      <CommitInput
                        value={p.expression}
                        label={`Expression of ${p.name}`}
                        invalid={!!error}
                        mono
                        onCommit={(v) => run(updateParameter(p.id, { expression: v.trim() }))}
                      />
                    </td>
                    <td className="num" title={error}>
                      {error ? (
                        <span className="badge danger">{error}</span>
                      ) : value ? (
                        formatQuantity(value, 4)
                      ) : (
                        ""
                      )}
                    </td>
                    <td>
                      <CommitInput
                        value={p.comment ?? ""}
                        label={`Comment of ${p.name}`}
                        onCommit={(v) => run(updateParameter(p.id, { comment: v }))}
                      />
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        title={used > 0 ? `Used in ${used} place${used === 1 ? "" : "s"}` : "Delete"}
                        aria-label={`Delete ${p.name}`}
                        disabled={used > 0}
                        onClick={() => run(removeParameter(p.id))}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <input
                    value={name}
                    placeholder="name"
                    aria-label="New parameter name"
                    style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
                    spellCheck={false}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") add();
                    }}
                  />
                </td>
                <td>
                  <select
                    value={unit}
                    aria-label="New parameter unit"
                    onChange={(e) => setUnit(e.target.value as ParameterUnit)}
                  >
                    <option value="mm">mm</option>
                    <option value="deg">deg</option>
                    <option value="">—</option>
                  </select>
                </td>
                <td>
                  <input
                    value={expression}
                    placeholder="100, width * 0.6, material + 0.1 mm"
                    aria-label="New parameter expression"
                    style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}
                    spellCheck={false}
                    onChange={(e) => setExpression(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") add();
                    }}
                  />
                </td>
                <td colSpan={3}>
                  <button className="btn small accent" onClick={add}>
                    Add parameter
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="field-hint" style={{ marginTop: 10 }}>
            Use parameters in any dimension or feature value. Operators: + − × ÷ ^ and parentheses.
            Functions: sin, cos, tan, asin, acos, atan, atan2, sqrt, abs, min, max, floor, ceil,
            round, pow. Units: mm, cm, m, in, deg, rad. Angles are in degrees.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={closeDialog}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function AboutDialog(): ReactElement {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal" role="dialog" aria-label="About FabCAD" style={{ width: 460 }}>
        <div className="modal-title">
          <span>About FabCAD</span>
          <button className="icon-btn" aria-label="Close" onClick={closeDialog}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            FabCAD is a parametric 3D CAD that runs entirely in the browser, with a fabrication
            compiler that turns bodies into parts you can actually cut.
          </p>
          <p>
            Geometry kernel: OpenCASCADE through Replicad (LGPL-2.1). Rendering: Three.js.
            Projects are saved in this browser; export <code>.fabcad.json</code> files for backup.
            Share links contain the project data.
          </p>
          <p style={{ marginBottom: 0 }} className="field-hint">
            Version {__APP_VERSION__}
          </p>
          <LegalLinks />
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
