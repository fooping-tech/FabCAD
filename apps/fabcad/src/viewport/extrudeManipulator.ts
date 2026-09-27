import { type CadDocument, evaluateAs } from "@fabcad/cad-document";
import { resolveSketchPlane } from "@fabcad/features";
import { type Plane3, type Vec2, type Vec3, add3, planeToWorld, scale3 } from "@fabcad/geometry";
import { resolveProfileRef } from "@fabcad/sketch";
import type { Dialog } from "../app/appState";
import { currentScope, sketchView } from "../app/session";
import type { ViewportScene } from "./scene";

/**
 * Distance manipulator of the Extrude command: an arrow along the sketch normal that can be
 * dragged, plus the data for the translucent preview of the result.
 */

export type ExtrudeDialog = Extract<Dialog, { type: "extrude" }>;

export interface ExtrudeManipulator {
  plane: Plane3;
  /** Foot of the arrow: a point inside the selected profiles, on the sketch plane. */
  base: Vec3;
  normal: Vec3;
  /** Signed position of the handle along the normal (mm). */
  offset: number;
  /** Extent of the extrusion along the normal. */
  from: number;
  to: number;
  /** Evaluated distance, or null while the expression is invalid. */
  distance: number | null;
  regions: { outer: Vec2[]; holes: Vec2[][] }[];
  removing: boolean;
}

export function extrudeManipulator(
  doc: CadDocument,
  dialog: ExtrudeDialog,
): ExtrudeManipulator | null {
  if (!dialog.sketchId || dialog.profiles.length === 0) return null;
  const f = doc.features[dialog.sketchId];
  if (!f || f.type !== "sketch") return null;
  const all = sketchView(f.sketch, doc).regions;
  const picked = new Map<string, (typeof all)[number]>();
  for (const ref of dialog.profiles) {
    const r = resolveProfileRef(all, ref);
    if (r) picked.set(r.id, r);
  }
  const regions = [...picked.values()];
  if (regions.length === 0) return null;

  let distance: number | null = null;
  try {
    distance = evaluateAs(dialog.distance, "length", currentScope(doc));
  } catch {
    distance = null;
  }
  const d = distance ?? 0;
  const [from, to, offset] =
    dialog.direction === "symmetric"
      ? [-d / 2, d / 2, d / 2]
      : dialog.direction === "negative"
        ? [-d, 0, -d]
        : [0, d, d];

  const plane = resolveSketchPlane(f.sketch.plane);
  // The largest profile carries the arrow.
  const main = regions.reduce((a, b) => (b.area > a.area ? b : a));
  return {
    plane,
    base: planeToWorld(plane, main.interiorPoint),
    normal: plane.normal,
    offset,
    from,
    to,
    distance,
    regions: regions.map((r) => ({ outer: r.polygon, holes: r.holePolygons })),
    removing: dialog.operation === "cut",
  };
}

/** Distance value that puts the handle at `offset` for the given direction mode. */
export function distanceForOffset(direction: ExtrudeDialog["direction"], offset: number): number {
  if (direction === "symmetric") return Math.abs(offset) * 2;
  return direction === "negative" ? -offset : offset;
}

/** Drag increment: a round number of millimetres that is a few pixels on screen. */
export function dragStep(pixelSize: number): number {
  const raw = Math.max(pixelSize * 4, 1e-6);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  return Math.max(0.1, step);
}

export function formatDistance(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

const HEAD = 26;

export interface ManipulatorScreen {
  base: { x: number; y: number };
  tip: { x: number; y: number };
  /** Centre of the arrow head, where the handle is grabbed. */
  handle: { x: number; y: number };
  /** Unit direction of the arrow on screen; null when the axis points at the viewer. */
  direction: { x: number; y: number } | null;
}

export function manipulatorScreen(scene: ViewportScene, m: ExtrudeManipulator): ManipulatorScreen {
  const tipWorld = add3(m.base, scale3(m.normal, m.offset));
  const base = scene.project(m.base);
  const tip = scene.project(tipWorld);
  // Direction of growing offset: for negative extrusions the head points away from the base.
  const sign = m.offset < 0 ? -1 : 1;
  const probe = scene.pixelSize(tipWorld) * 40;
  const ahead = scene.project(add3(tipWorld, scale3(m.normal, probe * sign)));
  const dx = ahead.x - tip.x;
  const dy = ahead.y - tip.y;
  const len = Math.hypot(dx, dy);
  const direction = len < 4 ? null : { x: dx / len, y: dy / len };
  const handle = direction
    ? { x: tip.x + direction.x * (HEAD / 2), y: tip.y + direction.y * (HEAD / 2) }
    : { x: tip.x, y: tip.y };
  return { base, tip, handle, direction };
}

export function drawManipulator(
  ctx: CanvasRenderingContext2D,
  scene: ViewportScene,
  m: ExtrudeManipulator,
  state: "idle" | "hover" | "drag",
): void {
  const s = manipulatorScreen(scene, m);
  const color = state === "idle" ? "#2f7fb8" : "#e0762a";
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.base.x, s.base.y);
  ctx.lineTo(s.tip.x, s.tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s.base.x, s.base.y, 3, 0, Math.PI * 2);
  ctx.fill();

  if (s.direction) {
    const d = s.direction;
    const n = { x: -d.y, y: d.x };
    const w = state === "idle" ? 9 : 11;
    ctx.beginPath();
    ctx.moveTo(s.tip.x + d.x * HEAD, s.tip.y + d.y * HEAD);
    ctx.lineTo(s.tip.x + n.x * w, s.tip.y + n.y * w);
    ctx.lineTo(s.tip.x - n.x * w, s.tip.y - n.y * w);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(s.tip.x, s.tip.y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // Value label next to the handle.
  const text = m.distance === null ? "?" : `${formatDistance(m.distance)} mm`;
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width + 12;
  const lx = s.handle.x + 18;
  const ly = s.handle.y;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx, ly - 10, tw, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1d2b38";
  ctx.fillText(text, lx + 6, ly + 0.5);
  ctx.restore();
}
