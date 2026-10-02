import type { ReactElement } from "react";
import { appState } from "../app/appState";
import { copyHistoryLog, currentHistoryLog, fabricationLog } from "../app/copyHistoryLog";
import { modelState, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

/**
 * The history log on screen: every step with its status and settings, and the bodies. It can be
 * read where the clipboard cannot (an agent in a remote browser); Copy adds the project JSON.
 */
export function HistoryLogPanel(): ReactElement | null {
  const open = useStore(appState, (s) => s.historyLogOpen);
  // Re-rendered whenever the document or the computed model changes.
  useDocument();
  useStore(modelState, (s) => s.features);
  useStore(modelState, (s) => s.bodies);
  useStore(fabricationLog, (s) => s.lines);
  if (!open) return null;
  const close = (): void => appState.set({ historyLogOpen: false });
  return (
    <FloatingPanel id="history-log" anchor={null} title="History Log" className="history-log" onClose={close}>
      <div className="floating-body">
        <pre className="history-log-text" aria-label="History log">{currentHistoryLog(false)}</pre>
        <div className="form-actions" style={{ alignItems: "center" }}>
          <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
            Copy includes the project (JSON).
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn accent" onClick={() => void copyHistoryLog()}>
            Copy
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
