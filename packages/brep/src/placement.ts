import type { Vec3 } from "@fabcad/geometry";
import type { BodyGeometry, MeshEdgeGroup, MeshFaceGroup } from "./kernel";

/**
 * Display geometry of a body moved by a rigid placement: a row-major 4 × 4 matrix (rotation and
 * translation only). Used where a body is seen from another component, placed relative to it:
 * the geometry comes out in the coordinates of the viewer. Indices, face and edge order and the
 * persistent names that go with them do not change.
 */
export function transformBodyGeometry(geometry: BodyGeometry, m: readonly number[]): BodyGeometry {
  const point = (p: Vec3): Vec3 => ({
    x: m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + m[3]!,
    y: m[4]! * p.x + m[5]! * p.y + m[6]! * p.z + m[7]!,
    z: m[8]! * p.x + m[9]! * p.y + m[10]! * p.z + m[11]!,
  });
  const dir = (d: Vec3): Vec3 => ({
    x: m[0]! * d.x + m[1]! * d.y + m[2]! * d.z,
    y: m[4]! * d.x + m[5]! * d.y + m[6]! * d.z,
    z: m[8]! * d.x + m[9]! * d.y + m[10]! * d.z,
  });
  const points = (a: Float32Array, apply: (v: Vec3) => Vec3): Float32Array => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) {
      const v = apply({ x: a[i]!, y: a[i + 1]!, z: a[i + 2]! });
      out[i] = v.x;
      out[i + 1] = v.y;
      out[i + 2] = v.z;
    }
    return out;
  };
  const positions = points(geometry.positions, point);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]!);
    min.y = Math.min(min.y, positions[i + 1]!);
    min.z = Math.min(min.z, positions[i + 2]!);
    max.x = Math.max(max.x, positions[i]!);
    max.y = Math.max(max.y, positions[i + 1]!);
    max.z = Math.max(max.z, positions[i + 2]!);
  }
  const faces: MeshFaceGroup[] = geometry.faces.map((f) => ({
    ...f,
    center: point(f.center),
    normal: dir(f.normal),
  }));
  const edges: MeshEdgeGroup[] = geometry.edges.map((e) => ({
    ...e,
    midpoint: point(e.midpoint),
    from: point(e.from),
    to: point(e.to),
    ...(e.center ? { center: point(e.center) } : {}),
    ...(e.bezier ? { bezier: e.bezier.map(point) } : {}),
  }));
  return {
    ...geometry,
    positions,
    normals: points(geometry.normals, dir),
    edgePositions: points(geometry.edgePositions, point),
    vertices: points(geometry.vertices, point),
    faces,
    edges,
    bounds: positions.length > 0 ? { min, max } : geometry.bounds,
  };
}

/** Whether a row-major 4 × 4 matrix leaves everything where it is. */
export function isIdentityMatrix(m: readonly number[], tolerance = 1e-12): boolean {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return id.every((v, i) => Math.abs((m[i] ?? NaN) - v) <= tolerance);
}
