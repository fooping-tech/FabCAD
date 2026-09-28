import { type ReactElement, useEffect, useRef } from "react";
import { appState } from "../app/appState";
import { buildContextMenu, closeContextMenu } from "../app/contextMenu";
import { useStore } from "../app/tinyStore";
import { Icon, hasIcon } from "../ui/Icon";
import { Popover } from "../ui/Popover";

/** Context menu at the pointer: right-click with a mouse, double tap on a touch screen. */
export function ContextMenu(): ReactElement | null {
  const at = useStore(appState, (s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  // A menu opened while the finger is still down: lifting it must not pick an item.
  const armed = useRef(true);

  useEffect(() => {
    if (!at) return;
    armed.current = !at.held;
    const lifted = (): void => {
      setTimeout(() => {
        armed.current = true;
      }, 80);
    };
    window.addEventListener("pointerup", lifted, true);
    window.addEventListener("pointercancel", lifted, true);
    const outside = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const release = (): void => {
      window.removeEventListener("pointerup", lifted, true);
      window.removeEventListener("pointercancel", lifted, true);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeContextMenu();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      release();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [at]);

  if (!at) return null;
  const items = buildContextMenu();
  return (
    <Popover
      anchor={{ x: at.x, y: at.y }}
      className="menu context-menu"
      popoverRef={ref}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if ("separator" in item) return <hr key={i} />;
        if ("title" in item) {
          return (
            <div className="menu-title" key={i}>
              {item.title}
            </div>
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (!armed.current) return;
              closeContextMenu();
              item.onSelect();
            }}
          >
            {item.icon && hasIcon(item.icon) ? <Icon name={item.icon} size={16} /> : <span style={{ width: 16 }} />}
            {item.label}
            {item.kbd && <span className="kbd">{item.kbd}</span>}
          </button>
        );
      })}
    </Popover>
  );
}
