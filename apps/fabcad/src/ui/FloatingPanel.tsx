import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { clampInto, placeBeside } from "./placement";
import { visibleArea } from "./Popover";

type Position = { left: number; top: number };

/**
 * Where windows were dragged to, by window id, for this session: a window that was moved out
 * of the way opens there again instead of beside the next click.
 */
const moved = new Map<string, Position>();

/** Where a window goes when there is no click to open beside: the top left of the view. */
function defaultPosition(): Position {
  const main = document.querySelector(".main")?.getBoundingClientRect();
  return { left: (main?.left ?? 0) + 10, top: (main?.top ?? 0) + 10 };
}

/**
 * The window of a running command. It opens beside `anchor` (the click that started the
 * operation, in client coordinates) and stays inside the visible part of the window. Its title
 * bar drags it; a double click on the title brings it back beside the click.
 */
export function FloatingPanel({
  id,
  anchor,
  title,
  className = "",
  onClose,
  closeLabel = "Close",
  headerExtra,
  children,
}: {
  /** Remembers where the user moved this window. */
  id: string;
  anchor: { x: number; y: number } | null;
  title: ReactNode;
  className?: string;
  onClose?: () => void;
  closeLabel?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const size = (): { width: number; height: number } => {
    const el = ref.current;
    return { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 };
  };

  const place = useCallback((): void => {
    if (!ref.current || drag.current) return;
    const s = size();
    const remembered = moved.get(id);
    const next = remembered
      ? clampInto(remembered, s, visibleArea())
      : anchor
        ? placeBeside(anchor, s, visibleArea())
        : clampInto(defaultPosition(), s, visibleArea());
    setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, [id, anchor?.x, anchor?.y]);

  useLayoutEffect(place, [place]);

  // A window that grows (more fields) or a smaller screen must not push it out of view.
  useEffect(() => {
    const keepInside = (): void => {
      if (drag.current) return;
      setPos((prev) => {
        if (!prev) return prev;
        const next = clampInto(prev, size(), visibleArea());
        return next.left === prev.left && next.top === prev.top ? prev : next;
      });
    };
    const vv = window.visualViewport;
    window.addEventListener("resize", keepInside);
    vv?.addEventListener("resize", keepInside);
    const observer = new ResizeObserver(keepInside);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener("resize", keepInside);
      vv?.removeEventListener("resize", keepInside);
      observer.disconnect();
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !pos) return;
    if ((e.target as HTMLElement).closest("button, input, select, label")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, dx: e.clientX - pos.left, dy: e.clientY - pos.top };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setPos(clampInto({ left: e.clientX - d.dx, top: e.clientY - d.dy }, size(), visibleArea()));
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (pos) moved.set(id, pos);
  };

  return createPortal(
    <div
      ref={ref}
      className={`floating floating-window ${className}`}
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <div
        className="floating-title"
        title="Drag to move. Double-click to put it back beside the click."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          moved.delete(id);
          place();
        }}
      >
        <span className="floating-grip" aria-hidden="true" />
        <span className="floating-name">{title}</span>
        {headerExtra}
        {onClose && (
          <button className="icon-btn" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      {children}
    </div>,
    document.body,
  );
}
