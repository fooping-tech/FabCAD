import type { ShapeTransform } from "@fabcad/brep";
import {
  type CadDocument,
  type PatternAxis,
  type Point3Ref,
  type Scope,
  evaluateAs,
} from "@fabcad/cad-document";
import {
  freeMoveSteps,
  resolveEdgeRef,
  resolveSketchPlane,
  resolveVertexRef,
} from "@fabcad/features";
import {
  type Vec3,
  add3,
  cross3,
  dot3,
  len3,
  norm3,
  planeToWorld,
  scale3,
  sub3,
} from "@fabcad/geometry";
import { edgePolyline } from "@fabcad/brep";
import type { MoveDialog } from "./appState";
import type { BodyModel } from "./session";
import { dialogFromFeature } from "./solidDialogs";

/**
 * What the Move dialog does to the bodies, as a matrix: for the translucent preview and the
 * manipulator. Pure: the document, the evaluated bodies and the scope come in as arguments.
 * The feature engine does the real move; this mirrors it for the parts the dialog shows.
 */

/** 4 × 4 matrix, column-major (as Three.js stores it). */
export type Mat4 = number[];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Inverse of a rotation followed by a translation. */
export function invertRigid(m: Mat4): Mat4 {
  // Rᵀ in the upper left, −Rᵀ·t in the last column.
  const out = IDENTITY.slice();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = m[r * 4 + c]!;
  const t = { x: m[12]!, y: m[13]!, z: m[14]! };
  for (let r = 0; r < 3; r++) {
    out[12 + r] = -(out[r]! * t.x + out[4 + r]! * t.y + out[8 + r]! * t.z);
  }
  return out;
}

export const applyMatrix = (m: Mat4, p: Vec3): Vec3 => ({
  x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
  y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
  z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
});

/** Rotation by `angle` degrees, counter-clockwise about `axis` through `origin`. */
export function rotationMatrix(origin: Vec3, axis: Vec3, angle: number): Mat4 {
  const { x, y, z } = norm3(axis);
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // Rows of the rotation (Rodrigues).
  const r = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  const m = IDENTITY.slice();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = r[i]![j]!;
  // Keep the origin where it is: p' = R (p − o) + o.
  const moved = applyMatrix(m, origin);
  m[12] = origin.x - moved.x;
  m[13] = origin.y - moved.y;
  m[14] = origin.z - moved.z;
  return m;
}

export const translationMatrix = (v: Vec3): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, v.z, 1];

/** The matrix of transform steps applied in order. */
export function stepsMatrix(steps: ShapeTransform[]): Mat4 {
  let m = IDENTITY;
  for (const s of steps) {
    const step =
      s.type === "translate"
        ? translationMatrix(s.vector)
        : s.type === "rotate"
          ? rotationMatrix(s.origin, s.axis, s.angle)
          : null;
    if (step) m = multiply(step, m);
  }
  return m;
}

/**
 * Angles about the world X, Y and Z axes (applied in that order, degrees) of the rotation part
 * of `m`: the inverse of `freeMoveSteps` for its rotation.
 */
export function anglesOf(m: Mat4): Vec3 {
  // R = Rz · Ry · Rx; element (row i, column j) is m[j * 4 + i].
  const r20 = m[2]!;
  const deg = (v: number): number => (v * 180) / Math.PI;
  const y = Math.asin(Math.max(-1, Math.min(1, -r20)));
  if (Math.abs(r20) < 1 - 1e-9) {
    return { x: deg(Math.atan2(m[6]!, m[10]!)), y: deg(y), z: deg(Math.atan2(m[1]!, m[0]!)) };
  }
  // Gimbal lock: only the sum (or difference) of X and Z counts; put it all on X.
  return { x: deg(Math.atan2(-m[9]!, m[5]!)), y: deg(y), z: 0 };
}

const AXES: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];
export const worldAxis = (i: number): Vec3 => AXES[i]!;

/**
 * The free move angles after turning the bodies by `delta` degrees about world axis `axis`
 * (0, 1, 2 for X, Y, Z) through the pivot. Where the turn adds to one angle only, only that
 * angle changes; otherwise the three are worked out again from the combined rotation.
 */
