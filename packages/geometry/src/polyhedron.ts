import { type Plane3, makePlane, worldToPlane } from "./plane";
import { signedArea } from "./polygon";
import {
  type Vec2,
  type Vec3,
  add3,
  cross3,
  dot3,
  len3,
  norm3,
  scale3,
  sub3,
} from "./vec";

/**
 * Kernel-independent polyhedral description of a solid. Curved B-Rep faces are represented by
 * planar facets flagged `surface: "curved"`. This is the only view of a CAD body that
 * manufacturing code is allowed to see.
 */
export interface TopoFace {
  id: number;
  /** Index of the originating B-Rep face. Several facets share it when the face is curved. */
  sourceFace: number;
  surface: "plane" | "curved";
  /**
   * True when the kernel knows the originating surface lies flat without stretching (a plane,
   * cylinder, cone or straight extrusion). Left out when unknown: only the facets can tell.
   */
  developable?: boolean;
  /** Outward unit normal. */
  normal: Vec3;
  /**
   * Vertex index loops. The first loop is the outer boundary, counter-clockwise when seen from
   * outside the solid; the remaining loops are holes (clockwise).
   */
  loops: number[][];
}

export interface TopoEdge {
  id: number;
  a: number;
  b: number;
  /** Adjacent faces. A watertight solid has exactly two per edge. */
  faces: number[];
  /** True when the edge lies inside one smooth (curved) surface rather than on a crease. */
  smooth: boolean;
}

export interface SolidTopology {
  vertices: Vec3[];
  faces: TopoFace[];
  edges: TopoEdge[];
}

export interface IndexedMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Triangle ranges per B-Rep face; `start` and `count` are offsets into `indices`. */
  faceGroups: {
    faceIndex: number;
    start: number;
    count: number;
    surface: "plane" | "curved";
    /** See `TopoFace.developable`. */
    developable?: boolean;
  }[];
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Convert a triangle mesh grouped by B-Rep face into planar polygon faces with adjacency. */
export function meshToTopology(mesh: IndexedMesh, weldTolerance = 1e-4): SolidTopology {
  // 1. Weld vertices by quantised position.
  const vertices: Vec3[] = [];
  const lookup = new Map<string, number>();
  const remap: number[] = [];
  const q = 1 / weldTolerance;
  const count = Math.floor(mesh.positions.length / 3);
  for (let i = 0; i < count; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertices.push({ x, y, z });
      lookup.set(key, idx);
    }
    remap.push(idx);
  }

  // 2. Collect triangles, check global orientation through the signed volume.
  interface Tri {
    v: [number, number, number];
    n: Vec3;
    group: number;
  }
  const groupsTris: Tri[][] = [];
  let volume6 = 0;
  mesh.faceGroups.forEach((g, gi) => {
    const tris: Tri[] = [];
    for (let k = g.start; k + 2 < g.start + g.count; k += 3) {
      const a = remap[mesh.indices[k]!]!;
      const b = remap[mesh.indices[k + 1]!]!;
      const c = remap[mesh.indices[k + 2]!]!;
      if (a === b || b === c || a === c) continue;
      const pa = vertices[a]!;
      const pb = vertices[b]!;
      const pc = vertices[c]!;
      const n = cross3(sub3(pb, pa), sub3(pc, pa));
      if (len3(n) < 1e-12) continue;
      volume6 += dot3(pa, cross3(pb, pc));
      tris.push({ v: [a, b, c], n, group: gi });
    }
    groupsTris.push(tris);
  });
  if (volume6 < 0) {
    for (const tris of groupsTris) {
      for (const t of tris) {
        t.v = [t.v[0], t.v[2], t.v[1]];
        t.n = scale3(t.n, -1);
      }
    }
  }

  // 3. Split every group into connected coplanar facets.
  const faces: TopoFace[] = [];
  groupsTris.forEach((tris, gi) => {
    const group = mesh.faceGroups[gi]!;
    if (tris.length === 0) return;
    const parent = tris.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const byEdge = new Map<string, number[]>();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const key = edgeKey(t.v[e]!, t.v[(e + 1) % 3]!);
        const list = byEdge.get(key);
        if (list) list.push(ti);
        else byEdge.set(key, [ti]);
      }
    });
    const cosLimit = Math.cos((0.25 * Math.PI) / 180);
    for (const list of byEdge.values()) {
      if (list.length !== 2) continue;
      const [i, j] = [list[0]!, list[1]!];
      const coplanar =
        group.surface === "plane" || dot3(norm3(tris[i]!.n), norm3(tris[j]!.n)) >= cosLimit;
      if (coplanar) parent[find(i)] = find(j);
    }
    const clusters = new Map<number, Tri[]>();
    tris.forEach((t, ti) => {
      const root = find(ti);
      const list = clusters.get(root);
      if (list) list.push(t);
      else clusters.set(root, [t]);
    });
    for (const cluster of clusters.values()) {
      const face = buildFacet(cluster, vertices, faces.length, group.faceIndex, group.surface);
      if (face && group.developable !== undefined) face.developable = group.developable;
      if (face) faces.push(face);
    }
  });

  return { vertices, faces, edges: buildEdges(faces) };
}

