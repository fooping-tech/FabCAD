import { evaluateAs } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useRef } from "react";
import { appState } from "../app/appState";
import { currentScope } from "../app/session";
import { useStore } from "../app/tinyStore";
import { createTool } from "../sketch/createTools";
import { parsePointEntry } from "../sketch/pointEntry";
import { viewportApi } from "../viewport/api";

/**
 * Enter in the point box: place the typed point. An empty box finishes a polyline or a spline,
 * or closes. The text lives in `appState.pointEntry`, so that keys typed before the box has
 * the focus (`shortcuts.ts`) are not lost.
 */
export function submitPointEntry(): void {
  const entry = appState.get().pointEntry;
  const api = viewportApi();
  if (!entry || !api) return;
  if (entry.text.trim() === "") {
    if (!api.confirm()) appState.set({ pointEntry: null });
    return;
  }
  const result = parsePointEntry(entry.text, api.lastPick(), (e, kind) =>
    evaluateAs(e, kind, currentScope()),
  );
  if (!result.ok) {
    appState.set({ pointEntry: { text: entry.text, error: result.error } });
    return;
  }
  api.typePoint(result.point);
  appState.set({ pointEntry: { text: "" } });
}

/**
 * The box where the next point of the running Create tool is typed: `x, y`, `@dx, dy` or
 * `@length<angle`. It opens when a digit is typed while the tool runs and stays open for the
 * following points; Esc closes it.
 */
export function PointEntry(): ReactElement | null {
  const entry = useStore(appState, (s) => s.pointEntry);
  const tool = useStore(appState, (s) => s.tool);
  const active = useStore(appState, (s) => s.activeSketchId);
  const input = useRef<HTMLInputElement>(null);
  const open = entry !== null && active !== null && createTool(tool) !== undefined;

  useEffect(() => {
    if (!open) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  if (!open) return null;
  return (
    <div className="point-entry" role="group" aria-label="Type a point">
      <label>
        <span className="label">Point</span>
        <input
          ref={input}
          value={entry.text}
          aria-label="Point: x, y or @dx, dy or @length<angle"
          aria-invalid={entry.error !== undefined}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="next"
          onChange={(e) => appState.set({ pointEntry: { text: e.target.value } })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              submitPointEntry();
            } else if (e.key === "Escape") {
              e.preventDefault();
              appState.set({ pointEntry: null });
            }
          }}
        />
      </label>
      <span className={entry.error ? "point-entry-hint error" : "point-entry-hint"}>
        {entry.error ?? "x, y · @dx, dy · @length<angle — Enter places the point"}
      </span>
    </div>
  );
}
