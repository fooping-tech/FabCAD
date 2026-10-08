import { type ReactElement, useEffect, useState } from "react";
import { appState } from "../app/appState";
import type { AutosaveEntry } from "../app/persistence";
import { loadRecoverySnapshots, restoreSnapshot } from "../app/session";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

/** The project name in a saved project file, without reading the whole project. */
function projectName(json: string): string {
  try {
    const file = JSON.parse(json) as { document?: { name?: unknown } };
    return typeof file.document?.name === "string" ? file.document.name : "Untitled";
  } catch {
    return "Untitled";
  }
}

const size = (json: string): string =>
  json.length < 1_048_576 ? `${Math.max(1, Math.round(json.length / 1024))} KB` : `${(json.length / 1_048_576).toFixed(1)} MB`;

/** The versions of the project this browser keeps (`persistence.ts`), newest first, to open one. */
export function RecoveryPanel(): ReactElement | null {
  const open = useStore(appState, (s) => s.recoveryOpen);
  const [snapshots, setSnapshots] = useState<AutosaveEntry[] | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setSnapshots(null);
    setProblem("");
    loadRecoverySnapshots().then(
      (list) => live && setSnapshots(list),
      (err: unknown) => live && setProblem(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [open]);

  if (!open) return null;
  const close = (): void => appState.set({ recoveryOpen: false });

  return (
    <FloatingPanel id="recover-autosave" anchor={null} title="Recover Autosave" className="recovery" onClose={close}>
      <div className="floating-body">
        {problem ? (
          <p className="share-link-problem" role="alert">
            The autosaves of this browser cannot be read: {problem}
          </p>
        ) : !snapshots ? (
          <p className="field-hint">Reading the autosaves…</p>
        ) : snapshots.length === 0 ? (
          <p className="field-hint">This browser keeps no autosave yet.</p>
        ) : (
          <ul className="recovery-list">
            {snapshots.map((entry, i) => (
              <li key={entry.token}>
                <span>
                  <strong>{new Date(entry.savedAt).toLocaleString()}</strong>
                  {i === 0 && " (latest)"}
                  <br />
                  <span className="field-hint">
                    {projectName(entry.json)} · {size(entry.json)}
                  </span>
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    if (restoreSnapshot(entry.json)) close();
                  }}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="share-link-notes">
          <li>This browser keeps the last 5 autosaves. They stay on this device and are not uploaded.</li>
          <li>Clearing the browser's site data removes them. Save project keeps a file you can open anywhere.</li>
        </ul>
        <div className="form-actions">
          <button className="btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
