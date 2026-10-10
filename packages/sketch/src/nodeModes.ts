import { type Vec2 } from "@fabcad/geometry";
import { SketchBuilder, entityPointIds, getPoint } from "./edit";
import type { EntityId, Sketch } from "./model";

/** Corner is implicit to preserve compatibility with existing sketches. */
export type NodeMode = "corner" | "smooth" | "symmetric" | "sharp";
export interface NodeDragTarget {
  pointId: EntityId;
  target: Vec2;
}

export interface NodeHandlePair {
  /** Cubic entering the anchor. Its second control point is the incoming handle. */
  incoming: EntityId;
  /** Cubic leaving the anchor. Its first control point is the outgoing handle. */
  outgoing: EntityId;
}

const length = (p: Vec2): number => Math.hypot(p.x, p.y);
const diff = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });
const scaled = (v: Vec2, f: number): Vec2 => ({ x: v.x * f, y: v.y * f });

/** A smooth node needs exactly two adjacent editable cubic spans and no other incident curve. */
export function nodeHandlePair(sketch: Sketch, anchorId: EntityId): NodeHandlePair | null {
  if (sketch.entities[anchorId]?.type !== "point") return null;
  const projected = new Set(sketch.projections.flatMap((p) => p.entityIds));
  const attached = Object.values(sketch.entities).filter(
    (e) => e.type !== "point" && !projected.has(e.id) && entityPointIds(e).includes(anchorId),
  );
  if (attached.length !== 2) return null;
  let incoming: EntityId | null = null;
  let outgoing: EntityId | null = null;
  for (const entity of attached) {
    if (entity.type !== "spline" || entity.kind !== "control" || entity.points.length !== 4) return null;
    if (entity.points[3] === anchorId && entity.points[0] !== anchorId) {
      if (incoming !== null) return null;
      incoming = entity.points[2]!;
    } else if (entity.points[0] === anchorId && entity.points[3] !== anchorId) {
      if (outgoing !== null) return null;
      outgoing = entity.points[1]!;
    } else return null;
  }
  return incoming && outgoing && incoming !== outgoing ? { incoming, outgoing } : null;
}

/** Choose the node mode and immediately reshape the two tangents, or collapse them for Sharp. */
export function setNodeMode(sketch: Sketch, anchorId: EntityId, mode: NodeMode): Sketch {
  if (sketch.entities[anchorId]?.type !== "point") return sketch;
  const pair = nodeHandlePair(sketch, anchorId);
  if (!pair) return sketch;
  const current = sketch.nodeModes?.[anchorId] ?? "corner";
  if (mode === current) return sketch;

  const b = new SketchBuilder(sketch);
  if (mode === "sharp") {
    const at = getPoint(sketch, anchorId);
    b.movePoint(pair.incoming, at);
    b.movePoint(pair.outgoing, at);
  } else if (mode !== "corner") {
    const at = getPoint(sketch, anchorId);
    const inPos = getPoint(sketch, pair.incoming);
    const outPos = getPoint(sketch, pair.outgoing);
    const incomingVector = diff(at, inPos);
    const outgoingVector = diff(outPos, at);
    const inLength = length(incomingVector);
    const outLength = length(outgoingVector);
    // Follow the outgoing tangent when available; fall back to the incoming tangent.
    const tangent = outLength > 1e-9
      ? scaled(outgoingVector, 1 / outLength)
      : inLength > 1e-9 ? scaled(incomingVector, 1 / inLength) : { x: 1, y: 0 };
    const symmetricLength = (inLength + outLength) / 2;
    b.movePoint(pair.incoming, shift(at, scaled(tangent, -(mode === "symmetric" ? symmetricLength : inLength))));
    b.movePoint(pair.outgoing, shift(at, scaled(tangent, mode === "symmetric" ? symmetricLength : outLength)));
  }
  const modes = { ...sketch.nodeModes };
  if (mode === "corner") delete modes[anchorId];
  else modes[anchorId] = mode;
  return { ...b.build(), nodeModes: modes };
}

/**
 * Expand a drag into the neighbouring Bézier handles.
 *
 * - Moving an anchor carries its attached handles by the same displacement, regardless of mode.
 * - Moving a handle on Smooth keeps the opposite tangent collinear at its previous length.
 * - Moving a handle on Symmetric also keeps the opposite length equal.
 * - Corner handles remain independent. Sharp handles remain at their anchor until edited.
 *
 * Explicit user-dragged points always take priority over generated targets.
 */
export function expandNodeDrag(sketch: Sketch, direct: NodeDragTarget[]): NodeDragTarget[] {
  const explicit = new Map(direct.map((t) => [t.pointId, t.target]));
  const targets = new Map(explicit);
  const projected = new Set(sketch.projections.flatMap((p) => p.entityIds));

  // Moving the node translates handles with it, including corners and end nodes.
  for (const [anchorId, position] of explicit) {
    if (sketch.entities[anchorId]?.type !== "point") continue;
    const delta = diff(position, getPoint(sketch, anchorId));
    for (const entity of Object.values(sketch.entities)) {
      if (entity.type !== "spline" || entity.kind !== "control" || entity.points.length !== 4 || projected.has(entity.id)) continue;
      let handle: EntityId | undefined;
      if (entity.points[0] === anchorId) handle = entity.points[1];
      else if (entity.points[3] === anchorId) handle = entity.points[2];
      if (handle && !explicit.has(handle)) targets.set(handle, shift(getPoint(sketch, handle), delta));
    }
  }

  // Handle drag: automatically move the opposite handle for smooth/symmetric joins.
  for (const [anchorId, mode] of Object.entries(sketch.nodeModes ?? {})) {
    if (mode !== "smooth" && mode !== "symmetric") continue;
    const pair = nodeHandlePair(sketch, anchorId);
    if (!pair) continue;
    const incomingDragged = explicit.has(pair.incoming);
    const outgoingDragged = explicit.has(pair.outgoing);
    if (incomingDragged === outgoingDragged) continue;
    const at = targets.get(anchorId) ?? getPoint(sketch, anchorId);
    const moved = incomingDragged ? pair.incoming : pair.outgoing;
    const other = incomingDragged ? pair.outgoing : pair.incoming;
    const newHandle = targets.get(moved)!;
    const vector = incomingDragged ? diff(at, newHandle) : diff(newHandle, at);
    const movedLength = length(vector);
    if (movedLength < 1e-9) continue;
    const otherLength = mode === "symmetric"
      ? movedLength
      : length(diff(getPoint(sketch, other), getPoint(sketch, anchorId)));
    const tangent = scaled(vector, 1 / movedLength);
    const signed = incomingDragged ? otherLength : -otherLength;
    if (!explicit.has(other)) targets.set(other, shift(at, scaled(tangent, signed)));
  }

  return [...targets].map(([pointId, target]) => ({ pointId, target }));
}

/** Pulling a Sharp handle out of its anchor turns the node back into an editable Corner.
 * This is an immutable edit, made in the same document transaction as the drag.
 */
export function releaseSharpOnHandleDrag(sketch: Sketch, direct: readonly NodeDragTarget[]): Sketch {
  const ids = new Set(direct.map((t) => t.pointId));
  let next = sketch;
  for (const [anchorId, mode] of Object.entries(sketch.nodeModes ?? {})) {
    if (mode !== "sharp") continue;
    const pair = nodeHandlePair(sketch, anchorId);
    if (pair && (ids.has(pair.incoming) || ids.has(pair.outgoing))) {
      next = setNodeMode(next, anchorId, "corner");
    }
  }
  return next;
}
