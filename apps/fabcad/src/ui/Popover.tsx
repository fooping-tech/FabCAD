import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type Box, type Placement, type PlacementOptions, placeMenu } from "./placement";

const MARGIN = 6;

let probe: HTMLDivElement | null = null;

/** The safe-area insets (notch, home indicator), which CSS knows and scripts have to ask for. */
function safeArea(): { top: number; right: number; bottom: number; left: number } {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;width:0;height:0;" +
      "padding:env(safe-area-inset-top) env(safe-area-inset-right) " +
      "env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  const px = (v: string): number => Number.parseFloat(v) || 0;
  return {
    top: px(s.paddingTop),
    right: px(s.paddingRight),
    bottom: px(s.paddingBottom),
    left: px(s.paddingLeft),
  };
}

/**
 * The part of the window that can be seen and touched, in client coordinates: the visual
 * viewport (what is left beside an on-screen keyboard or browser bars, and while the page is
 * zoomed) without the safe-area insets.
 */
export function visibleArea(): Box {
  const vv = window.visualViewport;
  const left = vv ? vv.offsetLeft : 0;
  const top = vv ? vv.offsetTop : 0;
  const width = vv ? vv.width : window.innerWidth;
  const height = vv ? vv.height : window.innerHeight;
  const inset = safeArea();
  return {
    left: left + Math.max(MARGIN, inset.left),
    top: top + Math.max(MARGIN, inset.top),
    right: left + width - Math.max(MARGIN, inset.right),
    bottom: top + height - Math.max(MARGIN, inset.bottom),
  };
}

export type PopoverAnchor = { x: number; y: number } | (() => DOMRect | null | undefined);

/**
 * A menu or another small panel that is always inside the visible part of the window. It is
 * rendered at the end of the document, so no scrolling or clipping container (the ribbon …)
 * can cut it off, and it is placed again whenever the window, the page or the on-screen
 * keyboard changes what can be seen.
 */
export function Popover({
  anchor,
  className,
  role = "menu",
  label,
  placement,
  popoverRef,
  style,
  onContextMenu,
  children,
}: {
  /** A point (context menu) or the box of the element the popover belongs to. */
  anchor: PopoverAnchor;
  className: string;
  role?: string;
  label?: string;
  placement?: PlacementOptions;
  popoverRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const align = placement?.align;
  const gap = placement?.gap;
  const point = typeof anchor === "function" ? null : anchor;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const place = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const a = anchorRef.current;
    let box: Box;
    if (typeof a === "function") {
      const r = a();
      if (!r) return;
      box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    } else {
      box = { left: a.x, top: a.y, right: a.x, bottom: a.y };
    }
    // The size the content asks for, not the size it has while it is limited.
    const size = { width: el.offsetWidth, height: el.scrollHeight + el.offsetHeight - el.clientHeight };
    const next = placeMenu(box, size, visibleArea(), {
      ...(align ? { align } : {}),
      gap: gap ?? (typeof a === "function" ? 4 : 0),
    });
    setAt((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.maxHeight === next.maxHeight &&
      prev.maxWidth === next.maxWidth
        ? prev
        : next,
    );
  }, [align, gap]);

  useLayoutEffect(place, [place, point?.x, point?.y, children]);

  useEffect(() => {
    const vv = window.visualViewport;
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    // Capture: scrolling of any container moves the anchor.
    window.addEventListener("scroll", place, true);
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
      window.removeEventListener("scroll", place, true);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [place]);

  return createPortal(
    <div
      ref={(el) => {
        ref.current = el;
        if (typeof popoverRef === "function") popoverRef(el);
        else if (popoverRef) (popoverRef as { current: HTMLDivElement | null }).current = el;
      }}
      className={`${className} popover`}
      role={role}
      aria-label={label}
      data-side={at?.side}
      style={{
        ...style,
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        maxHeight: at?.maxHeight,
        maxWidth: at?.maxWidth,
        visibility: at ? "visible" : "hidden",
      }}
      onContextMenu={onContextMenu}
    >
      {children}
    </div>,
    document.body,
  );
}
