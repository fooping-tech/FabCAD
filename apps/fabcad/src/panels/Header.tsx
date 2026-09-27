import { renameDocument } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { importStep, openDialog, setWorkspace } from "../app/actions";
import { appState } from "../app/appState";
import {
  exportModel,
  newProject,
  openProjectFile,
  pickFile,
  redo,
  run,
  saveProject,
  undo,
  useDocument,
  useHistoryState,
  documentStore,
} from "../app/session";
import { useStore } from "../app/tinyStore";
import { exportSketchSvg } from "../sketch/exportSketch";
import { Icon } from "../ui/Icon";
import { Menu } from "../ui/Menu";

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export async function openProject(): Promise<void> {
  if (documentStore.dirty && documentStore.document.timeline.length > 0) {
    if (!window.confirm("Discard the unsaved changes of the current project?")) return;
  }
  const file = await pickFile(".json,.fabcad.json,application/json");
  if (file) await openProjectFile(file);
}

export function createProject(): void {
  if (documentStore.dirty && documentStore.document.timeline.length > 0) {
    if (!window.confirm("Discard the unsaved changes of the current project?")) return;
  }
  newProject();
}

export function Header({ onExportFabrication }: { onExportFabrication: (format: "svg" | "dxf") => void }): ReactElement {
  const doc = useDocument();
  const history = useHistoryState();
  const workspace = useStore(appState, (s) => s.workspace);
  const [name, setName] = useState(doc.name);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => setName(doc.name), [doc.name]);

  const commitName = (): void => {
    const next = name.trim();
    if (next && next !== doc.name) run(renameDocument(next));
    else setName(doc.name);
  };

  return (
    <header className="header">
      <div className="brand" title="FabCAD">
        <span className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 32 32" fill="none" strokeWidth="2.400" strokeLinejoin="round">
            <path d="M6 22 16 27.500 26 22V11L16 5.500 6 11z" stroke="#fff" />
            <path d="M6 11l10 5.500L26 11M16 16.500v11" stroke="#efa562" />
          </svg>
        </span>
        FabCAD
        <span className="brand-tag">BETA</span>
      </div>

      <div className="workspace-tabs" role="tablist" aria-label="Workspace">
        <button
          role="tab"
          aria-selected={workspace === "design"}
          className={workspace === "design" ? "on" : ""}
          onClick={() => setWorkspace("design")}
        >
          DESIGN
        </button>
        <button
          role="tab"
          aria-selected={workspace === "fabrication"}
          className={workspace === "fabrication" ? "on" : ""}
          onClick={() => setWorkspace("fabrication")}
        >
          FABRICATION
        </button>
      </div>

      <div className="header-sep" />

      <Menu
        label={
          <>
            <Icon name="menu" size={16} /> File
          </>
        }
        items={[
          { label: "New project", icon: "new", onSelect: createProject },
          { label: "Open…", icon: "open", kbd: `${mod}O`, onSelect: () => void openProject() },
          { label: "Save project", icon: "save", kbd: `${mod}S`, onSelect: saveProject },
          { separator: true },
          { label: "Import STEP…", icon: "import", onSelect: () => void importStep() },
          { separator: true },
          { label: "Parameters…", icon: "parameters", onSelect: () => openDialog("parameters") },
          { label: "About FabCAD", icon: "info", onSelect: () => openDialog("about") },
        ]}
      />

      <div className="header-actions">
        <button
          className="icon-btn"
          onClick={undo}
          disabled={!history.canUndo}
          title={history.undoLabel ? `Undo ${history.undoLabel} (${mod}Z)` : `Undo (${mod}Z)`}
          aria-label="Undo"
        >
          <Icon name="undo" size={16} />
        </button>
        <button
          className="icon-btn"
          onClick={redo}
          disabled={!history.canRedo}
          title={history.redoLabel ? `Redo ${history.redoLabel} (${mod}⇧Z)` : `Redo (${mod}⇧Z)`}
          aria-label="Redo"
        >
          <Icon name="redo" size={16} />
        </button>
      </div>

      <div className="doc-name">
        <input
          ref={nameRef}
          value={name}
          aria-label="Project name"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") nameRef.current?.blur();
            if (e.key === "Escape") {
              setName(doc.name);
              nameRef.current?.blur();
            }
          }}
        />
        {history.dirty && <span className="dirty-dot" title="Unsaved changes" />}
      </div>

      <div className="header-spacer" />

      <button className="btn" onClick={saveProject} title={`Save project (${mod}S)`}>
        Save
      </button>
      <Menu
        align="right"
        buttonClass="btn primary"
        label={
          <>
            <Icon name="export" size={15} /> Export
          </>
        }
        items={[
          { title: "Fabrication" },
          { label: "SVG — laser cutting", icon: "laser", onSelect: () => onExportFabrication("svg") },
          { label: "DXF — laser cutting", icon: "laser", onSelect: () => onExportFabrication("dxf") },
          { separator: true },
          { title: "Sketch" },
          { label: "SVG — selected sketch", icon: "sketch", onSelect: () => exportSketchSvg() },
          { separator: true },
          { title: "3D model" },
          { label: "STEP", icon: "body", onSelect: () => void exportModel("step") },
          { label: "STL", icon: "body", onSelect: () => void exportModel("stl") },
          { separator: true },
          { title: "Project" },
          { label: "FabCAD project (.fabcad.json)", icon: "save", onSelect: saveProject },
        ]}
      />
    </header>
  );
}
