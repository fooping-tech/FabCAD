import type { Vec3 } from "@fabcad/geometry";
import type { BodyGeometry, MeshEdgeGroup } from "./kernel";

/** Queries on tessellated bodies. Pure functions; no kernel needed. */

const at = (a: ArrayLike<number>, i: number): Vec3 => ({
  x: a[i * 3]!,
  y: a[i * 3 + 1]!,
  z: a[i * 3 + 2]!,
});

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Points along an edge, in order, from its line segments. */
export function edgePolyline(geometry: BodyGeometry, edge: MeshEdgeGroup): Vec3[] {
  const out: Vec3[] = [];
  for (let k = edge.start; k + 1 < edge.start + edge.count; k += 2) {
    const a = at(geometry.edgePositions, k);
    const b = at(geometry.edgePositions, k + 1);
    const last = out[out.length - 1];
    if (!last || distance(last, a) > 1e-9) out.push(a);
    out.push(b);
  }
  return out;
}

export function nearestEdge(geometry: BodyGeometry, point: Vec3): MeshEdgeGroup | null {
  let best: MeshEdgeGroup | null = null;
  let bestD = Infinity;
  for (const e of geometry.edges) {
    const d = distance(e.midpoint, point);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function nearestVertex(geometry: BodyGeometry, point: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < geometry.vertices.length / 3; i++) {
    const v = at(geometry.vertices, i);
    const d = distance(v, point);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Edges that bound a face: all of their points are vertices of the face's triangles. */
export function faceEdges(geometry: BodyGeometry, faceIndex: number): MeshEdgeGroup[] {
  const face = geometry.faces[faceIndex];
  if (!face) return [];
  const key = (p: Vec3): string =>
    `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const onFace = new Set<string>();
  for (let k = face.start; k < face.start + face.count; k++) {
    onFace.add(key(at(geometry.positions, geometry.indices[k]!)));
  }
  return geometry.edges.filter((e) => {
    const pts = edgePolyline(geometry, e);
    return pts.length > 0 && pts.every((p) => onFace.has(key(p)));
  });
}
