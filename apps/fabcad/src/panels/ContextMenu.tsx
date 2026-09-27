import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { appState } from "../app/appState";
import { buildContextMenu, closeContextMenu } from "../app/contextMenu";
import { useStore } from "../app/tinyStore";
import { Icon, hasIcon } from "../ui/Icon";

/** Right-click (or long-press) menu at the pointer. */
export function ContextMenu(): ReactElement | null {
  const at = useStore(appState, (s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // After a long press the menu opens under the finger: lifting it must not pick an item.
  const armed = useRef(true);

  useLayoutEffect(() => {
    if (!at || !ref.current) {
      setPosition(null);
      return;
    }
    // Keep the menu inside the window.
    const r = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(6, Math.min(at.x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(at.y, window.innerHeight - r.height - 6)),
    });
  }, [at]);

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
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={{
        left: position?.left ?? at.x,
        top: position?.top ?? at.y,
        visibility: position ? "visible" : "hidden",
      }}
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
    </div>
  );
}
