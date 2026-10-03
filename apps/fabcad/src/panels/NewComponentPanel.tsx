import { nextComponentName } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useState } from "react";
import { appState } from "../app/appState";
import { cancelNewComponent, commitNewComponent } from "../app/components";
import { documentStore, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

/**
 * New Component, as in Fusion: a name, whether the selected bodies go into it, and whether it
 * is activated right away. Components are made at the root.
 */
export function NewComponentPanel(): ReactElement | null {
  const pending = useStore(appState, (s) => s.newComponent);
  const doc = useDocument();
  const [name, setName] = useState("");
  const [fromSelection, setFromSelection] = useState(false);
  const [activate, setActivate] = useState(true);

  useEffect(() => {
    if (!pending) return;
    const selected = pending.bodyIds.length + pending.featureIds.length > 0;
    setName(nextComponentName(documentStore.document));
    setFromSelection(selected);
    setActivate(!selected);
  }, [pending]);

  if (!pending) return null;
  const count = pending.bodyIds.length;
  const selected = count + pending.featureIds.length > 0;
  const ok = (): void => commitNewComponent({ name, fromSelection, activate });
  const keys = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      ok();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelNewComponent();
    }
  };

  return (
    <FloatingPanel
      id="new-component"
      anchor={pending.anchor}
      title="New Component"
      className="tool-window"
      onClose={cancelNewComponent}
      closeLabel="Cancel (Esc)"
    >
      <div className="floating-body">
        <div className="form">
          <label className="field tool-field">
            <span className="label">Name</span>
            <span className="tool-input">
              <input
                autoFocus
                value={name}
                aria-label="Name"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={keys}
              />
            </span>
          </label>
          <div className="field tool-field">
            <span className="label">Parent</span>
            <span title="Components are made at the root; they are not nested.">{doc.name} (root)</span>
          </div>
          {selected && (
            <label className="field tool-field check">
              <input
                type="checkbox"
                checked={fromSelection}
                onChange={(e) => setFromSelection(e.target.checked)}
              />
              From selected bodies{count > 0 ? ` (${count})` : ""}
            </label>
          )}
          <label className="field tool-field check">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            Activate
          </label>
        </div>
        <div className="form-actions">
          <button className="btn" onClick={cancelNewComponent}>
            Cancel
          </button>
          <button className="btn accent" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
