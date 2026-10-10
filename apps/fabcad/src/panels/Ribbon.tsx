import { SKETCH_MODIFY_TOOLS, nodeHandlePair, type NodeMode } from "@fabcad/sketch";
import type { ReactElement } from "react";
import {
  DIALOG_COMMANDS,
  beginSketchPlanePick,
  finishSketch,
  importStep,
  openDialog,
  setTool,
  startMeasure,
} from "../app/actions";
import {
  type Dialog,
  type SelectionFilter,
  type ToolOptions,
  appState,
  toast,
} from "../app/appState";
import { useStore } from "../app/tinyStore";
import { useDocument } from "../app/session";
import {
  activateComponent,
  newInstance,
  openNewComponent,
  useActiveComponentId,
} from "../app/components";
import { CONSTRAINT_TOOLS } from "../sketch/constraintTools";
import { CREATE_TOOLS } from "../sketch/createTools";
import { setSelectedNodeMode } from "../sketch/nodeModeCommands";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { applyConstraintToSelection, toggleSelectedConstruction } from "../app/sketchCommands";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";

/** Name and one-line description of a tool, from a tooltip such as "Line — two points". */
const topicOf = (help: string, title: string): { id: string; title: string; summary?: string } => {
  const [name = title, ...rest] = title.split(" — ");
  const summary = rest.join(" — ");
  return { id: help, title: name.replace(/\s*\([^)]*\)$/, ""), ...(summary ? { summary } : {}) };
};

