import { type Orientation, PRINT_MATERIALS } from "@fabcad/fabrication-print";
import { listInstances } from "@fabcad/cad-document";
import { Fragment, type ReactElement } from "react";
import { Icon } from "../ui/Icon";
import { documentStore } from "../app/session";
import { CheckField, NumberField, Section, SegmentedField } from "../fabrication/fields";
import "../fabrication/fabrication.css";
import { exportPrintJob } from "./exportPrint";
import { printUiState, selectPrintPart } from "./uiState";
import { type PrintState, updatePrintSettings } from "./usePrintJob";
import { useStore } from "../app/tinyStore";

const ORIENTATIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto (least overhang)" },
  { value: "-z", label: "As designed (−Z down)" },
  { value: "+z", label: "Upside down (+Z down)" },
  { value: "-x", label: "−X down" },
  { value: "+x", label: "+X down" },
  { value: "-y", label: "−Y down" },
  { value: "+y", label: "+Y down" },
];

const fmt = (v: number, digits = 1): string => {
  const s = v.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

export function PrintSidePanel({ state }: { state: PrintState }): ReactElement {
  const { settings, bodies, job, stale } = state;
  const selected = useStore(printUiState, (s) => s.selectedBodyId);
  const material = PRINT_MATERIALS.find((m) => m.id === settings.materialId) ?? PRINT_MATERIALS[0]!;
  const included = bodies.filter((b) => b.included);

  const toggleBody = (id: string, on: boolean): void => {
    const current = new Set(bodies.filter((b) => b.included).map((b) => b.id));
    if (on) current.add(id);
    else current.delete(id);
    updatePrintSettings({ bodyIds: [...current] }, "Choose bodies to print");
  };

  const setOrientation = (id: string, value: string): void => {
    const orientations = { ...settings.orientations };
    if (value === "auto") delete orientations[id];
    else orientations[id] = value as Orientation;
    updatePrintSettings({ orientations }, "Change print orientation");
  };

  const orientationValue = (id: string): string => {
    const o = settings.orientations[id];
    return typeof o === "string" ? o : o ? "custom" : "auto";
  };

  return (
    <div className="fab-side">
      <Section title="Bodies" badge={<span className="badge">{included.length} / {bodies.length}</span>}>
        {bodies.length === 0 ? (
          <p className="empty">Design a body in the DESIGN workspace first.</p>
        ) : (
          bodies.map((b, index) => {
            const part = job?.parts.find((p) => p.bodyId === b.id);
            const doc = documentStore.document;
            const component =
              b.componentId !== doc.assembly.rootComponentId ? doc.assembly.components[b.componentId] : undefined;
            const firstOfComponent = component && bodies[index - 1]?.componentId !== b.componentId;
            const instances = component ? listInstances(doc, component.id).filter((i) => i.visible).length : 0;
            return (
              <Fragment key={b.id}>
                {firstOfComponent && (
                  <div className="print-component">
                    <Icon name="component" size={13} />
                    <span className="print-component-name">{component.name}</span>
                    <select
                      aria-label={`Copies of ${component.name}`}
                      value={settings.copies[component.id] ?? "instances"}
                      onChange={(e) =>
                        updatePrintSettings(
                          { copies: { ...settings.copies, [component.id]: e.target.value as "instances" | "once" } },
                          "Change print copies",
                        )
                      }
                    >
                      <option value="instances">×{instances} (one per instance)</option>
                      <option value="once">×1</option>
                    </select>
                  </div>
                )}
                <div
                  className={`print-body${selected === b.id ? " selected" : ""}`}
                  onClick={() => selectPrintPart(b.id)}
                >
                  <CheckField
                    label={`${b.visible ? b.name : `${b.name} (hidden)`}${b.copies !== 1 ? ` ×${b.copies}` : ""}`}
                    checked={b.included}
                    onChange={(on) => toggleBody(b.id, on)}
                  />
                  {b.included && (
                    <div className="field">
                      <label htmlFor={`orient-${b.id}`}>Lay down</label>
                      <select
                        id={`orient-${b.id}`}
                        value={orientationValue(b.id)}
                        onChange={(e) => setOrientation(b.id, e.target.value)}
                      >
                        {ORIENTATIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                        {orientationValue(b.id) === "custom" && <option value="custom">Custom</option>}
                      </select>
                    </div>
                  )}
                  {part && (
                    <div className="field-hint" style={{ gridColumn: "1 / -1", marginTop: 2 }}>
                      {fmt(part.size.x)} × {fmt(part.size.y)} × {fmt(part.size.z)} mm ·{" "}
                      {fmt(part.estimate.mass)} g
                      {part.overhangArea > 1 ? ` · overhang ${fmt(part.overhangArea, 0)} mm²` : ""}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })
        )}
      </Section>

      <Section title="Material" badge={<span className="badge">{material.density} g/cm³</span>}>
        <div className="form">
          <div className="field">
            <label htmlFor="print-material">Filament</label>
            <select
              id="print-material"
              value={settings.materialId}
              onChange={(e) => updatePrintSettings({ materialId: e.target.value }, "Change filament")}
            >
              {PRINT_MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section
        title="Printer"
        badge={
          <span className="badge">
            {settings.printer.bed.width} × {settings.printer.bed.depth} × {settings.printer.bed.height}
          </span>
        }
      >
        <div className="form">
          <NumberField
            label="Bed width"
            unit="mm"
            value={settings.printer.bed.width}
            rule={{ min: 10, max: 2000 }}
            onCommit={(v) =>
              v !== undefined &&
              updatePrintSettings({
                printer: { ...settings.printer, bed: { ...settings.printer.bed, width: v } },
              })
            }
          />
          <NumberField
            label="Bed depth"
            unit="mm"
            value={settings.printer.bed.depth}
            rule={{ min: 10, max: 2000 }}
            onCommit={(v) =>
              v !== undefined &&
              updatePrintSettings({
                printer: { ...settings.printer, bed: { ...settings.printer.bed, depth: v } },
              })
            }
          />
          <NumberField
            label="Height"
            unit="mm"
            value={settings.printer.bed.height}
            rule={{ min: 10, max: 2000 }}
            onCommit={(v) =>
              v !== undefined &&
              updatePrintSettings({
                printer: { ...settings.printer, bed: { ...settings.printer.bed, height: v } },
              })
            }
          />
          <NumberField
            label="Nozzle"
            unit="mm"
            value={settings.printer.nozzle}
            rule={{ min: 0.1, max: 2 }}
            onCommit={(v) =>
              v !== undefined && updatePrintSettings({ printer: { ...settings.printer, nozzle: v } })
            }
          />
          <NumberField
            label="Layer height"
            unit="mm"
            value={settings.printer.layerHeight}
            rule={{ min: 0.02, max: 1.5 }}
            onCommit={(v) =>
              v !== undefined &&
              updatePrintSettings({ printer: { ...settings.printer, layerHeight: v } })
            }
          />
        </div>
      </Section>

      <Section title="Print">
        <div className="form">
          <NumberField
            label="Infill"
            unit="%"
            value={settings.infill}
            rule={{ min: 0, max: 100 }}
            onCommit={(v) => v !== undefined && updatePrintSettings({ infill: v })}
          />
          <NumberField
            label="Walls"
            value={settings.walls}
            rule={{ min: 1, max: 20 }}
            hint="Number of perimeters"
            onCommit={(v) => v !== undefined && updatePrintSettings({ walls: Math.round(v) })}
          />
          <NumberField
            label="Top / bottom"
            value={settings.topBottomLayers}
            rule={{ min: 0, max: 50 }}
            hint="Solid layers"
            onCommit={(v) =>
              v !== undefined && updatePrintSettings({ topBottomLayers: Math.round(v) })
            }
          />
          <NumberField
            label="Overhang"
            unit="°"
            value={settings.overhangAngle}
            rule={{ min: 0, max: 89 }}
            hint="Steepest printable lean from vertical"
            onCommit={(v) => v !== undefined && updatePrintSettings({ overhangAngle: v })}
          />
          <NumberField
            label="Part gap"
            unit="mm"
            value={settings.gap}
            rule={{ min: 0, max: 100 }}
            onCommit={(v) => v !== undefined && updatePrintSettings({ gap: v })}
          />
        </div>
      </Section>

      <Section
        title="Estimate"
        badge={
          job && job.warnings.length > 0 ? (
            <span className="badge warn">
              {job.warnings.length} {job.warnings.length === 1 ? "warning" : "warnings"}
            </span>
          ) : undefined
        }
      >
        {job ? (
          <>
            <dl className="kv">
              <dt>Parts</dt>
              <dd>{job.parts.length}</dd>
              <dt>Filament</dt>
              <dd>
                {fmt(job.total.mass)} g · {fmt(job.total.filament, 2)} m
              </dd>
              <dt>Plastic</dt>
              <dd>{fmt(job.total.plastic / 1000, 2)} cm³</dd>
              <dt>Solid volume</dt>
              <dd>{fmt(job.total.volume / 1000, 2)} cm³</dd>
              <dt>Layers</dt>
              <dd>{job.total.layers}</dd>
            </dl>
            <p className="field-hint" style={{ marginTop: 6 }}>
              An estimate from volume and surface area. The slicer has the final word.
            </p>
            {job.warnings.length > 0 && (
              <div className="warning-list" style={{ marginTop: 8 }}>
                {job.warnings.map((w, i) => (
                  <button
                    key={i}
                    className={`warning-item ${w.severity}`}
                    onClick={() => w.partId && selectPrintPart(w.partId)}
                  >
                    {w.message}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty">Nothing to print yet.</p>
        )}
      </Section>

      <Section title="Export">
        <div className="form">
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn accent"
              style={{ flex: 1 }}
              disabled={!job || stale}
              onClick={() => exportPrintJob("3mf", job, documentStore.document.name)}
            >
              Export 3MF
            </button>
            <button
              className="btn"
              style={{ flex: 1 }}
              disabled={!job || stale}
              onClick={() => exportPrintJob("stl", job, documentStore.document.name)}
            >
              Export STL
            </button>
          </div>
          <p className="field-hint">
            Parts are exported as they lie on the bed, in mm. Open the file in your slicer to
            make G-code. 3MF keeps the unit and the part names; STL has neither.
          </p>
        </div>
      </Section>
    </div>
  );
}

export { SegmentedField };
