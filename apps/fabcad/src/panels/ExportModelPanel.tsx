import { listComponents, listInstances } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { appState } from "../app/appState";
import {
  type ExportChoice,
  defaultExportChoice,
  exportItems,
  exportableBodies,
} from "../app/exportModel";
import { exportModel, modelState, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

const close = (): void => appState.set({ exportModel: null });

/** A checkbox that also shows "some of them". */
function TriCheck({
  checked,
  some,
  label,
  onChange,
}: {
  checked: boolean;
  some: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !checked;
  }, [some, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/**
 * Export → STEP… / STL…: which bodies and components go into the file, and whether the bodies
 * of a component are written at each of its instances or once, where the definition lies.
 */
export function ExportModelPanel(): ReactElement | null {
  const request = useStore(appState, (s) => s.exportModel);
  const doc = useDocument();
  const computed = useStore(modelState, (s) => s.bodies);
  const computedIds = useMemo(() => new Set(Object.keys(computed)), [computed]);
  const [format, setFormat] = useState<"step" | "stl">("step");
  const [choice, setChoice] = useState<ExportChoice>({ bodyIds: [], placement: {} });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    setFormat(request.format);
    setChoice(defaultExportChoice(doc, appState.get().selection, computedIds));
    // Only when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) return null;
  const bodies = exportableBodies(doc, computedIds);
  const root = doc.assembly.rootComponentId;
  const chosen = new Set(choice.bodyIds);
  const groups = [
    { id: root, name: `${doc.name} (root)`, bodies: bodies.filter((b) => b.componentId === root) },
    ...listComponents(doc).map((c) => ({
      id: c.id,
      name: c.name,
      bodies: bodies.filter((b) => b.componentId === c.id),
    })),
  ].filter((g) => g.bodies.length > 0);
  const items = exportItems(doc, choice);

  const setBodies = (ids: string[], on: boolean): void =>
    setChoice((c) => {
      const next = new Set(c.bodyIds);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { ...c, bodyIds: [...next] };
    });

  const run = async (): Promise<void> => {
    setBusy(true);
    const ok = await exportModel(format, items);
    setBusy(false);
    if (ok) close();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-model" role="dialog" aria-label="Export 3D model" style={{ width: 480 }}>
        <div className="modal-title">
          <span>Export 3D Model</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="segmented" role="radiogroup" aria-label="Format" style={{ marginBottom: 10 }}>
            {(["step", "stl"] as const).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {groups.length === 0 && <p className="empty">There is no body to export.</p>}
          {groups.map((g) => {
            const ids = g.bodies.map((b) => b.id);
            const on = ids.filter((id) => chosen.has(id)).length;
            const instances = g.id === root ? [] : listInstances(doc, g.id).filter((i) => i.visible);
            return (
              <div key={g.id} className="export-group">
                <div className="export-row group">
                  <label className="export-label">
                    <TriCheck
                      label={g.name}
                      checked={on === ids.length}
                      some={on > 0}
                      onChange={(v) => setBodies(ids, v)}
                    />
                    <Icon name={g.id === root ? "document" : "component"} size={14} />
                    <span className="export-name">{g.name}</span>
                  </label>
                  {g.id !== root && (
                    <select
                      aria-label={`Placement of ${g.name}`}
                      value={choice.placement[g.id] ?? "instances"}
                      onChange={(e) =>
                        setChoice((c) => ({
                          ...c,
                          placement: { ...c.placement, [g.id]: e.target.value as "instances" | "origin" },
                        }))
                      }
                    >
                      <option value="instances">
                        At its {instances.length} {instances.length === 1 ? "instance" : "instances"}
                      </option>
                      <option value="origin">Once, at the origin</option>
                    </select>
                  )}
                </div>
                {g.bodies.map((b) => (
                  <label key={b.id} className="export-row body">
                    <input
                      type="checkbox"
                      aria-label={b.name}
                      checked={chosen.has(b.id)}
                      onChange={(e) => setBodies([b.id], e.target.checked)}
                    />
                    <Icon name="body" size={14} />
                    <span className={`export-name${b.visible ? "" : " dim"}`}>{b.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <span className="field-hint" style={{ marginRight: "auto" }}>
            {items.length} {items.length === 1 ? "solid" : "solids"}
            {format === "stl" && items.length > 1 ? " in one STL file" : ""}
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={items.length === 0 || busy} onClick={() => void run()}>
            {busy ? "Exporting…" : `Export ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