function Tool({
  icon,
  label,
  title,
  active,
  disabled,
  onClick,
  wide,
  className = "",
  help,
}: {
  icon: string;
  label?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  wide?: boolean;
  className?: string;
  /** Help id (`help/content.ts`): right-click or long press shows what the tool does. */
  help?: string;
}): ReactElement {
  const trigger = useHelpTrigger(help ? topicOf(help, title) : null);
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return (
    <button
      className={`tool${active ? " on" : ""}${wide ? " wide" : ""} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      {...handlers}
      onClick={guard(onClick)}
    >
      <Icon name={icon} />
      {label && <span>{label}</span>}
    </button>
  );
}

/** Multi-selection mode: what Shift does, for where there is no keyboard. */
function MultiSelectTool(): ReactElement {
  const on = useStore(appState, (s) => s.multiSelect);
  return (
    <Tool
      icon="multi-select"
      help="selection.multi"
      title="Multi-Select — every click adds to the selection or removes from it"
      active={on}
      onClick={() => appState.set({ multiSelect: !on })}
    />
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

/** Tools shown directly in the sketch ribbon; the rest live in the "More" menus. */
const PRIMARY_CREATE = ["line", "rectangle-2point", "circle", "arc-3point", "polygon-inscribed", "slot", "spline-fit"];
const PRIMARY_MODIFY = ["trim", "extend", "offset", "mirror", "move", "copy", "fillet"];

function SketchRibbon(): ReactElement {
  const tool = useStore(appState, (s) => s.tool);
  const selection = useStore(appState, (s) => s.selection);
  const sketchId = useStore(appState, (s) => s.activeSketchId);
  const doc = useDocument();
  const feature = sketchId ? doc.features[sketchId] : undefined;
  const sketch = feature?.type === "sketch" ? feature.sketch : null;
  const anchors = sketch && sketchId
    ? selection.flatMap((s) => s.kind === "entity" && s.sketchId === sketchId && nodeHandlePair(sketch, s.entityId) ? [s.entityId] : [])
    : [];
  const modes: NodeMode[] = ["corner", "smooth", "symmetric", "sharp"];
  const activeMode = anchors.length && sketch
    ? modes.find((mode) => anchors.every((id) => (sketch.nodeModes?.[id] ?? "corner") === mode))
    : undefined;
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

  const activeMoreCreate = moreCreate.find((t) => t.id === tool);
  const activeMoreModify = modifyMore.find((t) => t.id === tool);

  return (
    <>
      <Group label="Select">
        <Tool icon="select" help="select" title="Select (Esc)" active={tool === "select"} onClick={() => setTool("select")} />
        <Tool
          icon="spline-control"
          help="sketch.node-edit"
          title="Node Edit — drag outline anchors and Bézier handles"
          active={tool === "node-edit"}
          onClick={() => setTool("node-edit")}
        />
        <MultiSelectTool />
      </Group>
      {tool === "node-edit" && (
        <Group label="Node Type">
          <Menu
            detached
            buttonClass="tool"
            title={anchors.length ? "Change the selected anchor node type" : "Tap an outline anchor to choose its node type"}
            label={<><Icon name="spline-control" /> <span>{activeMode === "smooth" ? "Smooth" : activeMode === "symmetric" ? "Symmetric" : activeMode === "sharp" ? "Sharp" : activeMode === "corner" ? "Corner" : "Node Type"}</span></>}
            items={[
              { label: "Corner", icon: "rectangle-2point", active: activeMode === "corner", disabled: anchors.length === 0, onSelect: () => setSelectedNodeMode("corner") },
              { label: "Smooth", icon: "spline-control", active: activeMode === "smooth", disabled: anchors.length === 0, onSelect: () => setSelectedNodeMode("smooth") },
              { label: "Symmetric", icon: "circle", active: activeMode === "symmetric", disabled: anchors.length === 0, onSelect: () => setSelectedNodeMode("symmetric") },
              { label: "Sharp", icon: "triangle", active: activeMode === "sharp", disabled: anchors.length === 0, onSelect: () => setSelectedNodeMode("sharp") },
            ]}
          />
        </Group>
      )}
      <Group label="Create">
        {primary.map((t) => (
          <Tool
            key={t.id}
            icon={t.id}
            help={`sketch.${t.id}`}
            title={`${t.label} — ${t.description}`}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
        <Tool
          icon="text"
          help="sketch.text"
          title="Text — click where the text starts, then write it"
          active={tool === "text"}
          onClick={() => setTool("text")}
        />
        <Tool
          icon="project"
          help="sketch.project"
          title="Project (P) — project edges, faces or vertices of a body onto the sketch"
          active={tool === "project"}
          onClick={() => setTool("project")}
        />
        <Menu
          detached
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
            help: { id: `sketch.${t.id}`, title: t.label, summary: t.description },
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
            help={`sketch.modify.${t.id}`}
            title={`${t.label} — ${t.description}`}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
        <Menu
          detached
          buttonClass={`tool${activeMoreModify ? " on" : ""}`}
          title="More modify tools"
          label={<Icon name={activeMoreModify?.id ?? "more"} />}
          items={modifyMore.map((t) => ({
            label: t.label,
            icon: t.id,
            help: { id: `sketch.modify.${t.id}`, title: t.label, summary: t.description },
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
            help={`constraint.${c.type}`}
            title={`${c.label} — ${c.hint}`}
            active={tool === `constraint:${c.type}`}
            onClick={() => applyConstraintToSelection(c.type)}
          />
        ))}
      </Group>
      <Group label="Dimension">
        <Tool
          icon="dimension"
          help="sketch.dimension"
          title="Sketch Dimension (D) — pick geometry, then place the dimension"
          active={tool === "dimension"}
          onClick={() => setTool("dimension")}
        />
        <Tool icon="measure" help="measure" title="Measure (I)" active={measuring} onClick={startMeasure} />
      </Group>
      <Group label="Options">
        <div className="ribbon-options">
          <Tool
            icon="toggle-construction"
            help="sketch.construction"
            title="Construction (X) — toggle the selection, or draw new geometry as construction"
            active={options.construction}
            onClick={toggleSelectedConstruction}
          />
          <label title="Snap free positions to whole millimetres (hold Ctrl / Cmd to switch off)">
            <input
              type="checkbox"
              checked={options.gridSnap}
              onChange={(e) => setOptions({ gridSnap: e.target.checked })}
            />
            Snap 1 mm
          </label>
          <label title="Line positions up with other points, horizontally and vertically (hold Ctrl / Cmd to switch off)">
            <input
              type="checkbox"
              checked={options.alignSnap}
              onChange={(e) => setOptions({ alignSnap: e.target.checked })}
            />
            Snap H/V
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
        <Tool icon="finish" help="sketch.finish" label="Finish Sketch" title="Finish Sketch" wide className="finish" onClick={finishSketch} />
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

/** Commands of the Modify group that live in its menu, to keep the ribbon on one screen. */
const MORE_MODIFY: { type: Dialog["type"]; kbd?: string }[] = [{ type: "split" }, { type: "align" }];

function SolidRibbon(): ReactElement {
  const dialog = useStore(appState, (s) => s.dialog);
  const filter = useStore(appState, (s) => s.selectionFilter);
  const measuring = useStore(appState, (s) => s.measuring);
  const is = (type: string): boolean => dialog?.type === type;
  const activeMore = MORE_MODIFY.find((c) => is(c.type));
  return (
    <>
      <Group label="Sketch">
        <Tool
          icon="new-sketch"
          help="solid.pick-sketch-plane"
          label="Create Sketch"
          title="Create Sketch — pick a plane or planar face"
          wide
          active={is("pick-sketch-plane")}
          onClick={() => beginSketchPlanePick(null)}
        />
      </Group>
      <Group label="Create">
        <Tool icon="extrude" label="Extrude" title="Extrude (E)" active={is("extrude")} help="solid.extrude" onClick={() => openDialog("extrude")} />
        <Tool icon="revolve" label="Revolve" title="Revolve" active={is("revolve")} help="solid.revolve" onClick={() => openDialog("revolve")} />
        <Tool icon="sweep" label="Sweep" title="Sweep — move a profile along a path" active={is("sweep")} help="solid.sweep" onClick={() => openDialog("sweep")} />
        <Tool icon="loft" label="Loft" title="Loft — a solid through two or more sections" active={is("loft")} help="solid.loft" onClick={() => openDialog("loft")} />
        <Tool icon="hole" label="Hole" title="Hole (H)" active={is("hole")} help="solid.hole" onClick={() => openDialog("hole")} />
      </Group>
      <Group label="Modify">
        <Tool icon="fillet-3d" label="Fillet" title="Fillet edges (F)" active={is("fillet")} help="solid.fillet" onClick={() => openDialog("fillet")} />
        <Tool icon="chamfer-3d" label="Chamfer" title="Chamfer edges" active={is("chamfer")} help="solid.chamfer" onClick={() => openDialog("chamfer")} />
        <Tool icon="shell" label="Shell" title="Shell — hollow a body" active={is("shell")} help="solid.shell" onClick={() => openDialog("shell")} />
        <Tool icon="combine" label="Combine" title="Combine — union, cut or intersect bodies" active={is("combine")} help="solid.combine" onClick={() => openDialog("combine")} />
        <Tool icon="move-3d" label="Move" title="Move/Copy (M)" active={is("move")} help="solid.move" onClick={() => openDialog("move")} />
        <Menu
          detached
          buttonClass={`tool${activeMore ? " on" : ""}`}
          title="More modify commands: Split Body, Align"
          label={<Icon name="more" />}
          items={MORE_MODIFY.map((c) => ({
            label: DIALOG_COMMANDS[c.type]?.label ?? c.type,
            icon: DIALOG_COMMANDS[c.type]?.icon,
            help: { id: `solid.${c.type}`, title: DIALOG_COMMANDS[c.type]?.label ?? c.type },
            kbd: c.kbd,
            active: is(c.type),
            onSelect: () => openDialog(c.type),
          }))}
        />
      </Group>
      <Group label="Construct">
        <Tool
          icon="offset-plane"
          label="Plane"
          title="Offset Plane — a construction plane at a distance from a plane or flat face"
          help="solid.offset-plane"
          active={is("offset-plane")}
          onClick={() => openDialog("offset-plane")}
        />
      </Group>
      <Group label="Pattern">
        <Tool icon="pattern-rectangular" label="Rect." title="Rectangular Pattern" active={is("rectangular-pattern")} help="solid.rectangular-pattern" onClick={() => openDialog("rectangular-pattern")} />
        <Tool icon="pattern-circular" label="Circular" title="Circular Pattern" active={is("circular-pattern")} help="solid.circular-pattern" onClick={() => openDialog("circular-pattern")} />
        <Tool icon="mirror-3d" label="Mirror" title="Mirror" active={is("mirror")} help="solid.mirror" onClick={() => openDialog("mirror")} />
      </Group>
      <AssembleGroup />
      <Group label="Insert">
        <Tool icon="import3d" help="solid.import-step" label="STEP" title="Import a STEP file" onClick={() => void importStep()} />
      </Group>
      <Group label="Inspect">
        <Tool icon="measure" help="measure" label="Measure" title="Measure (I)" active={measuring} onClick={startMeasure} />
      </Group>
      <Group label="Manage">
        <Tool icon="parameters" label="Parameters" title="Change parameters" active={is("parameters")} help="solid.parameters" onClick={() => openDialog("parameters")} />
      </Group>
      <Group label="Selection">
        <div className="ribbon-options">
          <MultiSelectTool />
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

/** Components: make one, place another instance, and say which one is being edited. */
function AssembleGroup(): ReactElement {
  const doc = useDocument();
  const active = useActiveComponentId();
  const selection = useStore(appState, (s) => s.selection);
  const root = doc.assembly.rootComponentId;
  // The definition an instance would be made of: the selected component or instance.
  const first = selection[0];
  const definition =
    first?.kind === "component"
      ? first.componentId
      : first?.kind === "instance"
        ? doc.assembly.instances[first.instanceId]?.componentId
        : active !== root
          ? active
          : undefined;
  const activeName = doc.assembly.components[active]?.name ?? "";
  const opening = useStore(appState, (s) => s.newComponent !== null);
  return (
    <Group label="Assemble">
      <Tool
        icon="new-component"
        label="New Component"
        title="New Component — an empty component to model in, or one made of the selected bodies"
        help="component.new"
        wide
        active={opening}
        onClick={openNewComponent}
      />
      <Tool
        icon="instance"
        label="Instance"
        title="Create Instance — place the selected component once more"
        help="component.instance"
        disabled={!definition}
        onClick={() => definition && newInstance(definition)}
      />
      {active !== root && (
        <Tool
          icon="document"
          label="Root"
          title={`Activate Root — finish editing ${activeName}`}
          help="component.activate"
          className="on"
          onClick={() => activateComponent(null)}
        />
      )}
    </Group>
  );
}

function FabricationRibbon(): ReactElement {
  const process = useStore(appState, (s) => s.fabricationProcess);
  return (
    <>
      <Group label="Process">
        <Tool
          icon="laser"
          help="fabrication.laser"
          label="Laser"
          title="Laser cutting: flat parts from sheet material"
          wide
          active={process === "laser"}
          onClick={() => appState.set({ fabricationProcess: "laser" })}
        />
        <Tool
          icon="print3d"
          help="fabrication.print"
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