export function turnAngles(start: Vec3, axis: number, delta: number): Vec3 {
  const zero = (v: number): boolean => Math.abs(v) < 1e-9;
  // Rz · Ry · Rx: a turn about Z goes in front; about Y it does while there is no Z turn, etc.
  if (axis === 2) return { ...start, z: start.z + delta };
  if (axis === 1 && zero(start.z)) return { ...start, y: start.y + delta };
  if (axis === 0 && zero(start.y) && zero(start.z)) return { ...start, x: start.x + delta };
  const origin = { x: 0, y: 0, z: 0 };
  const current = stepsMatrix(freeMoveSteps(origin, origin, start));
  return anglesOf(multiply(rotationMatrix(origin, worldAxis(axis), delta), current));
}

/** Centre of the bounding box of the bodies, as they are shown now. */
export function bodiesCenter(bodies: Record<string, BodyModel>, ids: string[]): Vec3 | null {
  let lo: Vec3 | null = null;
  let hi: Vec3 | null = null;
  for (const id of ids) {
    const b = bodies[id]?.geometry.bounds;
    if (!b) continue;
    lo = lo ? { x: Math.min(lo.x, b.min.x), y: Math.min(lo.y, b.min.y), z: Math.min(lo.z, b.min.z) } : b.min;
    hi = hi ? { x: Math.max(hi.x, b.max.x), y: Math.max(hi.y, b.max.y), z: Math.max(hi.z, b.max.z) } : b.max;
  }
  return lo && hi ? scale3(add3(lo, hi), 0.5) : null;
}

export interface MoveContext {
  doc: CadDocument;
  bodies: Record<string, BodyModel>;
  scope: Scope;
}

