import { listComponents, listInstances } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { type ExportFormat, appState } from "../app/appState";
import { documentStore } from "../app/session";
import { printChoices } from "../print/bodies";
import { exportPrintFile, nothingToPrint, refusedBodies } from "../print/exportPrint";
import { type PrintWorkspaceSettings, readPrintSettings } from "../print/settingsModel";
import { printJobFor, updatePrintSettings } from "../print/usePrintJob";
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

const FORMATS: Record<"model" | "print", { id: ExportFormat; label: string }[]> = {
  model: [
    { id: "step", label: "STEP" },
    { id: "stl", label: "STL" },
  ],
  print: [
    { id: "3mf", label: "3MF" },
    { id: "print-stl", label: "STL" },
  ],
};

/** Print settings with the bodies and copies of an export choice. */
function withChoice(settings: PrintWorkspaceSettings, choice: ExportChoice): PrintWorkspaceSettings {
  return {
    ...settings,
    bodyIds: choice.bodyIds,
    copies: Object.fromEntries(
      Object.entries(choice.placement).map(([id, p]) => [id, p === "origin" ? ("once" as const) : ("instances" as const)]),
    ),
  };
}

const familyOf = (f: ExportFormat): "model" | "print" => (f === "3mf" || f === "print-stl" ? "print" : "model");

/**
 * Export of the 3D model (STEP / STL) or of the 3D Print job (3MF / STL, the parts laid out on
 * the bed): which bodies and components go into the file, and how the bodies of a component are
 * written. For the model: at each instance, or once where the definition lies. For printing: one
 * copy per instance, or one. The print choice is the one of the 3D Print workspace: what is
 * chosen here is saved there, and the file is the job that workspace shows.
 */
export function ExportModelPanel(): ReactElement | null {
  const request = useStore(appState, (s) => s.exportModel);
  const doc = useDocument();
  const computed = useStore(modelState, (s) => s.bodies);
  const computedIds = useMemo(() => new Set(Object.keys(computed)), [computed]);
  const [format, setFormat] = useState<ExportFormat>("step");
  const [choice, setChoice] = useState<ExportChoice>({ bodyIds: [], placement: {} });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    setFormat(request.format);
    if (familyOf(request.format) === "print") {
      const settings = readPrintSettings(doc);
      const choices = printChoices(doc, settings, computedIds);
      setChoice({
        bodyIds: choices.filter((c) => c.included).map((c) => c.id),
        placement: Object.fromEntries(
          listComponents(doc).map((c) => [c.id, settings.copies[c.id] === "once" ? "origin" : "instances"]),
        ),
      });
    } else {
      setChoice(defaultExportChoice(doc, appState.get().selection, computedIds));
    }
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
  const family = familyOf(request.format);
  const printing = family === "print";
  const items = exportItems(doc, choice);
  // For printing, the job as it would be with this choice: what it refuses is said before.
  const printSettings = printing ? withChoice(readPrintSettings(doc), choice) : null;
  const preview = printSettings
    ? printJobFor(doc, printSettings, printChoices(doc, printSettings, computedIds), computed)
    : null;
  const refused = printing ? refusedBodies(preview) : [];
  const refusedIds = new Set(refused.map((r) => r.bodyId));
  const blocked = printing ? nothingToPrint(preview, choice.bodyIds.length) : null;
  const placed = preview?.parts.filter((p) => p.placed).length ?? 0;

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
    if (printing) {
      // Saved as the choice of the 3D Print workspace, then the job it shows is written.
      const next = withChoice(readPrintSettings(doc), choice);
      updatePrintSettings({ bodyIds: next.bodyIds, copies: next.copies }, "Choose bodies to print");
      const after = documentStore.document;
      const settings = readPrintSettings(after);
      setBusy(true);
      await exportPrintFile(
        format === "3mf" ? "3mf" : "stl",
        after,
        settings,
        printChoices(after, settings, computedIds),
        computed,
        choice.bodyIds.length,
      );
      setBusy(false);
      close();
      return;
    }
    setBusy(true);
    const ok = await exportModel(format === "step" ? "step" : "stl", items);
    setBusy(false);
    if (ok) close();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-model" role="dialog" aria-label={printing ? "Export for 3D printing" : "Export 3D model"} style={{ width: 480 }}>
        <div className="modal-title">
          <span>{printing ? "Export for 3D Printing" : "Export 3D Model"}</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="segmented" role="radiogroup" aria-label="Format" style={{ marginBottom: 10 }}>
            {FORMATS[family].map((f) => (
              <button key={f.id} role="radio" aria-checked={format === f.id} className={format === f.id ? "on" : ""} onClick={() => setFormat(f.id)}>
                {f.label}
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
                        {printing
                          ? `×${instances.length} (one per instance)`
                          : `At its ${instances.length} ${instances.length === 1 ? "instance" : "instances"}`}
                      </option>
                      <option value="origin">{printing ? "×1" : "Once, at the origin"}</option>
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
                    {refusedIds.has(b.id) && chosen.has(b.id) && (
                      <span className="export-refused" title={refused.find((r) => r.bodyId === b.id)?.message}>
                        <Icon name="warning" size={13} /> cannot be printed
                      </span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
          {refused.some((r) => chosen.has(r.bodyId)) && (
            <div className="export-problems" role="alert">
              {refused
                .filter((r) => chosen.has(r.bodyId))
                .map((r) => (
                  <p key={r.bodyId}>{r.message}</p>
                ))}
              <p className="field-hint">
                These bodies are left out. Export → 3D model → STL… writes them without this check,
                for a slicer that repairs meshes.
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="field-hint" style={{ marginRight: "auto" }}>
            {printing && blocked && refused.length === 0
              ? blocked
              : printing
              ? `${placed} ${placed === 1 ? "part" : "parts"}, laid out on the bed`
              : `${items.length} ${items.length === 1 ? "solid" : "solids"}${format === "stl" && items.length > 1 ? " in one STL file" : ""}`}
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={items.length === 0 || busy || blocked !== null}
            title={blocked ?? undefined}
            onClick={() => void run()}
          >
            {busy ? "Exporting…" : `Export ${FORMATS[family].find((f) => f.id === format)?.label ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
