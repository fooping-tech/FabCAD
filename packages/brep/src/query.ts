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

/**
 * Silhouettes of a curved face seen along `direction`: the curves on the face where the surface
 * turns away from the viewer (normal ⟂ direction). They are not edges of the body, so they are
 * found on the mesh, by locating the zero of `normal · direction` along every triangle side. The
 * point on a side is placed on the circle that the two vertex normals describe, which is exact
 * for cylinders and spheres and close for other surfaces. Flat faces, and faces that are seen
 * edge-on everywhere (a cylinder seen along its axis), have none.
 */
export function faceSilhouettes(
  geometry: BodyGeometry,
  faceIndex: number,
  direction: Vec3,
): Vec3[][] {
  const face = geometry.faces[faceIndex];
  if (!face || face.surface === "plane") return [];
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (len === 0) return [];
  const d = { x: direction.x / len, y: direction.y / len, z: direction.z / len };
  const { positions, normals, indices } = geometry;
  const f = new Map<number, number>();
  const valueOf = (i: number): number => {
    let v = f.get(i);
    if (v === undefined) {
      const n = at(normals, i);
      const m = Math.hypot(n.x, n.y, n.z) || 1;
      v = (n.x * d.x + n.y * d.y + n.z * d.z) / m;
      f.set(i, v);
    }
    return v;
  };
  // Normals are single precision: anything this close to zero is on the edge-on side.
  const EPS = 1e-5;
  let any = false;
  for (let k = face.start; k < face.start + face.count; k++) {
    if (Math.abs(valueOf(indices[k]!)) > 1e-4) any = true;
  }
  if (!any) return [];
  const positive = (i: number): boolean => valueOf(i) > EPS;

  const crossing = (i: number, j: number): Vec3 => {
    const p1 = at(positions, i);
    const p2 = at(positions, j);
    const n1 = unit(at(normals, i));
    const n2 = unit(at(normals, j));
    const d1 = dot(n1, d);
    const d2 = dot(n2, d);
    const cos = Math.max(-1, Math.min(1, dot(n1, n2)));
    const phi = Math.acos(cos);
    if (phi < 1e-9) {
      const s = d1 / (d1 - d2);
      return lerp(p1, p2, s);
    }
    // Normal along the great circle from n1 to n2 that is perpendicular to d.
    const sin = Math.sin(phi);
    // tan(a) has period π: take the solution that falls between the two normals.
    const root = Math.atan2(-d1 * sin, d2 - d1 * cos);
    const outside = (t: number): number => Math.max(0, -t, t - phi);
    const best = [root, root + Math.PI, root - Math.PI].reduce((x, y) => (outside(y) < outside(x) ? y : x));
    const a = Math.max(0, Math.min(phi, best));
    const s = a / phi;
    const w1 = Math.sin(phi - a) / sin;
    const w2 = Math.sin(a) / sin;
    const m = { x: w1 * n1.x + w2 * n2.x, y: w1 * n1.y + w2 * n2.y, z: w1 * n1.z + w2 * n2.z };
    // Radius of curvature between the two vertices: p = c + r·n on a circle or a cylinder.
    const dn = { x: n1.x - n2.x, y: n1.y - n2.y, z: n1.z - n2.z };
    const r = dot({ x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z }, dn) / dot(dn, dn);
    const base = lerp(p1, p2, s);
    const nl = lerp(n1, n2, s);
    return { x: base.x + r * (m.x - nl.x), y: base.y + r * (m.y - nl.y), z: base.z + r * (m.z - nl.z) };
  };

  // Marching triangles: one segment per triangle whose vertices are not all on one side,
  // joined through the triangle sides they cross.
  const sideKey = (i: number, j: number): string => (i < j ? `${i}:${j}` : `${j}:${i}`);
  const points = new Map<string, Vec3>();
  const links = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    if (a === b) return;
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let k = face.start; k + 2 < face.start + face.count; k += 3) {
    const tri = [indices[k]!, indices[k + 1]!, indices[k + 2]!];
    const keys: string[] = [];
    for (let e = 0; e < 3; e++) {
      const i = tri[e]!;
      const j = tri[(e + 1) % 3]!;
      if (positive(i) === positive(j)) continue;
      const key = sideKey(i, j);
      if (!points.has(key)) points.set(key, positive(i) ? crossing(j, i) : crossing(i, j));
      keys.push(key);
    }
    if (keys.length === 2) link(keys[0]!, keys[1]!);
  }

  // Join the segments into chains, starting from the open ends.
  const used = new Set<string>();
  const chains: Vec3[][] = [];
  const walk = (start: string): void => {
    const chain = [start];
    used.add(start);
    let current = start;
    for (;;) {
      const next = (links.get(current) ?? []).find((n) => !used.has(n));
      if (!next) break;
      used.add(next);
      chain.push(next);
      current = next;
    }
    // A closed loop comes back to where it started.
    if (chain.length > 2 && (links.get(current) ?? []).includes(start)) chain.push(start);
    const pts: Vec3[] = [];
    for (const key of chain) {
      const p = points.get(key)!;
      const last = pts[pts.length - 1];
      if (!last || distance(last, p) > 1e-9) pts.push(p);
    }
    if (pts.length >= 2) chains.push(pts);
  };
  for (const [key, next] of links) if (next.length === 1 && !used.has(key)) walk(key);
  for (const key of links.keys()) if (!used.has(key)) walk(key);
  return chains;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const lerp = (a: Vec3, b: Vec3, s: number): Vec3 => ({
  x: a.x + (b.x - a.x) * s,
  y: a.y + (b.y - a.y) * s,
  z: a.z + (b.z - a.z) * s,
});

/** The point halfway along a polyline; used to find a silhouette again. */
export function polylineMidpoint(points: readonly Vec3[]): Vec3 {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const l = distance(points[i - 1]!, points[i]!);
    if (l >= left && l > 0) return lerp(points[i - 1]!, points[i]!, left / l);
    left -= l;
  }
  return points[0] ?? { x: 0, y: 0, z: 0 };
}
