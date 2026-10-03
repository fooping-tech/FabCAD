import { type Plane3, type Vec3, add3, cross3, scale3 } from "@fabcad/geometry";
import type { AngularHandle, DialogHandle, LinearHandle } from "../app/dialogHandles";
import { formatValue } from "../app/moveTransform";
import type { ViewportScene } from "./scene";

/**
 * The handles of `dialogHandles` on screen: an arrow to drag a length (Extrude, Offset Plane,
 * Hole depth, Shell, Fillet, Chamfer, pattern spacing), a ring with a knob to drag an angle
 * (Revolve, Circular Pattern).
 */

const HEAD = 26;
const IDLE = "#2f7fb8";
const ACTIVE = "#e0762a";
const RING_PX = 70;

type Point = { x: number; y: number };

export interface ArrowScreen {
  base: Point;
  tip: Point;
  /** Centre of the arrow head, where the handle is grabbed. */
  handle: Point;
  /** Unit direction of the arrow on screen; null when the axis points at the viewer. */
  direction: Point | null;
}

export const tipOf = (h: LinearHandle): Vec3 => add3(h.origin, scale3(h.direction, h.factor * h.value));

export function arrowScreen(scene: ViewportScene, h: LinearHandle): ArrowScreen {
  const tipWorld = tipOf(h);
  const base = scene.project(h.origin);
  const tip = scene.project(tipWorld);
  // The head points the way the tip goes as the value grows.
  const sign = h.factor * h.value < 0 ? -1 : 1;
  const probe = scene.pixelSize(tipWorld) * 40;
  const ahead = scene.project(add3(tipWorld, scale3(h.direction, probe * sign)));
  const dx = ahead.x - tip.x;
  const dy = ahead.y - tip.y;
  const len = Math.hypot(dx, dy);
  const direction = len < 4 ? null : { x: dx / len, y: dy / len };
  const handle = direction
    ? { x: tip.x + direction.x * (HEAD / 2), y: tip.y + direction.y * (HEAD / 2) }
    : { x: tip.x, y: tip.y };
  return { base, tip, handle, direction };
}

/** The plane of a ring: x along the zero angle, counter-clockwise about the axis. */
export const ringPlaneOf = (h: AngularHandle): Plane3 => ({
  origin: h.center,
  xDir: h.reference,
  yDir: cross3(h.axis, h.reference),
  normal: h.axis,
});

/** Ring radius in mm: the distance of what turns, kept to a size that can be grabbed. */
function ringRadius(scene: ViewportScene, h: AngularHandle): number {
  const px = scene.pixelSize(h.center);
  const r = h.radius ?? RING_PX * px;
  return Math.min(Math.max(r, 40 * px), 320 * px);
}

const ringPoint = (h: AngularHandle, radius: number, degrees: number): Vec3 => {
  const a = (degrees * Math.PI) / 180;
  const plane = ringPlaneOf(h);
  return add3(h.center, add3(scale3(plane.xDir, radius * Math.cos(a)), scale3(plane.yDir, radius * Math.sin(a))));
};

export interface RingScreen {
  center: Point;
  ring: Point[];
  /** From the zero angle to the value. */
  arc: Point[];
  zero: Point;
  knob: Point;
}

export function ringScreen(scene: ViewportScene, h: AngularHandle): RingScreen {
  const r = ringRadius(scene, h);
  const ring: Point[] = [];
  for (let i = 0; i <= 72; i++) ring.push(scene.project(ringPoint(h, r, i * 5)));
  const arc: Point[] = [];
  const steps = Math.max(2, Math.ceil(Math.abs(h.value) / 4));
  for (let i = 0; i <= steps; i++) arc.push(scene.project(ringPoint(h, r, (h.value * i) / steps)));
  return {
    center: scene.project(h.center),
    ring,
    arc,
    zero: scene.project(ringPoint(h, r, 0)),
    knob: scene.project(ringPoint(h, r, h.value)),
  };
}

const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** The handle under a pixel: an arrow head, a knob, or (less eagerly) the line of a ring. */
export function handleAt(
  scene: ViewportScene,
  handles: DialogHandle[],
  x: number,
  y: number,
  reach: number,
): DialogHandle | null {
  let best: { h: DialogHandle; d: number } | null = null;
  const consider = (h: DialogHandle, d: number): void => {
    if (d <= reach && (!best || d < best.d)) best = { h, d };
  };
  for (const h of handles) {
    if (h.kind === "linear") {
      const s = arrowScreen(scene, h);
      consider(h, Math.hypot(s.handle.x - x, s.handle.y - y));
    } else {
      const s = ringScreen(scene, h);
      consider(h, Math.hypot(s.knob.x - x, s.knob.y - y));
      let d = Infinity;
      for (let i = 0; i + 1 < s.ring.length; i++) d = Math.min(d, segmentDistance({ x, y }, s.ring[i]!, s.ring[i + 1]!));
      consider(h, d + reach / 2);
    }
  }
  return (best as { h: DialogHandle } | null)?.h ?? null;
}

/** Screen point to grab a handle by, for automated tests. */
export function handlePoint(scene: ViewportScene, h: DialogHandle): Point {
  return h.kind === "linear" ? arrowScreen(scene, h).handle : ringScreen(scene, h).knob;
}

function label(ctx: CanvasRenderingContext2D, text: string, at: Point, color: string): void {
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(text).width + 12;
  const lx = at.x + 18;
  const ly = at.y;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx, ly - 10, tw, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1d2b38";
  ctx.fillText(text, lx + 6, ly + 0.5);
}

const polyline = (ctx: CanvasRenderingContext2D, points: Point[]): void => {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
};

export function drawHandle(
  ctx: CanvasRenderingContext2D,
  scene: ViewportScene,
  h: DialogHandle,
  state: "idle" | "hover" | "drag",
): void {
  const color = state === "idle" ? IDLE : ACTIVE;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (h.kind === "linear") {
    const s = arrowScreen(scene, h);
    ctx.lineWidth = 2;
    polyline(ctx, [s.base, s.tip]);
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
    label(ctx, `${formatValue(h.value)} mm`, s.handle, color);
  } else {
    const s = ringScreen(scene, h);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    polyline(ctx, s.ring);
    polyline(ctx, [s.center, s.zero]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = state === "idle" ? 3 : 4;
    polyline(ctx, s.arc);
    ctx.lineWidth = 1.5;
    polyline(ctx, [s.center, s.knob]);
    ctx.beginPath();
    ctx.arc(s.knob.x, s.knob.y, state === "idle" ? 7 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    label(ctx, `${formatValue(h.value)}°`, s.knob, color);
  }
  ctx.restore();
}

/** Angle (degrees) of a pixel seen on the plane of a ring, from its zero direction. */
export function angleOnRing(scene: ViewportScene, h: AngularHandle, x: number, y: number): number | null {
  const p = scene.pointOnPlane(x, y, ringPlaneOf(h));
  if (!p || Math.hypot(p.x, p.y) < 1e-9) return null;
  return (Math.atan2(p.y, p.x) * 180) / Math.PI;
}
