/**
 * Where a menu goes so that all of it can be seen and reached. Pure geometry: the caller
 * measures the menu and the visible area, which keeps this testable without a browser.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Height left for the menu; it scrolls when its content is taller. */
  maxHeight: number;
  /** Width left for the menu. */
  maxWidth: number;
  /** Side of the anchor the menu ended up on. */
  side: "below" | "above";
}

export interface PlacementOptions {
  /** Distance between the anchor and the menu. */
  gap?: number;
  /** Which edge of the anchor the menu lines up with. */
  align?: "left" | "right";
  /** Smallest height worth showing a menu in: with less on both sides it covers the anchor. */
  minHeight?: number;
}

/**
 * Place a menu of `size` next to `anchor` inside `visible`.
 *
 * Below the anchor when it fits, above when only that fits, otherwise on the side with more
 * room and limited to that room. Horizontally it lines up with the anchor and is then shifted
 * until it lies inside the visible area. A point is an anchor of no size.
 */
export function placeMenu(
  anchor: Box,
  size: { width: number; height: number },
  visible: Box,
  options: PlacementOptions = {},
): Placement {
  const gap = options.gap ?? 4;
  const minHeight = options.minHeight ?? 120;
  const room = Math.max(0, visible.bottom - visible.top);
  const maxWidth = Math.max(0, visible.right - visible.left);
  const width = Math.min(size.width, maxWidth);

  const below = Math.max(0, visible.bottom - (anchor.bottom + gap));
  const above = Math.max(0, anchor.top - gap - visible.top);
  let side: Placement["side"];
  if (size.height <= below) side = "below";
  else if (size.height <= above) side = "above";
  else side = below >= above ? "below" : "above";
  // Neither side has room worth using (the anchor fills the screen, or lies outside it):
  // the menu takes the whole visible height.
  const cramped = Math.max(below, above) < Math.min(minHeight, size.height);
  const maxHeight = cramped ? room : side === "below" ? below : above;
  const height = Math.min(size.height, maxHeight);

  let top: number;
  if (cramped) top = visible.top + Math.max(0, (room - height) / 2);
  else if (side === "below") top = anchor.bottom + gap;
  else top = anchor.top - gap - height;
  top = Math.min(Math.max(top, visible.top), Math.max(visible.top, visible.bottom - height));

  let left = options.align === "right" ? anchor.right - width : anchor.left;
  left = Math.min(Math.max(left, visible.left), Math.max(visible.left, visible.right - width));

  return { left, top, maxHeight, maxWidth, side };
}

/**
 * Move a window of `size` with its top left corner at `at` so that all of it lies inside
 * `visible`. A window larger than the area keeps its top left corner visible.
 */
export function clampInto(
  at: { left: number; top: number },
  size: { width: number; height: number },
  visible: Box,
): { left: number; top: number } {
  const left = Math.max(visible.left, Math.min(at.left, visible.right - size.width));
  const top = Math.max(visible.top, Math.min(at.top, visible.bottom - size.height));
  return { left, top };
}

/**
 * Place a window of `size` beside a clicked point, inside `visible`: right of and below the
 * point so that the point stays in view, left of it when there is no room on the right, and
 * above it when there is none below.
 */
export function placeBeside(
  point: { x: number; y: number },
  size: { width: number; height: number },
  visible: Box,
  gap = 28,
): { left: number; top: number } {
  let left = point.x + gap;
  if (left + size.width > visible.right && point.x - gap - size.width >= visible.left) {
    left = point.x - gap - size.width;
  }
  let top = point.y + gap;
  if (top + size.height > visible.bottom && point.y - gap - size.height >= visible.top) {
    top = point.y - gap - size.height;
  }
  return clampInto({ left, top }, size, visible);
}
