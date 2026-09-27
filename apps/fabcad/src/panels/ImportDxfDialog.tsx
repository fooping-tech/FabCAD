import type { DxfDrawing } from "@fabcad/dxf";
import { type ReactElement, useMemo, useState } from "react";
import { closeDialog } from "../app/actions";
import { appState } from "../app/appState";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { importDxf, importPlane } from "../sketch/importDxf";
import { Icon } from "../ui/Icon";

const UNIT_NAMES = { mm: "millimetres", inch: "inches", cm: "centimetres", m: "metres" } as const;

export function ImportDxfDialog({
  fileName,
  drawing,
}: {
  fileName: string;
  drawing: DxfDrawing;
}): ReactElement {
  const doc = useDocument();
  const activeSketchId = useStore(appState, (s) => s.activeSketchId);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of drawing.entities) map.set(e.layer, (map.get(e.layer) ?? 0) + 1);
    return map;
  }, [drawing]);
  const layers = useMemo(
    () => drawing.layers.map((l) => l.name).filter((name) => (counts.get(name) ?? 0) > 0),
    [drawing, counts],
  );
  const [unit, setUnit] = useState<"mm" | "inch">(
    drawing.measurement === "imperial" ? "inch" : "mm",
  );
  const [picked, setPicked] = useState<Set<string>>(() => new Set(layers));
  const [construction, setConstruction] = useState<Set<string>>(() => new Set());

  const toggle = (set: Set<string>, name: string): Set<string> => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  };
  const skipped = Object.entries(drawing.skipped);
  const target = activeSketchId ? doc.features[activeSketchId]?.name : null;
  const total = layers.reduce((n, name) => n + (picked.has(name) ? (counts.get(name) ?? 0) : 0), 0);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal" role="dialog" aria-label="Import DXF" style={{ width: 460 }}>
        <div className="modal-title">
          <span>Import DXF — {fileName}</span>
          <button className="icon-btn" aria-label="Close" onClick={closeDialog}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="field">
            <label>Into</label>
            <span>{target ? `${target} (open sketch)` : `New sketch on ${importPlane()}`}</span>
          </div>
          <div className="field">
            <label htmlFor="dxf-unit">Units</label>
            {drawing.units === "unitless" ? (
              <select
                id="dxf-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value === "inch" ? "inch" : "mm")}
              >
                <option value="mm">mm</option>
                <option value="inch">inch (× 25.4)</option>
              </select>
            ) : (
              <span>{UNIT_NAMES[drawing.units]} (from the file), converted to mm</span>
            )}
            {drawing.units === "unitless" && (
              <span className="field-hint">The file does not say which unit it uses.</span>
            )}
          </div>
          <table className="dxf-layers">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Entities</th>
                <th>Import</th>
                <th>Construction</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{counts.get(name) ?? 0}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Import layer ${name}`}
                      checked={picked.has(name)}
                      onChange={() => setPicked(toggle(picked, name))}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Layer ${name} as construction geometry`}
                      checked={construction.has(name)}
                      disabled={!picked.has(name)}
                      onChange={() => setConstruction(toggle(construction, name))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {skipped.length > 0 && (
            <p className="field-hint" style={{ margin: 0 }}>
              Not imported: {skipped.map(([type, n]) => `${type} × ${n}`).join(", ")}.
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={total === 0}
            onClick={() =>
              importDxf(fileName, drawing, {
                unit,
                layers: [...picked],
                constructionLayers: [...construction],
              })
            }
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
