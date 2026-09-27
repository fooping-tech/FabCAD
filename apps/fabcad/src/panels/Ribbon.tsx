import { SKETCH_MODIFY_TOOLS, type Sketch, toggleConstruction } from "@fabcad/sketch";
import type { ReactElement } from "react";
import {
  beginSketchPlanePick,
  finishSketch,
  importStep,
  openDialog,
  setTool,
  startMeasure,
} from "../app/actions";
import { type SelectionFilter, type ToolOptions, appState, setSelection, toast } from "../app/appState";
import { documentStore, editSketchSolved } from "../app/session";
import { useStore } from "../app/tinyStore";
import { CONSTRAINT_TOOLS, constraintRefs } from "../sketch/constraintTools";
import { CREATE_TOOLS } from "../sketch/createTools";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { editSketch } from "@fabcad/sketch";

function Tool({
  icon,
  label,
  title,
  active,
  disabled,
  onClick,
  wide,
  className = "",
}: {
  icon: string;
  label?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  wide?: boolean;
  className?: string;
}): ReactElement {
  return (
    <button
      className={`tool${active ? " on" : ""}${wide ? " wide" : ""} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {label && <span>{label}</span>}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div className="ribbon-group">
      <div className="ribbon-tools">{children}</div>
      <div className="ribbon-label">{label}</div>
    </div>
  );
}

function NumberOption({
  label,
  value,
  min,
  step = 1,
  unit,
  onChange,
}: {
  unit?: string;
  label: string;
  value: number;
  min: number;
  step?: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {unit}
    </label>
  );
}

/** Tools shown directly in the sketch ribbon; the rest live in the "More" menus. */
const PRIMARY_CREATE = ["line", "rectangle-2point", "circle", "arc-3point", "polygon-inscribed", "slot", "spline-fit"];
const PRIMARY_MODIFY = ["trim", "extend", "offset", "mirror", "move", "copy", "fillet"];

function applyConstraintToSelection(type: (typeof CONSTRAINT_TOOLS)[number]["type"]): void {
  const { selection, activeSketchId } = appState.get();
  if (!activeSketchId) return;
  const f = documentStore.document.features[activeSketchId];
  if (!f || f.type !== "sketch") return;
  const picked = selection.flatMap((s) => {
    if (s.kind !== "entity" || s.sketchId !== activeSketchId) return [];
    const e = f.sketch.entities[s.entityId];
    return e ? [e] : [];
  });
  const def = CONSTRAINT_TOOLS.find((c) => c.type === type)!;
  const state = picked.length > 0 ? constraintRefs(type, picked) : { state: "incomplete" as const };
  if (state.state !== "ready") {
    // Nothing usable selected: switch to the pick-driven command.
    setSelection([]);
    setTool(`constraint:${type}`);
    return;
  }
  const refs = state.refs;
  const ok = editSketchSolved(
    activeSketchId,
    def.label,
    (sketch: Sketch) => {
      const existing = Object.values(sketch.constraints).find(
        (c) => c.type === type && c.refs.length === refs.length && c.refs.every((r) => refs.includes(r)),
      );
      if (existing) {
        return type === "fix" ? editSketch(sketch, (b) => b.removeConstraint(existing.id)) : sketch;
      }
      return editSketch(sketch, (b) => {
        b.constrain(type, ...refs);
      });
    },
    { rejectOverConstrained: true },
  );
  if (ok) setSelection([]);
}

function SketchRibbon(): ReactElement {
  const tool = useStore(appState, (s) => s.tool);
  const options = useStore(appState, (s) => s.toolOptions);
  const showConstraints = useStore(appState, (s) => s.showConstraints);
  const measuring = useStore(appState, (s) => s.measuring);
  const showDimensions = useStore(appState, (s) => s.showDimensions);
  const setOptions = (patch: Partial<ToolOptions>): void =>
    appState.set((s) => ({ toolOptions: { ...s.toolOptions, ...patch } }));

  const primary = CREATE_TOOLS.filter((t) => PRIMARY_CREATE.includes(t.id)).sort(
    (a, b) => PRIMARY_CREATE.indexOf(a.id) - PRIMARY_CREATE.indexOf(b.id),
  );
  const moreCreate = CREATE_TOOLS.filter((t) => !PRIMARY_CREATE.includes(t.id));
  const modifyPrimary = SKETCH_MODIFY_TOOLS.filter((t) => PRIMARY_MODIFY.includes(t.id)).sort(
    (a, b) => PRIMARY_MODIFY.indexOf(a.id) - PRIMARY_MODIFY.indexOf(b.id),
  );
  const modifyMore = SKETCH_MODIFY_TOOLS.filter(
    (t) => !PRIMARY_MODIFY.includes(t.id) && t.id !== "toggle-construction",
  );

  const toggleSelectedConstruction = (): void => {
    const { selection, activeSketchId } = appState.get();
    if (!activeSketchId) return;
    const ids = selection.flatMap((s) =>
      s.kind === "entity" && s.sketchId === activeSketchId ? [s.entityId] : [],
    );
    if (ids.length === 0) {
      setOptions({ construction: !options.construction });
      return;
    }
    editSketchSolved(activeSketchId, "Normal / Construction", (s) => toggleConstruction(s, ids));
  };

  const activeMoreCreate = moreCreate.find((t) => t.id === tool);
  const activeMoreModify = modifyMore.find((t) => t.id === tool);

  return (
    <>
      <Group label="Select">
        <Tool icon="select" title="Select (Esc)" active={tool === "select"} onClick={() => setTool("select")} />
      </Group>
      <Group label="Create">
        {primary.map((t) => (
          <Tool
            key={t.id}
            icon={t.id}
            title={`${t.label} — ${t.description}`}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
        <Tool
          icon="project"
          title="Project (P) — project edges, faces or vertices of a body onto the sketch"
          active={tool === "project"}
          onClick={() => setTool("project")}
        />
        <Menu
          buttonClass={`tool${activeMoreCreate ? " on" : ""}`}
          title="More create tools"
          label={
            <>
              <Icon name={activeMoreCreate?.id ?? "more"} />
            </>
          }
          items={moreCreate.map((t) => ({
            label: t.label,
            icon: t.id,
            active: tool === t.id,
            onSelect: () => setTool(t.id),
          }))}
        />
      </Group>
      <Group label="Modify">
        {modifyPrimary.map((t) => (
          <Tool
            key={t.id}
            icon={t.id}
            title={`${t.label} — ${t.description}`}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
        <Menu
          buttonClass={`tool${activeMoreModify ? " on" : ""}`}
          title="More modify tools"
          label={<Icon name={activeMoreModify?.id ?? "more"} />}
          items={modifyMore.map((t) => ({
            label: t.label,
            icon: t.id,
            active: tool === t.id,
            onSelect: () => setTool(t.id),
          }))}
        />
      </Group>
      <Group label="Constraints">
        {CONSTRAINT_TOOLS.map((c) => (
          <Tool
            key={c.type}
            icon={`c-${c.type}`}
            title={`${c.label} — ${c.hint}`}
            active={tool === `constraint:${c.type}`}
            onClick={() => applyConstraintToSelection(c.type)}
          />
        ))}
      </Group>
      <Group label="Dimension">
        <Tool
          icon="dimension"
          title="Sketch Dimension (D) — pick geometry, then place the dimension"
          active={tool === "dimension"}
          onClick={() => setTool("dimension")}
        />
        <Tool icon="measure" title="Measure (I)" active={measuring} onClick={startMeasure} />
      </Group>
      <Group label="Options">
        <div className="ribbon-options">
          <Tool
            icon="toggle-construction"
            title="Construction (X) — toggle the selection, or draw new geometry as construction"
            active={options.construction}
            onClick={toggleSelectedConstruction}
          />
          {(tool === "polygon-inscribed" || tool === "polygon-circumscribed") && (
            <NumberOption label="Sides" value={options.polygonSides} min={3} onChange={(v) => setOptions({ polygonSides: Math.round(v) })} />
          )}
          {tool === "fillet" && (
            <NumberOption unit="mm" label="Radius" value={options.filletRadius} min={0.01} step={0.5} onChange={(v) => setOptions({ filletRadius: v })} />
          )}
          {tool === "chamfer" && (
            <NumberOption unit="mm" label="Distance" value={options.chamferDistance} min={0.01} step={0.5} onChange={(v) => setOptions({ chamferDistance: v })} />
          )}
          {tool === "offset" && (
            <NumberOption unit="mm" label="Distance" value={options.offsetDistance} min={0.01} step={0.5} onChange={(v) => setOptions({ offsetDistance: v })} />
          )}
          {tool === "scale" && (
            <NumberOption label="Factor" value={options.scaleFactor} min={0.001} step={0.1} onChange={(v) => setOptions({ scaleFactor: v })} />
          )}
          {(tool === "rectangular-pattern" || tool === "circular-pattern") && (
            <NumberOption label="Count" value={options.patternCount} min={2} onChange={(v) => setOptions({ patternCount: Math.round(v) })} />
          )}
          {tool === "rectangular-pattern" && (
            <NumberOption label="Rows" value={options.patternCountY} min={1} onChange={(v) => setOptions({ patternCountY: Math.round(v) })} />
          )}
          {tool === "mirror" && (
            <label>
              <input
                type="checkbox"
                checked={options.mirrorSymmetry}
                onChange={(e) => setOptions({ mirrorSymmetry: e.target.checked })}
              />
              Symmetry constraints
            </label>
          )}
          <label title="Snap free positions to whole millimetres (hold Ctrl / Cmd to switch off)">
            <input
              type="checkbox"
              checked={options.gridSnap}
              onChange={(e) => setOptions({ gridSnap: e.target.checked })}
            />
            Snap 1 mm
          </label>
          <label title="Show constraint glyphs">
            <input
              type="checkbox"
              checked={showConstraints}
              onChange={(e) => appState.set({ showConstraints: e.target.checked })}
            />
            Constraints
          </label>
          <label title="Show dimensions">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={(e) => appState.set({ showDimensions: e.target.checked })}
            />
            Dimensions
          </label>
        </div>
      </Group>
      <Group label="Sketch">
        <Tool icon="finish" label="Finish Sketch" title="Finish Sketch" wide className="finish" onClick={finishSketch} />
      </Group>
    </>
  );
}

const FILTERS: { id: SelectionFilter; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "body", label: "Body" },
  { id: "face", label: "Face" },
  { id: "edge", label: "Edge" },
  { id: "vertex", label: "Vertex" },
];

function SolidRibbon(): ReactElement {
  const dialog = useStore(appState, (s) => s.dialog);
  const filter = useStore(appState, (s) => s.selectionFilter);
  const measuring = useStore(appState, (s) => s.measuring);
  const is = (type: string): boolean => dialog?.type === type;
  return (
    <>
      <Group label="Sketch">
        <Tool
          icon="new-sketch"
          label="Create Sketch"
          title="Create Sketch — pick a plane or planar face"
          wide
          active={is("pick-sketch-plane")}
          onClick={() => beginSketchPlanePick(null)}
        />
      </Group>
      <Group label="Create">
        <Tool icon="extrude" label="Extrude" title="Extrude (E)" active={is("extrude")} onClick={() => openDialog("extrude")} />
        <Tool icon="revolve" label="Revolve" title="Revolve" active={is("revolve")} onClick={() => openDialog("revolve")} />
      </Group>
      <Group label="Modify">
        <Tool icon="fillet-3d" label="Fillet" title="Fillet edges (F)" active={is("fillet")} onClick={() => openDialog("fillet")} />
        <Tool icon="chamfer-3d" label="Chamfer" title="Chamfer edges" active={is("chamfer")} onClick={() => openDialog("chamfer")} />
        <Tool icon="shell" label="Shell" title="Shell — hollow a body" active={is("shell")} onClick={() => openDialog("shell")} />
        <Tool icon="combine" label="Combine" title="Combine — union, cut or intersect bodies" active={is("combine")} onClick={() => openDialog("combine")} />
      </Group>
      <Group label="Insert">
        <Tool icon="import3d" label="STEP" title="Import a STEP file" onClick={() => void importStep()} />
      </Group>
      <Group label="Inspect">
        <Tool icon="measure" label="Measure" title="Measure (I)" active={measuring} onClick={startMeasure} />
      </Group>
      <Group label="Manage">
        <Tool icon="parameters" label="Parameters" title="Change parameters" active={is("parameters")} onClick={() => openDialog("parameters")} />
      </Group>
      <Group label="Selection filter">
        <div className="ribbon-options">
          <div className="segmented" role="radiogroup" aria-label="Selection filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                className={filter === f.id ? "on" : ""}
                onClick={() => appState.set({ selectionFilter: f.id, hover: null })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Group>
    </>
  );
}

function FabricationRibbon(): ReactElement {
  const process = useStore(appState, (s) => s.fabricationProcess);
  return (
    <>
      <Group label="Process">
        <Tool
          icon="laser"
          label="Laser"
          title="Laser cutting: flat parts from sheet material"
          wide
          active={process === "laser"}
          onClick={() => appState.set({ fabricationProcess: "laser" })}
        />
        <Tool
          icon="print3d"
          label="3D Print"
          title="3D printing: orientation, checks and mesh export for a slicer"
          wide
          active={process === "print"}
          onClick={() => appState.set({ fabricationProcess: "print" })}
        />
      </Group>
      <Group label="Coming later">
        <Tool icon="body" label="CNC" title="CNC — planned" disabled onClick={() => toast("CNC is planned.")} />
        <Tool icon="body" label="Sheet Metal" title="Sheet metal — planned" disabled onClick={() => undefined} />
      </Group>
    </>
  );
}

export function Ribbon(): ReactElement {
  const workspace = useStore(appState, (s) => s.workspace);
  const sketching = useStore(appState, (s) => s.activeSketchId !== null);
  return (
    <div className="ribbon" role="toolbar" aria-label="Tools">
      {workspace === "fabrication" ? <FabricationRibbon /> : sketching ? <SketchRibbon /> : <SolidRibbon />}
    </div>
  );
}
