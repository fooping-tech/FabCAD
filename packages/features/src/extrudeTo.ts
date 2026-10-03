import { type Plane3, type Vec3, dot3, sub3 } from "@fabcad/geometry";

/**
 * How far an extrusion goes to reach a target, along the normal of the sketch plane (negative:
 * against it). The target is a plane, which must be parallel to the sketch, or a point.
 * Throws with a message for the user where the target cannot be reached.
 */
export function extrudeReach(sketch: Plane3, target: { plane: Plane3 } | { point: Vec3 }): number {
  let at: Vec3;
  if ("plane" in target) {
    if (Math.abs(dot3(target.plane.normal, sketch.normal)) < 1 - 1e-6) {
      throw new Error("The plane to extrude to is not parallel to the sketch.");
    }
    at = target.plane.origin;
  } else {
    at = target.point;
  }
  const reach = dot3(sub3(at, sketch.origin), sketch.normal);
  if (Math.abs(reach) < 1e-9) throw new Error("What to extrude to lies on the sketch plane.");
  return reach;
}
