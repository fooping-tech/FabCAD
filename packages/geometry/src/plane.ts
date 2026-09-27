import { type Vec2, type Vec3, add3, cross3, dot3, norm3, scale3, sub3 } from "./vec";

/** A right-handed 2D coordinate frame embedded in 3D. `normal = xDir × yDir`. */
export interface Plane3 {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

export type OriginPlaneName = "XY" | "XZ" | "YZ";

export const ORIGIN_PLANES: Record<OriginPlaneName, Plane3> = {
  XY: {
    origin: { x: 0, y: 0, z: 0 },
    xDir: { x: 1, y: 0, z: 0 },
    yDir: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
  },
  // Front plane: sketch X = world X, sketch Y = world Z, normal = -Y (towards the viewer).
  XZ: {
    origin: { x: 0, y: 0, z: 0 },
    xDir: { x: 1, y: 0, z: 0 },
    yDir: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: -1, z: 0 },
  },
  YZ: {
    origin: { x: 0, y: 0, z: 0 },
    xDir: { x: 0, y: 1, z: 0 },
    yDir: { x: 0, y: 0, z: 1 },
    normal: { x: 1, y: 0, z: 0 },
  },
};

export function makePlane(origin: Vec3, normal: Vec3, xHint?: Vec3): Plane3 {
  const n = norm3(normal);
  let x = xHint ? sub3(xHint, scale3(n, dot3(xHint, n))) : { x: 0, y: 0, z: 0 };
  if (Math.hypot(x.x, x.y, x.z) < 1e-9) {
    const ref = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    x = cross3(ref, n);
  }
  x = norm3(x);
  const y = cross3(n, x);
  return { origin, xDir: x, yDir: y, normal: n };
}

export const planeToWorld = (plane: Plane3, p: Vec2): Vec3 =>
  add3(plane.origin, add3(scale3(plane.xDir, p.x), scale3(plane.yDir, p.y)));

export const worldToPlane = (plane: Plane3, p: Vec3): Vec2 => {
  const d = sub3(p, plane.origin);
  return { x: dot3(d, plane.xDir), y: dot3(d, plane.yDir) };
};

export const distanceToPlane = (plane: Plane3, p: Vec3): number =>
  dot3(sub3(p, plane.origin), plane.normal);
