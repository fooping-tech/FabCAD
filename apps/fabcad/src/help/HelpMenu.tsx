import { type ReactElement, useEffect, useRef } from "react";
import { appState } from "../app/appState";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Popover";
import { helpFor } from "./content";
import { closeHelpMenu, openHelpTopic } from "./helpState";

/** The small help menu of a tool: what it does in a sentence, and the way to the details. */
export function HelpMenu(): ReactElement | null {
  const request = useStore(appState, (s) => s.help.menu);
  const ref = useRef<HTMLDivElement>(null);
  // Opened by a long press, the finger is still down: lifting it must not press "Details".
  const armed = useRef(true);

  useEffect(() => {
    if (!request) return;
    armed.current = !request.held;
    let arm: ReturnType<typeof setTimeout> | null = null;
    const lifted = (): void => {
      arm ??= setTimeout(() => {
        armed.current = true;
      }, 80);
    };
    window.addEventListener("pointerup", lifted, true);
    window.addEventListener("pointercancel", lifted, true);
    const outside = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeHelpMenu();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Esc closes the help, not the command that is running.
      e.stopPropagation();
      e.preventDefault();
      closeHelpMenu();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      if (arm) clearTimeout(arm);
      window.removeEventListener("pointerup", lifted, true);
      window.removeEventListener("pointercancel", lifted, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [request]);

  if (!request) return null;
  const entry = helpFor(request.id, request);
  return (
    <Popover
      anchor={{ x: request.x, y: request.y }}
      className="menu help-menu"
      role="dialog"
      label={`Help: ${entry.title}`}
      popoverRef={ref}
      placement={{ gap: 10 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="help-menu-title">
        {entry.title}
        {entry.shortcut && <span className="kbd">{entry.shortcut}</span>}
      </div>
      <p className="help-menu-text">{entry.summary}</p>
      <button
        role="menuitem"
        onClick={() => {
          if (!armed.current) return;
          openHelpTopic({
            id: request.id,
            title: request.title,
            ...(request.summary !== undefined ? { summary: request.summary } : {}),
          });
        }}
      >
        <Icon name="info" size={16} />
        Details
      </button>
    </Popover>
  );
}
