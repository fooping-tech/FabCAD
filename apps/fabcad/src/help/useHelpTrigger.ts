import { useMemo } from "react";
import type { HelpTopic } from "../app/appState";
import { createLongPress } from "../ui/gestures";
import { openHelpMenu } from "./helpState";

export interface HelpTriggerProps {
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  /** Wraps the click of the element: a click that ends a long press does not start the tool. */
  guard: (onClick: () => void) => () => void;
}

/**
 * Help for a tool icon or a menu entry: right-click with a mouse, long press with a finger.
 * Returns the handlers to spread on the element, or null for an element without help.
 */
export function useHelpTrigger(topic: HelpTopic | null | undefined): HelpTriggerProps | null {
  const id = topic?.id;
  const title = topic?.title;
  const summary = topic?.summary;
  return useMemo(() => {
    if (id === undefined || title === undefined) return null;
    const open = (at: { x: number; y: number }, held: boolean): void =>
      openHelpMenu({ id, title, ...(summary !== undefined ? { summary } : {}), ...at, held });
    const press = createLongPress((at) => open(at, true));
    let pointer = "mouse";
    return {
      // Also what Android sends for a long press; opening the same menu twice changes nothing.
      onContextMenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
        open({ x: e.clientX, y: e.clientY }, pointer !== "mouse");
      },
      onPointerDown: (e) => {
        pointer = e.pointerType;
        press.onPointerDown(e);
      },
      onPointerMove: (e) => press.onPointerMove(e),
      onPointerUp: () => press.onPointerUp(),
      onPointerCancel: () => press.onPointerCancel(),
      onPointerLeave: () => press.onPointerLeave(),
      guard: (onClick) => () => {
        if (!press.consumeClick()) onClick();
      },
    };
  }, [id, title, summary]);
}