const number = (expression: string, kind: "length" | "angle", scope: Scope): number | null => {
  try {
    const v = evaluateAs(expression, kind, scope);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

/** Axis of a rotation, as the feature engine finds it. Null when it cannot be resolved. */
export function resolveMoveAxis(
  axis: PatternAxis,
  ctx: MoveContext,
): { origin: Vec3; direction: Vec3 } | null {
  if (axis.type === "origin-axis") {
    return { origin: { x: 0, y: 0, z: 0 }, direction: worldAxis("XYZ".indexOf(axis.axis)) };
  }
  if (axis.type === "sketch-line") {
    const f = ctx.doc.features[axis.sketchId];
    if (f?.type !== "sketch") return null;
    const line = f.sketch.entities[axis.entityId];
    if (line?.type !== "line") return null;
    const a = f.sketch.entities[line.p1];
    const b = f.sketch.entities[line.p2];
    if (a?.type !== "point" || b?.type !== "point") return null;
    const plane = resolveSketchPlane(f.sketch.plane);
    const from = planeToWorld(plane, a);
    const to = planeToWorld(plane, b);
    return len3(sub3(to, from)) > 1e-9 ? { origin: from, direction: norm3(sub3(to, from)) } : null;
  }
  const body = ctx.bodies[axis.bodyId];
  const found = body ? resolveEdgeRef(axis.ref, body) : null;
  const edge = found && body ? body.geometry.edges[found.index] : undefined;
  if (!edge || !body) return null;
  if (edge.curve === "line" && len3(sub3(edge.to, edge.from)) > 1e-9) {
    return { origin: edge.from, direction: norm3(sub3(edge.to, edge.from)) };
  }
  if (edge.curve === "circle" && edge.center) {
    const pts = edgePolyline(body.geometry, edge);
    const a = pts[0];
    const b = pts[Math.floor(pts.length / 3)];
    const c = pts[Math.floor((2 * pts.length) / 3)];
    const normal = a && b && c ? cross3(sub3(b, a), sub3(c, a)) : null;
    if (normal && len3(normal) > 1e-12) return { origin: edge.center, direction: norm3(normal) };
  }
  return null;
}

export function resolvePoint(ref: Point3Ref, ctx: MoveContext): Vec3 | null {
  if (ref.type === "fixed") return ref.point;
  if (ref.type === "sketch-point") {
    const f = ctx.doc.features[ref.sketchId];
    const e = f?.type === "sketch" ? f.sketch.entities[ref.entityId] : undefined;
    return f?.type === "sketch" && e?.type === "point"
      ? planeToWorld(resolveSketchPlane(f.sketch.plane), e)
      : null;
  }
  const body = ctx.bodies[ref.bodyId];
  return body ? resolveVertexRef(ref, body) : null;
}

/** The pivot of a free move: the stored one, or the centre of the bodies. */
export const movePivot = (dialog: MoveDialog, ctx: MoveContext): Vec3 | null =>
  dialog.pivot ?? bodiesCenter(ctx.bodies, dialog.bodyIds);

/** The steps the dialog stands for now; null while an input is missing or not a number. */
export function moveSteps(dialog: MoveDialog, ctx: MoveContext): ShapeTransform[] | null {
  const { scope } = ctx;
  if (dialog.mode === "translate" || dialog.mode === "free") {
    const t = { x: number(dialog.x, "length", scope), y: number(dialog.y, "length", scope), z: number(dialog.z, "length", scope) };
    if (t.x === null || t.y === null || t.z === null) return null;
    const vector = { x: t.x, y: t.y, z: t.z };
    if (dialog.mode === "translate") return [{ type: "translate", vector }];
    const r = { x: number(dialog.rx, "angle", scope), y: number(dialog.ry, "angle", scope), z: number(dialog.rz, "angle", scope) };
    const pivot = movePivot(dialog, ctx);
    if (r.x === null || r.y === null || r.z === null || !pivot) return null;
    return freeMoveSteps(pivot, vector, { x: r.x, y: r.y, z: r.z });
  }
  if (dialog.mode === "rotate") {
    const axis = dialog.axis ? resolveMoveAxis(dialog.axis, ctx) : null;
    const angle = number(dialog.angle, "angle", scope);
    if (!axis || angle === null) return null;
    return [{ type: "rotate", origin: axis.origin, axis: axis.direction, angle }];
  }
  const from = dialog.from ? resolvePoint(dialog.from, ctx) : null;
  const to = dialog.to ? resolvePoint(dialog.to, ctx) : null;
  return from && to ? [{ type: "translate", vector: sub3(to, from) }] : null;
}

export interface MovePreview {
  /** Applied to the bodies as they are shown, gives where the dialog puts them. */
  matrix: Mat4;
  /** The whole move from where the bodies were before the feature. */
  move: Mat4;
}

/**
 * The preview of the dialog. When an existing move (not a copy) is edited, the bodies are shown
 * where the feature put them: the preview is the change from that move to the new one.
 */
export function movePreview(dialog: MoveDialog, ctx: MoveContext): MovePreview | null {
  const steps = moveSteps(dialog, ctx);
  if (!steps) return null;
  const move = stepsMatrix(steps);
  const feature = dialog.editing ? ctx.doc.features[dialog.editing] : undefined;
  if (feature?.type !== "move" || feature.copy) return { matrix: move, move };
  const before = dialogFromFeature(feature);
  const old = before?.type === "move" ? moveSteps(before, ctx) : null;
  return { matrix: old ? multiply(move, invertRigid(stepsMatrix(old))) : move, move };
}

/** The manipulator of the dialog: where it stands and what it can turn about. */
export interface MoveGizmo {
  center: Vec3;
  /** Arrows along the world axes. */
  arrows: boolean;
  /** Rings about the world X, Y and Z axes (free move). */
  rings: boolean;
  /** The ring of a rotation about a picked axis. */
  axis: { origin: Vec3; direction: Vec3 } | null;
}

export function moveGizmo(dialog: MoveDialog, ctx: MoveContext): MoveGizmo | null {
  if (dialog.bodyIds.length === 0 || dialog.mode === "point-to-point") return null;
  const preview = movePreview(dialog, ctx);
  if (dialog.mode === "free") {
    const pivot = movePivot(dialog, ctx);
    if (!pivot) return null;
    // The pivot as moved: rotations about it leave it in place, the translation carries it.
    const center = preview ? applyMatrix(preview.move, pivot) : pivot;
    return { center, arrows: true, rings: true, axis: null };
  }
  const shown = bodiesCenter(ctx.bodies, dialog.bodyIds);
  if (!shown) return null;
  if (dialog.mode === "translate") {
    return { center: preview ? applyMatrix(preview.matrix, shown) : shown, arrows: true, rings: false, axis: null };
  }
  const axis = dialog.axis ? resolveMoveAxis(dialog.axis, ctx) : null;
  if (!axis) return null;
  // The ring stands on the axis, level with the bodies.
  const foot = add3(axis.origin, scale3(axis.direction, dot3(sub3(shown, axis.origin), axis.direction)));
  return { center: foot, arrows: false, rings: false, axis };
}

/** Round a value typed back into the dialog: no float noise, no negative zero. */
export function formatValue(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
