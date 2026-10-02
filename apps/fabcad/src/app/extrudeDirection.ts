import type { BodyOperation, ExtrudeDirection } from "@fabcad/cad-document";
import { type Plane3, type Vec3, dot3, sub3 } from "@fabcad/geometry";

/**
 * Which way an extrusion should go by default. Removing material (Cut, Intersect) only does
 * something towards the body, adding material usually goes away from it; so the default
 * follows the operation, as long as the user has not chosen a direction.
 */

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** How far the boxes reach to either side of the plane. */
export function reachFromPlane(plane: Plane3, boxes: readonly Box3[]): { positive: number; negative: number } {
  let positive = 0;
  let negative = 0;
  for (const { min, max } of boxes) {
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          const d = dot3(sub3({ x, y, z }, plane.origin), plane.normal);
          positive = Math.max(positive, d);
          negative = Math.max(negative, -d);
        }
      }
    }
  }
  return { positive, negative };
}

const removes = (op: BodyOperation): boolean => op === "cut" || op === "intersect";

/**
 * Direction to switch to when the operation changes, or null to leave it alone. `boxes` are
 * the bounds of the bodies the operation works on.
 */
export function directionForOperation(
  current: ExtrudeDirection,
  from: BodyOperation,
  to: BodyOperation,
  plane: Plane3,
  boxes: readonly Box3[],
): ExtrudeDirection | null {
  if (current === "symmetric" || removes(from) === removes(to) || boxes.length === 0) return null;
  const { positive, negative } = reachFromPlane(plane, boxes);
  const eps = 1e-6;
  // A body on both sides of the plane gives no hint.
  if (positive > eps && negative > eps) return null;
  if (positive <= eps && negative <= eps) return null;
  const towards: ExtrudeDirection = negative > eps ? "negative" : "positive";
  const away: ExtrudeDirection = towards === "negative" ? "positive" : "negative";
  const wanted = removes(to) ? towards : away;
  return wanted === current ? null : wanted;
}

/** Where an extrusion reaches along the plane normal, as the feature engine builds it. */
export function extrudeRange(direction: ExtrudeDirection, distance: number): [number, number] {
  if (direction === "symmetric") return [-distance / 2, distance / 2];
  return direction === "negative" ? [-distance, 0] : [0, distance];
}

/**
 * Operation to switch to when an extrusion has been turned to the other side of its sketch,
 * as in Fusion: Join becomes Cut when it now goes into bodies (`into`: the bodies that hold
 * the middle of the extrusion), and Cut becomes Join again when it goes into none. Null leaves
 * the operation alone.
 */
export function operationForSide(
  operation: BodyOperation,
  into: readonly string[],
): { operation: BodyOperation; targetBodyIds?: string[] } | null {
  if (operation === "join" && into.length > 0) return { operation: "cut", targetBodyIds: [...into] };
  if (operation === "cut" && into.length === 0) return { operation: "join" };
  return null;
}
