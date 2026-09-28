import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export type MenuItem =
  | { separator: true }
  | { title: string }
  | {
      label: string;
      icon?: string;
      kbd?: string;
      disabled?: boolean;
      active?: boolean;
      onSelect: () => void;
    };

export function Menu({
  label,
  items,
  align = "left",
  buttonClass = "btn",
  title,
  detached = false,
}: {
  label: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  buttonClass?: string;
  title?: string;
  /**
   * Place the menu relative to the window instead of its button. Needed where the button sits
   * in a container that clips what sticks out of it, such as the ribbon, which scrolls.
   */
  detached?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const toggle = (): void => {
    const r = ref.current?.getBoundingClientRect();
    // Kept inside the window: the menu is at least 190 px wide.
    setAt(r ? { left: Math.max(4, Math.min(r.left, window.innerWidth - 200)), top: r.bottom + 4 } : null);
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={buttonClass}
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={toggle}
      >
        {label}
      </button>
      {open && (
        <div
          className={`menu${align === "right" ? " right" : ""}`}
          role="menu"
          style={detached && at ? { position: "fixed", left: at.left, top: at.top } : undefined}
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
                className={item.active ? "on" : ""}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} size={16} />}
                {item.label}
                {item.kbd && <span className="kbd">{item.kbd}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