function buildFacet(
  tris: { v: [number, number, number]; n: Vec3 }[],
  vertices: Vec3[],
  id: number,
  sourceFace: number,
  surface: "plane" | "curved",
): TopoFace | null {
  let n: Vec3 = { x: 0, y: 0, z: 0 };
  const directed = new Set<string>();
  for (const t of tris) {
    n = add3(n, t.n);
    for (let e = 0; e < 3; e++) directed.add(`${t.v[e]}>${t.v[(e + 1) % 3]}`);
  }
  const normal = norm3(n);
  const next = new Map<number, number[]>();
  for (const key of directed) {
    const [a, b] = key.split(">").map(Number) as [number, number];
    if (directed.has(`${b}>${a}`)) continue;
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [];
      let cur = start;
      let guard = 0;
      do {
        loop.push(cur);
        const outs = next.get(cur);
        if (!outs || outs.length === 0) break;
        cur = outs.pop()!;
      } while (cur !== start && guard++ < 100000);
      if (loop.length >= 3 && cur === start) loops.push(loop);
    }
  }
  if (loops.length === 0) return null;
  const plane = makePlane(vertices[loops[0]![0]!]!, normal);
  const areas = loops.map((l) => signedArea(l.map((v) => worldToPlane(plane, vertices[v]!))));
  const order = loops.map((_, i) => i).sort((i, j) => Math.abs(areas[j]!) - Math.abs(areas[i]!));
  const sorted = order.map((i, rank) => {
    const loop = loops[i]!;
    const shouldBePositive = rank === 0;
    return areas[i]! > 0 === shouldBePositive ? loop : loop.slice().reverse();
  });
  return { id, sourceFace, surface, normal, loops: sorted };
}

function buildEdges(faces: TopoFace[]): TopoEdge[] {
  const map = new Map<string, TopoEdge>();
  for (const f of faces) {
    for (const loop of f.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const key = edgeKey(a, b);
        let e = map.get(key);
        if (!e) {
          e = { id: map.size, a: Math.min(a, b), b: Math.max(a, b), faces: [], smooth: false };
          map.set(key, e);
        }
        if (!e.faces.includes(f.id)) e.faces.push(f.id);
      }
    }
  }
  const edges = [...map.values()];
  for (const e of edges) {
    if (e.faces.length !== 2) continue;
    const f = faces[e.faces[0]!]!;
    const g = faces[e.faces[1]!]!;
    const sameCurved = f.sourceFace === g.sourceFace && f.surface === "curved";
    const tangent = dot3(f.normal, g.normal) > Math.cos((1 * Math.PI) / 180);
    e.smooth = sameCurved || tangent;
  }
  return edges;
}

/** Lookup helper: undirected vertex pair → edge. */
export function buildEdgeLookup(topology: SolidTopology): Map<string, TopoEdge> {
  const map = new Map<string, TopoEdge>();
  for (const e of topology.edges) map.set(edgeKey(e.a, e.b), e);
  return map;
}

export const topoEdgeKey = edgeKey;

/** Local 2D frame of a face: origin at the first outer vertex, X along the first outer edge. */
export function facePlane(topology: SolidTopology, face: TopoFace): Plane3 {
  const loop = face.loops[0]!;
  const o = topology.vertices[loop[0]!]!;
  const x = sub3(topology.vertices[loop[1]!]!, o);
  return makePlane(o, face.normal, x);
}

