import type { ShapeTransform } from "@fabcad/brep";
import type { Vec3 } from "@fabcad/geometry";

const AXES: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

/**
 * The steps of a free move: turn about the world X, Y and Z axes through `pivot`, in that
 * order, by `angles` (degrees, counter-clockwise), then move by `translation`. Steps that do
 * nothing are left out.
 */
export function freeMoveSteps(pivot: Vec3, translation: Vec3, angles: Vec3): ShapeTransform[] {
  const steps: ShapeTransform[] = [];
  [angles.x, angles.y, angles.z].forEach((angle, i) => {
    if (Math.abs(angle) > 1e-12) steps.push({ type: "rotate", origin: pivot, axis: AXES[i]!, angle });
  });
  if (Math.hypot(translation.x, translation.y, translation.z) > 1e-12) {
    steps.push({ type: "translate", vector: translation });
  }
  return steps;
}
