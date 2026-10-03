import {
  listBodies,
  listComponents,
  listInstances,
  listSketchFeatures,
  renameBody,
  renameComponent,
  renameFeature,
  renameInstance,
  setBodyVisible,
  setComponentVisible,
  setInstancesVisible,
  setOriginVisible,
  setPlaneVisible,
  setSketchVisible,
} from "@fabcad/cad-document";
import type { OriginPlaneName } from "@fabcad/geometry";
import { Fragment, type ReactElement, type ReactNode, useEffect, useState } from "react";
import { editFeature, enterSketch, featureIcon, pickInDialog, pickSketchPlane } from "../app/actions";
import {
  activateComponent,
  moveBodiesToComponent,
  openInstanceMove,
  useActiveComponentId,
} from "../app/components";
import {
  type Selection,
  appState,
  isAdditiveClick,
  isSelected,
  select,
  selectionKey,
} from "../app/appState";
import { openContextMenu } from "../app/contextMenu";
import { modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

/** Bodies being dragged in the Browser (the drag data cannot be read while dragging over). */
let dragged: string[] | null = null;

function Row({
  depth,
  icon,
  name,
  caret,
  open,
  onToggle,
  visible,
  onVisible,
  selected,
  active,
  error,
  badge,
  onClick,
  onDoubleClick,
  onRename,
  onMenu,
  title,
  renameRequest,
  dragBodies,
  dropBodies,
}: {
  /** Start renaming now (asked for by the context menu). */
  renameRequest?: boolean;
  /** The row can be dragged; returns the bodies it carries. */
  dragBodies?: () => string[];
  /** The row takes dropped bodies: `accepts` tells whether these can go there. */
  dropBodies?: { accepts: (bodyIds: string[]) => boolean; drop: (bodyIds: string[]) => void };
  onMenu?: (e: React.MouseEvent) => void;
  depth: number;
  icon: string;
  name: string;
  caret?: boolean;
  open?: boolean;
  onToggle?: () => void;
  visible?: boolean;
  onVisible?: (visible: boolean) => void;
  selected?: boolean;
  active?: boolean;
  error?: boolean;
  badge?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onRename?: (name: string) => void;
  title?: string;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [over, setOver] = useState(false);
  const dim = visible === false;
  useEffect(() => {
    if (!renameRequest) return;
    setDraft(name);
    setEditing(true);
    appState.set({ renaming: null });
  }, [renameRequest]);
  return (
    <div
      className={`tree-row${selected ? " selected" : ""}${active ? " active" : ""}${dim ? " dim" : ""}${error ? " error" : ""}${over ? " drop-target" : ""}`}
      draggable={dragBodies !== undefined && !editing}
      onDragStart={
        dragBodies
          ? (e) => {
              dragged = dragBodies();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
            }
          : undefined
      }
      onDragEnd={dragBodies ? () => (dragged = null) : undefined}
      onDragOver={
        dropBodies
          ? (e) => {
              if (!dragged || !dropBodies.accepts(dragged)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!over) setOver(true);
            }
          : undefined
      }
      onDragLeave={dropBodies ? () => setOver(false) : undefined}
      onDrop={
        dropBodies
          ? (e) => {
              e.preventDefault();
              setOver(false);
              const ids = dragged;
              dragged = null;
              if (ids && dropBodies.accepts(ids)) dropBodies.drop(ids);
            }
          : undefined
      }
      style={{ paddingLeft: 4 + depth * 14 }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={caret ? open : undefined}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(e);
            }
          : undefined
      }
    >
      <span
        className={`tree-caret${open ? " open" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {caret && <Icon name="caret" size={10} />}
      </span>
      <span className="tree-icon">
        <Icon name={icon} size={15} />
      </span>
      <span className="tree-name">
        {editing ? (
          <input
            autoFocus
            value={draft}
            aria-label="Name"
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft !== name) onRename?.(draft.trim());
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            onDoubleClick={
              onRename && !onDoubleClick
                ? (e) => {
                    e.stopPropagation();
                    setDraft(name);
                    setEditing(true);
                  }
                : undefined
            }
          >
            {name}
          </span>
        )}
      </span>
      {badge}
      {onRename && onDoubleClick && !editing && (
        <button
          className="tree-eye"
          title="Rename"
          aria-label={`Rename ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            setDraft(name);
            setEditing(true);
          }}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.400" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 16l1-4 8.500-8.500 3 3L8 15z" />
          </svg>
        </button>
      )}
      {onVisible && (
        <button
          className={`tree-eye${visible === false ? " off" : ""}`}
          title={visible === false ? "Show" : "Hide"}
          aria-label={`${visible === false ? "Show" : "Hide"} ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onVisible(visible === false);
          }}
        >
          <Icon name={visible === false ? "eye-off" : "eye"} size={14} />
        </button>
      )}
    </div>
  );
}

const ORIGIN_ITEMS: { key: string; label: string; icon: string; plane?: OriginPlaneName }[] = [
  { key: "XY", label: "XY Plane", icon: "plane", plane: "XY" },
  { key: "XZ", label: "XZ Plane", icon: "plane", plane: "XZ" },
  { key: "YZ", label: "YZ Plane", icon: "plane", plane: "YZ" },
  { key: "X", label: "X Axis", icon: "axis" },
  { key: "Y", label: "Y Axis", icon: "axis" },
  { key: "Z", label: "Z Axis", icon: "axis" },
];

export function BrowserTree(): ReactElement {
  const doc = useDocument();
  const selection = useStore(appState, (s) => s.selection);
  const activeSketchId = useStore(appState, (s) => s.activeSketchId);
  const statuses = useStore(modelState, (s) => s.features);
  const computed = useStore(modelState, (s) => s.bodies);
  const active = useActiveComponentId();
  const renaming = useStore(appState, (s) => s.renaming);
  const [open, setOpen] = useState<Record<string, boolean>>({
    root: true,
    origin: false,
    sketches: true,
    bodies: true,
    components: true,
    instances: true,
  });
  /** Folders are open unless closed; `fallback` is the state before the first click. */
  const isOpen = (key: string, fallback = true): boolean => open[key] ?? fallback;
  const toggle = (key: string, fallback = true): void =>
    setOpen((o) => ({ ...o, [key]: !(o[key] ?? fallback) }));
  const additive = (e: React.MouseEvent): boolean => isAdditiveClick(e);
  /** A click on a row: a pick for the open feature dialog, otherwise a selection. */
  const pick = (sel: Selection, e: React.MouseEvent): void => {
    if (pickSketchPlane(sel) || pickInDialog(sel, additive(e))) return;
    select(sel, additive(e));
  };
  const menuFor = (sel: Selection) => (e: React.MouseEvent): void => {
    if (!isSelected(appState.get().selection, sel)) appState.set({ selection: [sel] });
    openContextMenu(e.clientX, e.clientY);
  };

  const root = doc.assembly.rootComponentId;
  const components = listComponents(doc);
  /** A dragged body takes the other selected bodies along. */
  const dragOf = (bodyId: string) => (): string[] => {
    const selected = appState
      .get()
      .selection.flatMap((x) => (x.kind === "body" ? [x.bodyId] : []));
    return selected.includes(bodyId) ? selected : [bodyId];
  };
  /** Drop target for bodies: the component they go to. */
  const dropInto = (componentId: string) => ({
    accepts: (ids: string[]) => ids.some((id) => doc.bodies[id] && doc.bodies[id].componentId !== componentId),
    drop: (ids: string[]) => moveBodiesToComponent(ids, componentId),
  });
  const instances = listInstances(doc);

  /** Planes, sketches, features and bodies of one component, as folders under `depth`. */
  const contents = (componentId: string, depth: number, prefix: string): ReactElement => {
    const sketches = listSketchFeatures(doc, componentId);
    const bodies = listBodies(doc, componentId);
    const owned = doc.timeline.flatMap((id) => {
      const f = doc.features[id];
      return f?.componentId === componentId ? [f] : [];
    });
    const planes = owned.flatMap((f) => (f.type === "offset-plane" ? [f] : []));
    // The root has the timeline for its steps; a component lists its own.
    const steps =
      componentId === root ? [] : owned.filter((f) => f.type !== "sketch" && f.type !== "offset-plane");
    const folder = (key: string, name: string, count: number, fallback = true): ReactElement => (
      <Row
        dropBodies={key === "bodies" ? dropInto(componentId) : undefined}
        depth={depth}
        icon="folder"
        name={name}
        caret
        open={isOpen(`${prefix}${key}`, fallback)}
        onToggle={() => toggle(`${prefix}${key}`, fallback)}
        onClick={() => toggle(`${prefix}${key}`, fallback)}
        badge={<span className="tree-badge">{count}</span>}
      />
    );
    return (
      <>
        {planes.length > 0 && folder("planes", "Planes", planes.length)}
        {planes.length > 0 &&
          isOpen(`${prefix}planes`) &&
          planes.map((f) => {
            const sel: Selection = { kind: "plane", featureId: f.id };
            return (
              <Row
                key={f.id}
                depth={depth + 1}
                icon="plane"
                name={f.name}
                visible={f.visible}
                onVisible={(v) => run(setPlaneVisible(f.id, v))}
                selected={isSelected(selection, sel)}
                error={statuses[f.id]?.state === "error"}
                title={statuses[f.id]?.message ?? "Double-click to edit the plane"}
                onClick={(e) => pick(sel, e)}
                onDoubleClick={() => editFeature(f.id)}
                onMenu={menuFor(sel)}
                onRename={(name) => run(renameFeature(f.id, name))}
              />
            );
          })}

        {folder("sketches", "Sketches", sketches.length)}
        {isOpen(`${prefix}sketches`) &&
          sketches.map((f) => {
            const sel: Selection = { kind: "feature", featureId: f.id };
            return (
              <Row
                key={f.id}
                depth={depth + 1}
                icon="sketch"
                name={f.name}
                visible={f.visible}
                onVisible={(v) => run(setSketchVisible(f.id, v))}
                selected={isSelected(selection, sel)}
                active={activeSketchId === f.id}
                error={statuses[f.id]?.state === "error"}
                title={statuses[f.id]?.message ?? "Double-click to edit the sketch"}
                onClick={(e) => pick(sel, e)}
                onDoubleClick={() => {
                  if (componentId !== active) activateComponent(componentId);
                  enterSketch(f.id);
                }}
                onMenu={menuFor(sel)}
                onRename={(name) => run(renameFeature(f.id, name))}
              />
            );
          })}

        {componentId !== root && folder("features", "Features", steps.length, false)}
        {componentId !== root &&
          isOpen(`${prefix}features`, false) &&
          steps.map((f) => {
            const sel: Selection = { kind: "feature", featureId: f.id };
            return (
              <Row
                key={f.id}
                depth={depth + 1}
                icon={featureIcon(f)}
                name={f.name}
                visible={!f.suppressed}
                selected={isSelected(selection, sel)}
                error={statuses[f.id]?.state === "error"}
                title={statuses[f.id]?.message ?? "Double-click to edit the feature"}
                onClick={(e) => pick(sel, e)}
                onDoubleClick={() => {
                  if (componentId !== active) activateComponent(componentId);
                  editFeature(f.id);
                }}
                onMenu={menuFor(sel)}
                onRename={(name) => run(renameFeature(f.id, name))}
              />
            );
          })}

        {folder("bodies", "Bodies", bodies.length)}
        {isOpen(`${prefix}bodies`) &&
          bodies.map((b) => {
            const sel: Selection = { kind: "body", bodyId: b.id };
            const missing = !computed[b.id];
            return (
              <Row
                key={b.id}
                depth={depth + 1}
                icon="body"
                name={b.name}
                visible={b.visible}
                onVisible={(v) => run(setBodyVisible(b.id, v))}
                selected={isSelected(selection, sel)}
                error={missing && statuses[b.createdBy]?.state === "error"}
                title={missing ? "This body has no geometry at the current history position" : undefined}
                onClick={(e) => pick(sel, e)}
                onMenu={menuFor(sel)}
                onRename={(name) => run(renameBody(b.id, name))}
                dragBodies={dragOf(b.id)}
              />
            );
          })}
      </>
    );
  };

  const activeBadge = <span className="tree-badge tree-active">Active</span>;

  return (
    <div className="panel grow">
      <div className="panel-title">Browser</div>
      <div className="panel-body" role="tree" aria-label="Browser">
        <Row
          depth={0}
          icon="document"
          name={doc.name}
          caret
          open={open.root}
          active={active === root && components.length > 0}
          badge={active === root && components.length > 0 ? activeBadge : undefined}
          title={active === root ? undefined : "Double-click to activate the root"}
          onToggle={() => toggle("root")}
          onClick={() => toggle("root")}
          onDoubleClick={active === root ? undefined : () => activateComponent(null)}
          dropBodies={dropInto(root)}
        />
        {open.root && (
          <>
            <Row
              depth={1}
              icon="origin"
              name="Origin"
              caret
              open={open.origin}
              onToggle={() => toggle("origin")}
              onClick={() => toggle("origin")}
              visible={doc.origin.visible}
              onVisible={(v) => run(setOriginVisible(null, v))}
            />
            {open.origin &&
              ORIGIN_ITEMS.map((item) => {
                const sel: Selection | null = item.plane
                  ? { kind: "origin-plane", plane: item.plane }
                  : null;
                return (
                  <Row
                    key={item.key}
                    depth={2}
                    icon={item.icon}
                    name={item.label}
                    visible={doc.origin.visible && !doc.origin.hidden.includes(item.key)}
                    onVisible={(v) => run(setOriginVisible(item.key, v))}
                    selected={sel ? isSelected(selection, sel) : false}
                    onClick={sel ? (e) => pick(sel, e) : undefined}
                    onMenu={sel ? menuFor(sel) : undefined}
                  />
                );
              })}

            {contents(root, 1, "")}

            <Row
              depth={1}
              icon="folder"
              name="Components"
              caret
              open={isOpen("components")}
              onToggle={() => toggle("components")}
              onClick={() => toggle("components")}
              badge={<span className="tree-badge">{components.length}</span>}
            />
            {isOpen("components") &&
              (components.length === 0 ? (
                <div className="empty" style={{ paddingLeft: 46, paddingTop: 2, paddingBottom: 2 }}>
                  No components
                </div>
              ) : (
                components.map((c) => {
                  const sel: Selection = { kind: "component", componentId: c.id };
                  const own = listInstances(doc, c.id);
                  const key = `component:${c.id}`;
                  const isActive = active === c.id;
                  return (
                    <Fragment key={c.id}>
                      <Row
                        depth={2}
                        icon="component"
                        name={c.name}
                        caret
                        open={isOpen(key, isActive)}
                        onToggle={() => toggle(key, isActive)}
                        visible={own.length === 0 ? undefined : own.some((i) => i.visible)}
                        onVisible={
                          own.length === 0 ? undefined : (v) => run(setComponentVisible(c.id, v))
                        }
                        selected={isSelected(selection, sel)}
                        active={isActive}
                        badge={
                          isActive ? (
                            activeBadge
                          ) : (
                            <span className="tree-badge" title="Instances">
                              ×{own.length}
                            </span>
                          )
                        }
                        title="Component definition. Double-click to activate it and edit it."
                        onClick={(e) => pick(sel, e)}
                        onDoubleClick={() => activateComponent(isActive ? null : c.id)}
                        onMenu={menuFor(sel)}
                        onRename={(name) => run(renameComponent(c.id, name))}
                        renameRequest={renaming === selectionKey(sel)}
                        dropBodies={dropInto(c.id)}
                      />
                      {isOpen(key, isActive) && contents(c.id, 3, `${c.id}:`)}
                    </Fragment>
                  );
                })
              ))}

            {instances.length > 0 && (
              <Row
                depth={1}
                icon="folder"
                name="Instances"
                caret
                open={isOpen("instances")}
                onToggle={() => toggle("instances")}
                onClick={() => toggle("instances")}
                badge={<span className="tree-badge">{instances.length}</span>}
              />
            )}
            {isOpen("instances") &&
              instances.map((i) => {
                const sel: Selection = { kind: "instance", instanceId: i.id };
                return (
                  <Row
                    key={i.id}
                    depth={2}
                    icon="instance"
                    name={i.name}
                    visible={i.visible}
                    onVisible={(v) => run(setInstancesVisible([i.id], v))}
                    selected={isSelected(selection, sel)}
                    title={`Instance of ${doc.assembly.components[i.componentId]?.name ?? "a component"}. Double-click to move it.`}
                    onClick={(e) => pick(sel, e)}
                    onDoubleClick={() => openInstanceMove(i.id)}
                    onMenu={menuFor(sel)}
                    onRename={(name) => run(renameInstance(i.id, name))}
                    renameRequest={renaming === selectionKey(sel)}
                  />
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}
