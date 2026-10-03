import { type Plane3, type Vec3, add3, makePlane, scale3 } from "@fabcad/geometry";
import { type MoveGizmo, worldAxis } from "../app/moveTransform";
import type { ViewportScene } from "./scene";

/**
 * Manipulator of the Move command, as in Fusion: arrows along the world axes to drag the
 * bodies, rings about them to turn the bodies. A rotation about a picked axis has one ring.
 * Sizes are in pixels, so the manipulator looks the same at every zoom.
 */

/** What can be grabbed: an arrow or ring of a world axis (0, 1, 2), or the ring of the picked axis. */
export type GizmoPart =
  | { kind: "arrow"; axis: number }
  | { kind: "ring"; axis: number }
  | { kind: "axis-ring" };

const ARROW = 96;
const HEAD = 16;
const RING = 64;
const COLORS = ["#d6453d", "#3a9a4a", "#2f7fb8"];
const ACTIVE = "#e0762a";

export const samePart = (a: GizmoPart | null, b: GizmoPart | null): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind === "axis-ring" || a.axis === (b as { axis: number }).axis);

/** The plane of a ring: through the centre, square to its axis, right-handed about it. */
export function ringPlane(center: Vec3, direction: Vec3): Plane3 {
  return makePlane(center, direction);
}

export function partDirection(gizmo: MoveGizmo, part: GizmoPart): Vec3 {
  return part.kind === "axis-ring" ? gizmo.axis!.direction : worldAxis(part.axis);
}

interface ScreenPart {
  part: GizmoPart;
  color: string;
  /** Polyline on screen; an arrow is its shaft. */
  points: { x: number; y: number }[];
  /** Tip and unit direction of an arrow head on screen. */
  head?: { x: number; y: number; dx: number; dy: number };
}

function screenParts(scene: ViewportScene, gizmo: MoveGizmo): ScreenPart[] {
  const px = scene.pixelSize(gizmo.center);
  const out: ScreenPart[] = [];
  const ring = (part: GizmoPart, direction: Vec3, color: string): void => {
    const plane = ringPlane(gizmo.center, direction);
    const points = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const p = add3(
        gizmo.center,
        add3(scale3(plane.xDir, Math.cos(a) * RING * px), scale3(plane.yDir, Math.sin(a) * RING * px)),
      );
      points.push(scene.project(p));
    }
    out.push({ part, color, points });
  };
  if (gizmo.rings) for (let i = 0; i < 3; i++) ring({ kind: "ring", axis: i }, worldAxis(i), COLORS[i]!);
  if (gizmo.axis) ring({ kind: "axis-ring" }, gizmo.axis.direction, COLORS[2]!);
  if (gizmo.arrows) {
    const base = scene.project(gizmo.center);
    for (let i = 0; i < 3; i++) {
      const tip = scene.project(add3(gizmo.center, scale3(worldAxis(i), ARROW * px)));
      const dx = tip.x - base.x;
      const dy = tip.y - base.y;
      const len = Math.hypot(dx, dy);
      // An axis that points at the viewer cannot be dragged along.
      if (len < 12) continue;
      out.push({
        part: { kind: "arrow", axis: i },
        color: COLORS[i]!,
        points: [base, tip],
        head: { x: tip.x, y: tip.y, dx: dx / len, dy: dy / len },
      });
    }
  }
  return out;
}

const segmentDistance = (
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** The part under a pixel. Arrows win over rings where they cross. */
export function gizmoPartAt(
  scene: ViewportScene,
  gizmo: MoveGizmo,
  x: number,
  y: number,
  reach: number,
): GizmoPart | null {
  let best: { part: GizmoPart; d: number } | null = null;
  for (const s of screenParts(scene, gizmo)) {
    let d = Infinity;
    if (s.head) {
      const end = { x: s.head.x + s.head.dx * HEAD, y: s.head.y + s.head.dy * HEAD };
      d = segmentDistance({ x, y }, s.points[0]!, end) - 2;
    } else {
      for (let i = 0; i + 1 < s.points.length; i++) {
        d = Math.min(d, segmentDistance({ x, y }, s.points[i]!, s.points[i + 1]!));
      }
    }
    if (d <= reach && (!best || d < best.d)) best = { part: s.part, d };
  }
  return best?.part ?? null;
}

/** Screen position of a part, for automated tests: the arrow head, or a point on the ring. */
export function gizmoPartPoint(
  scene: ViewportScene,
  gizmo: MoveGizmo,
  part: GizmoPart,
): { x: number; y: number } | null {
  const s = screenParts(scene, gizmo).find((p) => samePart(p.part, part));
  if (!s) return null;
  if (s.head) return { x: s.head.x + s.head.dx * (HEAD / 2), y: s.head.y + s.head.dy * (HEAD / 2) };
  // The ring point farthest from the centre on screen is the easiest to hit.
  const c = scene.project(gizmo.center);
  return s.points.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) > Math.hypot(a.x - c.x, a.y - c.y) ? b : a));
}

export function drawMoveGizmo(
  ctx: CanvasRenderingContext2D,
  scene: ViewportScene,
  gizmo: MoveGizmo,
  hover: GizmoPart | null,
  active: GizmoPart | null,
  label: string | null,
): void {
  const parts = screenParts(scene, gizmo);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Rings first, so that the arrows stay on top.
  for (const s of [...parts.filter((p) => !p.head), ...parts.filter((p) => p.head)]) {
    const lit = samePart(s.part, active) || (!active && samePart(s.part, hover));
    const color = lit ? ACTIVE : s.color;
    const dimmed = active && !lit;
    ctx.globalAlpha = dimmed ? 0.35 : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lit ? 3 : 2;
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    if (s.head) {
      const { x, y, dx, dy } = s.head;
      const w = lit ? 8 : 6.5;
      ctx.beginPath();
      ctx.moveTo(x + dx * HEAD, y + dy * HEAD);
      ctx.lineTo(x - dy * w, y + dx * w);
      ctx.lineTo(x + dy * w, y - dx * w);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const c = scene.project(gizmo.center);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#1d2b38";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (label) {
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width + 12;
    const lx = c.x + 14;
    const ly = c.y - RING - 14;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = ACTIVE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(lx, ly - 10, tw, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1d2b38";
    ctx.fillText(label, lx + 6, ly + 0.5);
  }
  ctx.restore();
}

/** Angle (degrees, counter-clockwise about the ring axis) of a pixel seen on the ring plane. */
export function ringAngle(scene: ViewportScene, plane: Plane3, x: number, y: number): number | null {
  const p = scene.pointOnPlane(x, y, plane);
  if (!p || Math.hypot(p.x, p.y) < 1e-9) return null;
  return (Math.atan2(p.y, p.x) * 180) / Math.PI;
}
