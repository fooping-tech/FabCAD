import type { ReactElement } from "react";
import { deleteSelection, finishSketch } from "../app/actions";
import { appState } from "../app/appState";
import { pressEnter, pressEscape } from "../app/shortcuts";
import { createTool } from "../sketch/createTools";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

/**
 * On-screen stand-ins for Esc, Enter and Delete. Shown on touch devices and small screens,
 * where there is no keyboard to cancel or finish a command.
 */
export function TouchBar(): ReactElement | null {
  const tool = useStore(appState, (s) => s.tool);
  const sketching = useStore(appState, (s) => s.activeSketchId !== null);
  const selection = useStore(appState, (s) => s.selection.length);
  const dialog = useStore(appState, (s) => s.dialog);
  const workspace = useStore(appState, (s) => s.workspace);
  const open = useStore(appState, (s) => s.sidePanelOpen);

  const openEnded = createTool(tool)?.clicks === "many";
  const running = sketching && tool !== "select";
  const featureDialog =
    dialog !== null && dialog.type !== "parameters" && dialog.type !== "about";

  return (
    <div className="touch-bar" role="toolbar" aria-label="Command actions">
      <button
        className={`touch-btn${open ? " on" : ""}`}
        onClick={() => appState.set({ sidePanelOpen: !open })}
        aria-pressed={open}
      >
        <Icon name="menu" size={16} />
        {workspace === "fabrication" ? "Settings" : "Browser"}
      </button>
      {workspace === "design" && (
        <>
          {(running || featureDialog) && (
            <button className="touch-btn" onClick={pressEscape}>
              <Icon name="close" size={15} />
              Cancel
            </button>
          )}
          {openEnded && (
            <button className="touch-btn primary" onClick={() => pressEnter()}>
              <Icon name="check" size={15} />
              Done
            </button>
          )}
          {selection > 0 && !featureDialog && (
            <button className="touch-btn danger" onClick={deleteSelection}>
              <Icon name="trash" size={15} />
              Delete
            </button>
          )}
          {sketching && (
            <button className="touch-btn primary" onClick={finishSketch}>
              <Icon name="finish" size={15} />
              Finish
            </button>
          )}
        </>
      )}
    </div>
  );
}
