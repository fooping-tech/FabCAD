import type { BodyGeometry } from "@fabcad/brep";
import {
  ORIGIN_PLANES,
  type OriginPlaneName,
  type Plane3,
  type Vec3,
  add3,
  dot3,
  makePlane,
  norm3,
  planeToWorld,
  scale3,
  worldToPlane,
} from "@fabcad/geometry";

/**
 * Construction planes. A plane is infinite; what is shown of it is a square patch, which is
 * carried along so that a plane measured from a face appears over that face.
 */
export interface PlanePatch {
  plane: Plane3;
  /** Centre and edge length of the square that stands for the plane in the view. */
  center: Vec3;
  size: number;
}

const DEFAULT_SIZE = 60;

/** Like the origin planes of the view: a square with one corner at the origin. */
export function originPlanePatch(name: OriginPlaneName, size = DEFAULT_SIZE): PlanePatch {
  const plane = ORIGIN_PLANES[name];
  return { plane, center: planeToWorld(plane, { x: size / 2, y: size / 2 }), size };
}

/** The plane of a planar face, its normal pointing out of the body, and a patch over the face. */
export function facePlanePatch(geometry: BodyGeometry, faceIndex: number): PlanePatch | null {
  const face = geometry.faces[faceIndex];
  if (!face || face.surface !== "plane") return null;
  const n = norm3(face.normal);
  // The origin is the point of the plane nearest to the world origin: it stays where it is
  // when the face changes its outline.
  const plane = makePlane(scale3(n, dot3(n, face.center)), n);
  const { positions, indices } = geometry;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = face.start; k < face.start + face.count; k++) {
    const i = indices[k]! * 3;
    const p = worldToPlane(plane, { x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! });
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (minX > maxX) return { plane, center: face.center, size: DEFAULT_SIZE };
  return {
    plane,
    center: planeToWorld(plane, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
    size: Math.max(20, Math.max(maxX - minX, maxY - minY) * 1.25),
  };
}

/** The patch moved along the normal of its plane. Negative offsets go against the normal. */
export function offsetPlanePatch(base: PlanePatch, offset: number): PlanePatch {
  const shift = scale3(base.plane.normal, offset);
  return {
    plane: { ...base.plane, origin: add3(base.plane.origin, shift) },
    center: add3(base.center, shift),
    size: base.size,
  };
}
