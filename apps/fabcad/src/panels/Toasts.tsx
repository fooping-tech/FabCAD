import type { ReactElement } from "react";
import { appState } from "../app/appState";
import { useStore } from "../app/tinyStore";

export function Toasts(): ReactElement {
  const toasts = useStore(appState, (s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
