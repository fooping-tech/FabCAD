import type { ReactElement } from "react";
import { appState, dismissToast } from "../app/appState";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";

export function Toasts(): ReactElement {
  const toasts = useStore(appState, (s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.actions ? " with-actions" : ""}`}>
          {t.text}
          {t.actions && (
            <div className="toast-actions">
              {t.actions.map((a) => (
                <button key={a.label} className="toast-action" title={a.title} onClick={a.onSelect}>
                  {a.label}
                </button>
              ))}
              <button className="toast-close" aria-label="Close" title="Close" onClick={() => dismissToast(t.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
