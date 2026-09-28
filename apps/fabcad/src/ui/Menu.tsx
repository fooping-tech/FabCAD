import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import type { HelpTopic } from "../app/appState";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

export type MenuItem =
  | { separator: true }
  | { title: string }
  | {
      label: string;
      icon?: string;
      kbd?: string;
      disabled?: boolean;
      active?: boolean;
      /** Help shown on right-click or long press. */
      help?: HelpTopic;
      onSelect: () => void;
    };

type MenuCommand = Extract<MenuItem, { label: string }>;

function MenuButton({
  item,
  onSelect,
}: {
  item: MenuCommand;
  onSelect: () => void;
}): ReactElement {
  const help = useHelpTrigger(item.help);
  const { guard, ...handlers } = help ?? { guard: (f: () => void) => f };
  return (
    <button
      role="menuitem"
      disabled={item.disabled}
      className={item.active ? "on" : ""}
      {...handlers}
      onClick={guard(onSelect)}
    >
      {item.icon && <Icon name={item.icon} size={16} />}
      {item.label}
      {item.kbd && <span className="kbd">{item.kbd}</span>}
    </button>
  );
}

export function Menu({
  label,
  items,
  align = "left",
  buttonClass = "btn",
  title,
}: {
  label: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  buttonClass?: string;
  title?: string;
  /**
   * Kept for callers: every menu is placed relative to the window now, inside what can be
   * seen of it, whatever container its button sits in.
   */
  detached?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      // The help menu of an entry belongs to the menu: using it does not close the menu.
      if (target instanceof Element && target.closest(".help-menu")) return;
      setOpen(false);
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
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <Popover
          anchor={() => ref.current?.getBoundingClientRect()}
          className="menu"
          popoverRef={menuRef}
          placement={{ align }}
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
              <MenuButton
                key={i}
                item={item}
                onSelect={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              />
            );
          })}
        </Popover>
      )}
    </div>
  );
}
