import type { ReactElement } from "react";

/**
 * Line icons on a 20 × 20 grid. Blue-ish accents are avoided on purpose: icons inherit the
 * text colour so that tool states are expressed by the button, not by the glyph.
 */
const P: Record<string, ReactElement> = {
  // ---- general
  select: <path d="M5 3l9.5 6.5-4.2 1 2.7 5-1.8 1-2.7-5L5 14z" />,
  undo: <path d="M7 5L3.5 8.5 7 12M4 8.5h7.5a4.5 4.5 0 010 9H8" />,
  redo: <path d="M13 5l3.5 3.5L13 12M16 8.5H8.5a4.5 4.5 0 000 9H12" />,
  save: <path d="M4 4h10l2 2v10H4zM7 4v4h6V4M7 16v-5h6v5" />,
  open: <path d="M3 6V5h5l1.5 2H17v2M3 6v10h12l2-7H5l-2 7" />,
  new: <path d="M5 3h7l3 3v11H5zM12 3v3h3M10 9v5M7.5 11.5h5" />,
  export: <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 14v3h12v-3" />,
  import: <path d="M10 12V3M6.5 6.5L10 3l3.5 3.5M4 14v3h12v-3" />,
  trash: <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5" />,
  eye: (
    <>
      <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" />
      <circle cx="10" cy="10" r="2.2" />
    </>
  ),
  "eye-off": <path d="M3 3l14 14M8.3 5.3A8 8 0 0110 5c5 0 8 5 8 5a13 13 0 01-2.4 2.9M12.5 14.5A7.5 7.5 0 0110 15c-5 0-8-5-8-5a13 13 0 013.3-3.5" />,
  caret: <path d="M7 4l6 6-6 6" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  warning: <path d="M10 3l8 14H2zM10 8v4.5M10 14.8v.4" />,
  info: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5M10 6.3v.4" />
    </>
  ),
  fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 7h6v6H7z" />,
  parameters: <path d="M4 5h4M12 5h4M4 10h8M15 10h1M4 15h2M10 15h6M10 3.5v3M13.5 8.5v3M8 13.5v3" />,
  folder: <path d="M3 5h5l1.5 2H17v9H3z" />,
  document: <path d="M5 3h7l3 3v11H5zM12 3v3h3" />,
  component: <path d="M10 2.5l6.5 3.5v8L10 17.5 3.5 14V6zM3.5 6L10 9.5 16.5 6M10 9.5v8" />,
  body: <path d="M3 7l7-3.5L17 7v7l-7 3.5L3 14zM3 7l7 3.5L17 7M10 10.5v7" />,
  origin: <path d="M10 10V3M10 10l6 4M10 10l-6 4M8.5 4.5L10 3l1.5 1.5" />,
  plane: <path d="M3 8l9-4 5 8-9 4z" />,
  axis: <path d="M4 16L16 4M12 4h4v4" />,
  sketch: <path d="M4 16V5M4 16h12M7 13l3-5 3 2.5 3-5.5" />,
  "multi-select": <path d="M3 3h6v6H3zM11 11h6v6h-6zM12.500 4l1.500 1.500L17 2.500M4.500 13.500l1.500 1.500L9 12" />,
  "offset-plane": <path d="M3 9l8-3 6 5-8 3zM3 15l8-3 6 5-8 3zM10 3.5v3M8.800 5.300l1.200 1.200 1.200-1.200" />,
  "new-sketch": <path d="M3 7l8-3.5 6 7L9 14zM14.5 13v5M12 15.5h5" />,
  finish: <path d="M4 10.5l4 4 8-9" />,
  menu: <path d="M4 6h12M4 10h12M4 14h12" />,
  more: <path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth="2.4" />,
  // ---- sketch create
  line: (
    <>
      <path d="M4 16L16 4" />
      <circle cx="4" cy="16" r="1.4" />
      <circle cx="16" cy="4" r="1.4" />
    </>
  ),
  polyline: <path d="M3 15l4-8 5 5 5-8" />,
  "construction-line": <path d="M4 16L16 4" strokeDasharray="3 2.5" />,
  "rectangle-2point": (
    <>
      <path d="M4 5h12v10H4z" />
      <circle cx="4" cy="5" r="1.3" />
      <circle cx="16" cy="15" r="1.3" />
    </>
  ),
  "rectangle-3point": (
    <>
      <path d="M3 11l8-7 6 6-8 7z" />
      <circle cx="3" cy="11" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="17" cy="10" r="1.2" />
    </>
  ),
  "rectangle-center": (
    <>
      <path d="M4 5h12v10H4z" />
      <path d="M8.5 10h3M10 8.5v3" />
    </>
  ),
  circle: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 10h.01" strokeWidth="2.2" />
    </>
  ),
  "circle-3point": (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="3.5" r="1.2" />
      <circle cx="4.4" cy="13.2" r="1.2" />
      <circle cx="15.6" cy="13.2" r="1.2" />
    </>
  ),
  "arc-center": (
    <>
      <path d="M4 14a8 8 0 0112-9" />
      <path d="M12 12h.01" strokeWidth="2.2" />
      <path d="M12 12L4 14M12 12l4-7" strokeDasharray="2 2" />
    </>
  ),
  "arc-3point": (
    <>
      <path d="M3 14a8.5 8.5 0 0114 0" />
      <circle cx="3" cy="14" r="1.2" />
      <circle cx="17" cy="14" r="1.2" />
      <circle cx="10" cy="10.3" r="1.2" />
    </>
  ),
  ellipse: <ellipse cx="10" cy="10" rx="7.5" ry="4.5" />,
  "polygon-inscribed": <path d="M10 3l6 3.5v7L10 17l-6-3.5v-7z" />,
  "polygon-circumscribed": (
    <>
      <path d="M10 3.5l5.6 3.25v6.5L10 16.5l-5.6-3.25v-6.5z" />
      <circle cx="10" cy="10" r="5.6" strokeDasharray="2 2" />
    </>
  ),
  slot: <path d="M6.5 6h7a4 4 0 010 8h-7a4 4 0 010-8z" />,
  point: (
    <>
      <path d="M10 3v4M10 13v4M3 10h4M13 10h4" />
      <circle cx="10" cy="10" r="1.3" />
    </>
  ),
  "spline-fit": (
    <>
      <path d="M3 14c3-10 5 4 8-3s3-5 6-5" />
      <circle cx="3" cy="14" r="1.2" />
      <circle cx="10.6" cy="11.3" r="1.2" />
      <circle cx="17" cy="6" r="1.2" />
    </>
  ),
  "spline-control": (
    <>
      <path d="M3 15c4-14 8 6 14-9" />
      <path d="M3 15l4-11 6 12 4-10" strokeDasharray="2 2" />
    </>
  ),
  project: (
    <>
      <path d="M4 3.5l7 2.5v5L4 8.5z" />
      <path d="M3 16.5h14" />
      <path d="M5 12v2.5M10 13.5v1M7.5 14l-2.5 0M5 14.5l-1.2-1.5M5 14.5l1.2-1.5M10 14.5l-1.2-1.5M10 14.5l1.2-1.5" />
    </>
  ),
  // ---- sketch modify
  fillet: <path d="M4 16V9a5 5 0 015-5h7" />,
  chamfer: <path d="M4 16V9l5-5h7" />,
  trim: <path d="M4 4l12 12M16 4l-5 5M4 16l2.5-2.5" />,
  extend: <path d="M3 10h9M12 10h5M17 4v12M13.5 7.5L16 10l-2.5 2.5" />,
  break: <path d="M3 13l5.5-4M11.5 11l5.5-4M9 6l2 8" />,
  offset: <path d="M4 16V8a4 4 0 014-4h8M8 16v-6a2 2 0 012-2h6" />,
  move: <path d="M10 3v14M3 10h14M7.5 5.5L10 3l2.5 2.5M7.5 14.5L10 17l2.5-2.5M5.5 7.5L3 10l2.5 2.5M14.5 7.5L17 10l-2.5 2.5" />,
  copy: <path d="M7 7h9v9H7zM4 13V4h9" />,
  search: <path d="M8.5 3.5a5 5 0 100 10 5 5 0 000-10zM12.2 12.2L17 17" />,
  scale: <path d="M4 16h7V9H4zM11 9l5-5M12.5 4H16v3.5" />,
  mirror: <path d="M10 3v14M7.5 6L3 14h4.5zM12.5 6L17 14h-4.5z" strokeDasharray="0" />,
  "rectangular-pattern": <path d="M4 4h4v4H4zM12 4h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4z" />,
  "circular-pattern": (
    <>
      <circle cx="10" cy="4.5" r="1.8" />
      <circle cx="15" cy="12.5" r="1.8" />
      <circle cx="5" cy="12.5" r="1.8" />
      <circle cx="10" cy="10" r="0.6" />
    </>
  ),
  "toggle-construction": <path d="M4 16L16 4M4 10l6-6" strokeDasharray="3 2.5" />,
  // ---- constraints
  "c-coincident": (
    <>
      <path d="M4 16l5.5-5.5" />
      <circle cx="11" cy="9" r="2.2" />
      <path d="M12.5 7.5L16 4" />
    </>
  ),
  "c-collinear": <path d="M3 13l5.5-3M11.5 8.5L17 5.5M4 16l12-6.5" strokeDasharray="0" />,
  "c-concentric": (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
    </>
  ),
  "c-midpoint": <path d="M3 14h14M10 14l-3-5h6z" />,
  "c-fix": <path d="M10 3v10M6 7h8M5 12a5 5 0 0010 0M10 17v-1" />,
  "c-parallel": <path d="M5 16L11 4M9 16l6-12" />,
  "c-perpendicular": <path d="M4 16h12M10 16V4" />,
  "c-horizontal": <path d="M3 10h14M6 6v8M14 6v8" />,
  "c-vertical": <path d="M10 3v14M6 6h8M6 14h8" />,
  "c-tangent": (
    <>
      <circle cx="9" cy="12" r="4.5" />
      <path d="M3 5.5l14 4" />
    </>
  ),
  "c-equal": <path d="M4 8h12M4 12h12" />,
  "c-symmetry": <path d="M10 3v14M7 7l-3 3 3 3M13 7l3 3-3 3" />,
  dimension: <path d="M3 5v10M17 5v10M3 10h14M6 7.5L3.5 10 6 12.5M14 7.5l2.5 2.5-2.5 2.5" />,
  // ---- solid features
  extrude: <path d="M4 13l6 3 6-3M4 13l6-3 6 3M10 10V3M7.5 5.5L10 3l2.5 2.5" />,
  revolve: <path d="M10 3v14M10 5c4 0 6 1.5 6 3.5S14 12 10 12M13 14.5c-1 .4-2 .5-3 .5M7 9.5L10 12l-3 2.5" />,
  combine: (
    <>
      <circle cx="8" cy="10" r="5" />
      <circle cx="12" cy="10" r="5" />
    </>
  ),
  shell: <path d="M3 7l7-3.5L17 7v7l-7 3.5L3 14zM6 8.5l4-2 4 2v4l-4 2-4-2z" />,
  "fillet-3d": <path d="M3 16V9a5 5 0 015-5h9M3 16h4M17 4v4" />,
  "chamfer-3d": <path d="M3 16V9l5-5h9M3 16h4M17 4v4" />,
  boolean: (
    <>
      <circle cx="8" cy="10" r="5" />
      <circle cx="12" cy="10" r="5" />
    </>
  ),
  sweep: (
    <>
      <path d="M4 16c0-7 4-11 12-11" />
      <circle cx="4" cy="16" r="2" />
      <path d="M13.5 2.5L16 5l-2.5 2.5" />
    </>
  ),
  loft: <path d="M4 16h12M7 4h6M4 16c0-5 3-7 3-12M16 16c0-5-3-7-3-12" />,
  hole: (
    <>
      <path d="M3 8l7-3.500L17 8v4l-7 3.500L3 12zM3 8l7 3.500L17 8" />
      <ellipse cx="10" cy="8" rx="2.6" ry="1.3" />
    </>
  ),
  split: <path d="M3 8l5-2.500v8L3 16zM12 6.500L17 4v8l-5 2.500zM10 2.500v15" />,
  "move-3d": (
    <>
      <path d="M8 10l4-2 4 2v4l-4 2-4-2zM8 10l4 2 4-2M12 12v4" />
      <path d="M3 5h5M6 3l2 2-2 2M4.5 9v5M2.5 12l2 2 2-2" />
    </>
  ),
  "copy-3d": (
    <>
      <path d="M8 10l4-2 4 2v4l-4 2-4-2zM8 10l4 2 4-2M12 12v4" />
      <path d="M4 12V6l4-2 4 2" />
    </>
  ),
  align: <path d="M3 4v12M6 6h5v3H6zM6 11h10v3H6z" />,
  "pattern-rectangular": (
    <>
      <path d="M3 6l3-1.500L9 6v3l-3 1.500L3 9zM11 6l3-1.500L17 6v3l-3 1.500L11 9z" />
      <path d="M3 13l3-1.500L9 13v3l-3 1.500L3 16zM11 13l3-1.5 3 1.500v3l-3 1.5-3-1.500z" strokeDasharray="1.5 1.5" />
    </>
  ),
  "pattern-circular": (
    <>
      <circle cx="10" cy="10" r="6.5" strokeDasharray="1.5 2" />
      <path d="M8 3.500l2-1 2 1v2l-2 1-2-1z" />
      <path d="M13.5 12.500l2-1 2 1v2l-2 1-2-1zM2.5 12.500l2-1 2 1v2l-2 1-2-1z" />
    </>
  ),
  "mirror-3d": (
    <>
      <path d="M10 2.500v15" strokeDasharray="2 2" />
      <path d="M3 8l4-2v8l-4 2zM17 8l-4-2v8l4 2z" />
    </>
  ),
  "arrow-up": <path d="M10 16V4M5 9l5-5 5 5" />,
  "arrow-down": <path d="M10 4v12M5 11l5 5 5-5" />,
  import3d: <path d="M3 7l7-3.5L17 7v7l-7 3.5L3 14zM10 8v6M7.5 11.5L10 14l2.5-2.5" />,
  print3d: <path d="M3 4h14M6 4v3h8V4M10 7v3M7.5 10h5l1 2h-7zM5 17h10M6.5 14.5h7" />,
  text: <path d="M4 5V4h12v1M10 4v12M7.5 16h5" />,
  explode: <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2" />,
  measure: <path d="M2.5 13.5l11-11 4 4-11 11zM6 10l1.5 1.5M8.5 7.500L10 9M11 5l1.5 1.500" />,
  laser: <path d="M10 2v7M10 9l-4 8h8zM3 17h14" />,
};

export type IconName = string;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name] ?? <circle cx="10" cy="10" r="6" />}
    </svg>
  );
}

export const hasIcon = (name: string): boolean => name in P;
