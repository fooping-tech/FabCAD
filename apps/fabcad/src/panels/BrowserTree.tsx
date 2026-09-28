import {
  listBodies,
  listSketchFeatures,
  renameBody,
  renameFeature,
  setBodyVisible,
  setOriginVisible,
  setSketchVisible,
} from "@fabcad/cad-document";
import type { OriginPlaneName } from "@fabcad/geometry";
import { type ReactElement, type ReactNode, useState } from "react";
import { enterSketch, pickInDialog } from "../app/actions";
import { type Selection, appState, isSelected, select } from "../app/appState";
import { openContextMenu } from "../app/contextMenu";
import { modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

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
}: {
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
  const dim = visible === false;
  return (
    <div
      className={`tree-row${selected ? " selected" : ""}${active ? " active" : ""}${dim ? " dim" : ""}${error ? " error" : ""}`}
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
  const [open, setOpen] = useState<Record<string, boolean>>({
    root: true,
    origin: false,
    sketches: true,
    bodies: true,
    components: false,
  });
  const toggle = (key: string): void => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const additive = (e: React.MouseEvent): boolean => e.shiftKey || e.metaKey || e.ctrlKey;
  /** A click on a row: a pick for the open feature dialog, otherwise a selection. */
  const pick = (sel: Selection, e: React.MouseEvent): void => {
    if (!pickInDialog(sel, additive(e))) select(sel, additive(e));
  };
  const menuFor = (sel: Selection) => (e: React.MouseEvent): void => {
    if (!isSelected(appState.get().selection, sel)) appState.set({ selection: [sel] });
    openContextMenu(e.clientX, e.clientY);
  };

  const root = doc.assembly.rootComponentId;
  const sketches = listSketchFeatures(doc, root);
  const bodies = listBodies(doc, root);
  const children = Object.values(doc.assembly.components).filter((c) => c.id !== root);

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
          onToggle={() => toggle("root")}
          onClick={() => toggle("root")}
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

            <Row
              depth={1}
              icon="folder"
              name="Sketches"
              caret
              open={open.sketches}
              onToggle={() => toggle("sketches")}
              onClick={() => toggle("sketches")}
              badge={<span className="tree-badge">{sketches.length}</span>}
            />
            {open.sketches &&
              sketches.map((f) => {
                const sel: Selection = { kind: "feature", featureId: f.id };
                return (
                  <Row
                    key={f.id}
                    depth={2}
                    icon="sketch"
                    name={f.name}
                    visible={f.visible}
                    onVisible={(v) => run(setSketchVisible(f.id, v))}
                    selected={isSelected(selection, sel)}
                    active={activeSketchId === f.id}
                    error={statuses[f.id]?.state === "error"}
                    title={statuses[f.id]?.message ?? "Double-click to edit the sketch"}
                    onClick={(e) => pick(sel, e)}
                    onDoubleClick={() => enterSketch(f.id)}
                    onMenu={menuFor(sel)}
                    onRename={(name) => run(renameFeature(f.id, name))}
                  />
                );
              })}

            <Row
              depth={1}
              icon="folder"
              name="Bodies"
              caret
              open={open.bodies}
              onToggle={() => toggle("bodies")}
              onClick={() => toggle("bodies")}
              badge={<span className="tree-badge">{bodies.length}</span>}
            />
            {open.bodies &&
              bodies.map((b) => {
                const sel: Selection = { kind: "body", bodyId: b.id };
                const missing = !computed[b.id];
                return (
                  <Row
                    key={b.id}
                    depth={2}
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
                  />
                );
              })}

            <Row
              depth={1}
              icon="folder"
              name="Components"
              caret
              open={open.components}
              onToggle={() => toggle("components")}
              onClick={() => toggle("components")}
              badge={<span className="tree-badge">{children.length}</span>}
            />
            {open.components &&
              (children.length === 0 ? (
                <div className="empty" style={{ paddingLeft: 46, paddingTop: 2, paddingBottom: 2 }}>
                  No components
                </div>
              ) : (
                children.map((c) => <Row key={c.id} depth={2} icon="component" name={c.name} />)
              ))}
          </>
        )}
      </div>
    </div>
  );
}