export function faceLoops2D(topology: SolidTopology, face: TopoFace, plane: Plane3): Vec2[][] {
  return face.loops.map((loop) => loop.map((v) => worldToPlane(plane, topology.vertices[v]!)));
}

export function faceArea(topology: SolidTopology, face: TopoFace): number {
  const plane = facePlane(topology, face);
  return faceLoops2D(topology, face, plane).reduce((s, l) => s + signedArea(l), 0);
}

/**
 * Interior (material-side) dihedral angle at an edge shared by two faces, in radians.
 * 90° for a box edge, < 180° for convex edges, > 180° for concave edges.
 */
export function edgeInteriorAngle(topology: SolidTopology, edge: TopoEdge): number | null {
  if (edge.faces.length !== 2) return null;
  const f = topology.faces[edge.faces[0]!]!;
  const g = topology.faces[edge.faces[1]!]!;
  const a = topology.vertices[edge.a]!;
  const b = topology.vertices[edge.b]!;
  const dir = norm3(sub3(b, a));
  // In-plane directions pointing from the edge into each face.
  const intoFace = (face: TopoFace): Vec3 => {
    let u = cross3(face.normal, dir);
    const forward = face.loops.some((loop) =>
      loop.some((v, i) => v === edge.a && loop[(i + 1) % loop.length] === edge.b),
    );
    if (!forward) u = scale3(u, -1);
    return norm3(u);
  };
  const uf = intoFace(f);
  const ug = intoFace(g);
  const cos = Math.max(-1, Math.min(1, dot3(uf, ug)));
  const ang = Math.acos(cos);
  const convex = dot3(ug, f.normal) < 1e-9;
  if (Math.abs(dot3(ug, f.normal)) < 1e-9 && cos > 0) return 0;
  return convex ? ang : 2 * Math.PI - ang;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export function boundsOfPoints3(points: Iterable<Vec3>): Bounds3 {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

/**
 * Build the polyhedral topology of a straight prism from polygons. This is a fixture for tests
 * and demos of kernel-independent code; real bodies always come from the geometry kernel.
 */
export function prismTopology(
  outer: readonly Vec2[],
  height: number,
  holes: readonly (readonly Vec2[])[] = [],
  plane: Plane3 = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }),
): SolidTopology {
  const vertices: Vec3[] = [];
  const faces: TopoFace[] = [];
  const lift = (p: Vec2, h: number): Vec3 =>
    add3(
      plane.origin,
      add3(add3(scale3(plane.xDir, p.x), scale3(plane.yDir, p.y)), scale3(plane.normal, h)),
    );
  const ccw = signedArea(outer) > 0 ? outer.slice() : outer.slice().reverse();
  const rings = [ccw, ...holes.map((h) => (signedArea(h) < 0 ? h.slice() : h.slice().reverse()))];
  const bottomIdx: number[][] = [];
  const topIdx: number[][] = [];
  for (const ring of rings) {
    const b: number[] = [];
    const t: number[] = [];
    for (const p of ring) {
      b.push(vertices.length);
      vertices.push(lift(p, 0));
      t.push(vertices.length);
      vertices.push(lift(p, height));
    }
    bottomIdx.push(b);
    topIdx.push(t);
  }
  faces.push({
    id: 0,
    sourceFace: 0,
    surface: "plane",
    normal: scale3(plane.normal, -1),
    loops: bottomIdx.map((l) => l.slice().reverse()),
  });
  faces.push({
    id: 1,
    sourceFace: 1,
    surface: "plane",
    normal: plane.normal,
    loops: topIdx.map((l) => l.slice()),
  });
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = vertices[bottomIdx[r]![i]!]!;
      const b = vertices[bottomIdx[r]![j]!]!;
      const normal = norm3(cross3(sub3(b, a), plane.normal));
      faces.push({
        id: faces.length,
        sourceFace: faces.length,
        surface: "plane",
        normal,
        loops: [[bottomIdx[r]![i]!, bottomIdx[r]![j]!, topIdx[r]![j]!, topIdx[r]![i]!]],
      });
    }
  });
  return { vertices, faces, edges: buildEdges(faces) };
}
