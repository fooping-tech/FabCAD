import { closestParam, curvePointAt, dist2, subCurve, type Vec2 } from "@fabcad/geometry";
import { entityToCurves } from "./curves";
import { SketchBuilder, getPoint } from "./edit";
import type { EntityId, Sketch } from "./model";

/** A point inserted on an ordinary line or a cubic control spline. */
export interface InsertNodeResult {
  sketch: Sketch;
  nodeId: EntityId | null;
}

/**
 * Insert a new, independently movable anchor on an outline.
 *
 * A line is replaced by two lines sharing the new point, with NO collinear
 * constraint: dragging the point can form a corner. Cubic Béziers are split
 * exactly using de Casteljau (subCurve), leaving the outline unchanged at
 * insertion. The new cubic join starts in Smooth mode.
 *
 * Projected geometry and constrained source curves/control points are rejected
 * rather than silently breaking projection links or constraint semantics.
 */
export function insertNodeOnCurve(sketch: Sketch, entityId: EntityId, pick: Vec2): InsertNodeResult {
  const unchanged = { sketch, nodeId: null };
  const entity = sketch.entities[entityId];
  if (!entity || (entity.type !== "line" &&
    !(entity.type === "spline" && entity.kind === "control" && entity.points.length === 4 && !entity.closed))) {
    return unchanged;
  }
  if (sketch.projections.some((p) => p.entityIds.includes(entityId))) return unchanged;

  // Constraints/dimensions referring to the curve would change their meaning
  // (an old full curve becomes the first half), so do not split those entities.
  const oldHandleIds = entity.type === "spline" ? [entity.points[1]!, entity.points[2]!] : [];
  const sensitiveIds = new Set([entityId, ...oldHandleIds]);
  if (Object.values(sketch.constraints).some((c) => c.refs.some((id) => sensitiveIds.has(id)))) return unchanged;
  if (Object.values(sketch.dimensions).some((d) => d.refs.some((id) => sensitiveIds.has(id)))) return unchanged;
  // Shared control points must not be relocated, because they might belong to
  // another curve. Separate sketch entities may still share the endpoint IDs.
  if (oldHandleIds.some((id) => Object.values(sketch.entities).some(
    (other) => other.id !== entityId && other.type !== "point" &&
      ((other.type === "line" && (other.p1 === id || other.p2 === id)) ||
        (other.type === "spline" && other.points.includes(id)) ||
        ((other.type === "arc") && (other.center === id || other.start === id || other.end === id)) ||
        ((other.type === "circle" || other.type === "ellipse") && other.center === id)),
  ))) return unchanged;

  const curve = entityToCurves(sketch, entity)[0];
  if (!curve) return unchanged;
  const t = closestParam(curve, pick);
  // Do not create zero-length spans near existing anchors.
  if (!Number.isFinite(t) || t <= 0.001 || t >= 0.999) return unchanged;
  const at = curvePointAt(curve, t);
  if (dist2(at, curvePointAt(curve, 0)) < 1e-8 || dist2(at, curvePointAt(curve, 1)) < 1e-8) return unchanged;

  const b = new SketchBuilder(sketch);
  const mid = b.point(at.x, at.y);
  if (entity.type === "line") {
    b.updateEntity(entity.id, { p2: mid });
    b.line(mid, entity.p2, !!entity.construction);
    return { sketch: b.build(), nodeId: mid };
  }

  if (curve.type !== "bezier") return unchanged;
  const left = subCurve(curve, 0, t);
  const right = subCurve(curve, t, 1);
  if (left.type !== "bezier" || right.type !== "bezier") return unchanged;

  // Reuse original handle IDs at their corresponding ends. This avoids orphaned
  // points and keeps sketch history/projections stable without mutating endpoints.
  const [start, inHandle, outHandle, end] = entity.points as [EntityId, EntityId, EntityId, EntityId];
  b.movePoint(inHandle, left.p1);
  b.movePoint(outHandle, right.p2);
  const leftHandle = b.point(left.p2.x, left.p2.y);
  const rightHandle = b.point(right.p1.x, right.p1.y);
  b.updateEntity(entity.id, { points: [start, inHandle, leftHandle, mid] });
  b.spline("control", [mid, rightHandle, outHandle, end], false, !!entity.construction);
  return {
    sketch: { ...b.build(), nodeModes: { ...sketch.nodeModes, [mid]: "smooth" } },
    nodeId: mid,
  };
}
