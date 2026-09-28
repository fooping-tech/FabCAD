import { type BodyGeometry, type MeshEdgeGroup, edgePolyline } from "@fabcad/brep";
import type { Point3Ref, TopologyRef } from "@fabcad/cad-document";
import type { Vec3 } from "@fabcad/geometry";

/**
 * Persistent topology names.
 *
 * Every face of a body gets a name that says where it comes from: the feature that made it,
 * the role it plays in that feature and, where there is one, the sketch entity behind it.
 * Faces that a later feature merely trims keep their name. Edges are named by the faces that
 * meet at them. Names are assigned from the inputs a feature has at the moment it runs, so
 * they are the same after a dimension changes, which positions are not.
 *
 * Everything here works on tessellations, not on kernel objects: naming does not depend on
 * which geometry kernel is used.
 */

export interface FaceName {
  /** Canonical name. Unique within a body. */
  key: string;
  feature: string;
  /** "start" | "end" | "side" | "fillet" | "chamfer" | "shell" | "hole" | "face" | … */
  role: string;
  sketch?: string;
  entity?: string;
  /** Names of the faces or edges this face was generated from (e.g. the filleted edge). */
  of?: string[];
  /**
   * For faces made by a pattern or a mirror: which instance the face belongs to ("1", "2", …,
   * "i.j" in the second row and beyond of a two-directional pattern). The instance is counted
   * from the original, so it stays the same when the number of instances changes.
   */
  instance?: string;
  /** Distinguishes faces that would otherwise carry the same name (a face cut in two). */
  index?: number;
}

export interface EdgeName {
  key: string;
  /** Names of the faces that meet at the edge, sorted. */
  faces: string[];
  index?: number;
}

export interface BodyNames {
  /** By face index of the tessellation. */
  faces: FaceName[];
  /** By edge index of the tessellation. */
  edges: EdgeName[];
}

export interface NamedBody {
  geometry: BodyGeometry;
  names: BodyNames;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
const unit = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

const vertex = (g: BodyGeometry, index: number): Vec3 => ({
  x: g.positions[index * 3]!,
  y: g.positions[index * 3 + 1]!,
  z: g.positions[index * 3 + 2]!,
});

export interface FaceSample {
  point: Vec3;
  normal: Vec3;
}

/** Points on a face with the normal there: the centroids of its largest triangles. */
export function faceSamples(g: BodyGeometry, faceIndex: number, count = 3): FaceSample[] {
  const face = g.faces[faceIndex];
  if (!face) return [];
  const all: (FaceSample & { area: number })[] = [];
  for (let k = face.start; k + 2 < face.start + face.count; k += 3) {
    const a = vertex(g, g.indices[k]!);
    const b = vertex(g, g.indices[k + 1]!);
    const c = vertex(g, g.indices[k + 2]!);
    const n = cross(sub(b, a), sub(c, a));
    const area = length(n) / 2;
    if (area < 1e-12) continue;
    all.push({
      point: { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 },
      normal: unit(n),
      area,
    });
  }
  all.sort((p, q) => q.area - p.area);
  return all.slice(0, count).map(({ point, normal }) => ({ point, normal }));
}

function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  // Closest point on a triangle (Ericson, Real-Time Collision Detection).
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return distance(p, a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return distance(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return distance(p, { x: a.x + ab.x * v, y: a.y + ab.y * v, z: a.z + ab.z * v });
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return distance(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return distance(p, { x: a.x + ac.x * w, y: a.y + ac.y * w, z: a.z + ac.z * w });
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return distance(p, {
      x: b.x + (c.x - b.x) * w,
      y: b.y + (c.y - b.y) * w,
      z: b.z + (c.z - b.z) * w,
    });
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den;
  const w = vc * den;
  return distance(p, {
    x: a.x + ab.x * v + ac.x * w,
    y: a.y + ab.y * v + ac.y * w,
    z: a.z + ab.z * v + ac.z * w,
  });
}

/** Distance from a point to a face, and the normal of the face where it is closest. */
export function distanceToFace(
  g: BodyGeometry,
  faceIndex: number,
  p: Vec3,
): { distance: number; normal: Vec3 } {
  const face = g.faces[faceIndex];
  let best = Infinity;
  let normal: Vec3 = { x: 0, y: 0, z: 1 };
  if (!face) return { distance: best, normal };
  for (let k = face.start; k + 2 < face.start + face.count; k += 3) {
    const a = vertex(g, g.indices[k]!);
    const b = vertex(g, g.indices[k + 1]!);
    const c = vertex(g, g.indices[k + 2]!);
    const d = pointTriangleDistance(p, a, b, c);
    if (d < best) {
      best = d;
      normal = unit(cross(sub(b, a), sub(c, a)));
    }
  }
  return { distance: best, normal };
}

export function distanceToEdge(g: BodyGeometry, edge: MeshEdgeGroup, p: Vec3): number {
  const pts = edgePolyline(g, edge);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const ab = sub(pts[i + 1]!, a);
    const l2 = dot(ab, ab);
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    best = Math.min(best, distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t }));
  }
  if (pts.length === 1) best = distance(p, pts[0]!);
  return best;
}

/** How far apart two tessellations of the same surface may be. */
const tolerance = (surface: string): number => (surface === "plane" ? 2e-3 : 0.15);

export function faceKey(name: Omit<FaceName, "key">): string {
  let key = `${name.feature}:${name.role}`;
  if (name.entity) key += `(${name.sketch ? `${name.sketch}/` : ""}${name.entity})`;
  if (name.of && name.of.length > 0) key += `[${name.of.join("+")}]`;
  if (name.instance !== undefined) key += `@${name.instance}`;
  if (name.index !== undefined && name.index > 0) key += `#${name.index}`;
  return key;
}

/** The pattern instance a face name belongs to, read from its key. */
export const instanceOfKey = (key: string): string | undefined =>
  /@([0-9.]+)(?:#\d+)?$/.exec(key)?.[1];

/** Name without the index that tells split faces apart. */
export const baseKey = (key: string): string => key.replace(/#\d+$/, "");

const lexicographic = (a: Vec3, b: Vec3): number =>
  Math.abs(a.x - b.x) > 1e-6 ? a.x - b.x : Math.abs(a.y - b.y) > 1e-6 ? a.y - b.y : a.z - b.z;

/** Give faces that ended up with the same name an index, largest face first. */
function disambiguate(g: BodyGeometry, names: Omit<FaceName, "key">[]): FaceName[] {
  const groups = new Map<string, number[]>();
  names.forEach((n, i) => {
    const key = faceKey({ ...n, index: undefined });
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const out: FaceName[] = new Array<FaceName>(names.length);
  for (const list of groups.values()) {
    list.sort((i, j) => {
      const a = g.faces[i]!;
      const b = g.faces[j]!;
      return Math.abs(a.area - b.area) > 1e-6 ? b.area - a.area : lexicographic(a.center, b.center);
    });
    list.forEach((faceIndex, rank) => {
      const n = { ...names[faceIndex]! };
      if (list.length > 1) n.index = rank;
      else delete n.index;
      out[faceIndex] = { ...n, key: faceKey(n) };
    });
  }
  return out;
}

export type Classifier = (faceIndex: number, samples: FaceSample[]) => Omit<FaceName, "key" | "feature"> | null;

/** Name the faces of a solid that a feature made from scratch. */
export function nameSolid(g: BodyGeometry, featureId: string, classify: Classifier): BodyNames {
  const names = g.faces.map((_, i) => {
    const n = classify(i, faceSamples(g, i)) ?? { role: "face" };
    return { ...n, feature: featureId };
  });
  const faces = disambiguate(g, names);
  return { faces, edges: nameEdges(g, faces) };
}

/**
 * Name the faces of the result of a feature that changed existing bodies. A face that lies on
 * a face of an input keeps that name; the others were generated by the feature and are named
 * by `classify`.
 */
export function propagateNames(
  inputs: NamedBody[],
  result: BodyGeometry,
  featureId: string,
  classify: Classifier = () => null,
  /** Faces of the inputs that the feature removed: nothing inherits their name. */
  removed: (input: number, faceIndex: number) => boolean = () => false,
): BodyNames {
  // Bounding boxes of the input faces: most candidates are ruled out without a distance test.
  const boxes = inputs.map((input) =>
    input.geometry.faces.map((f) => {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = f.start; k < f.start + f.count; k++) {
        const v = input.geometry.indices[k]! * 3;
        for (let a = 0; a < 3; a++) {
          const c = input.geometry.positions[v + a]!;
          if (c < b[a]!) b[a] = c;
          if (c > b[a + 3]!) b[a + 3] = c;
        }
      }
      return b;
    }),
  );
  const inside = (b: number[], p: Vec3, tol: number): boolean =>
    p.x >= b[0]! - tol &&
    p.y >= b[1]! - tol &&
    p.z >= b[2]! - tol &&
    p.x <= b[3]! + tol &&
    p.y <= b[4]! + tol &&
    p.z <= b[5]! + tol;

  const names = result.faces.map((face, i) => {
    const samples = faceSamples(result, i);
    const tol = tolerance(face.surface);
    const votes = new Map<string, { name: FaceName; count: number; order: number }>();
    let order = 0;
    for (const input of inputs) {
      const inputIndex = order;
      input.geometry.faces.forEach((old, oldIndex) => {
        if (removed(inputIndex, oldIndex)) return;
        const same = old.surface === face.surface || (old.surface !== "plane" && face.surface !== "plane");
        if (!same) return;
        let count = 0;
        const box = boxes[inputIndex]![oldIndex]!;
        for (const s of samples) {
          if (!inside(box, s.point, tol)) continue;
          const hit = distanceToFace(input.geometry, oldIndex, s.point);
          // A cut turns the faces of the tool inside out: the direction may be reversed.
          if (hit.distance <= tol && Math.abs(dot(hit.normal, s.normal)) > 0.985) count += 1;
        }
        if (count === 0) return;
        const name = input.names.faces[oldIndex];
        if (name) votes.set(`${order}:${oldIndex}`, { name, count, order: order * 1e6 + oldIndex });
      });
      order += 1;
    }
    let best: { name: FaceName; count: number; order: number } | null = null;
    for (const v of votes.values()) {
      if (!best || v.count > best.count || (v.count === best.count && v.order < best.order)) best = v;
    }
    if (best && best.count * 2 >= samples.length) {
      const { key: _key, index: _index, ...rest } = best.name;
      void _key;
      void _index;
      return rest;
    }
    const n = classify(i, samples) ?? { role: "face" };
    return { ...n, feature: featureId };
  });
  const faces = disambiguate(result, names);
  return { faces, edges: nameEdges(result, faces) };
}

/** Faces and edges keep their names when a body is only moved: the topology is unchanged. */
export function namesAfterMove(names: BodyNames): BodyNames {
  return names;
}

/**
 * Names for a copy of a shape that a pattern or a mirror made. `g` is the tessellation of the
 * copy; a copy has the faces of its source in the same order.
 *
 * Every face keeps what is known about its origin (role, sketch entity) and is named after the
 * pattern, the face it is a copy of and the instance. Such a name is unique even after the
 * copies have been joined into one body, and it does not depend on how many instances there
 * are. Returns null when the copy does not have the structure of its source.
 */
export function instanceNames(
  source: BodyNames,
  g: BodyGeometry,
  featureId: string,
  instance: string,
): BodyNames | null {
  if (source.faces.length !== g.faces.length) return null;
  const faces = source.faces.map((n): FaceName => {
    const name: Omit<FaceName, "key"> = { feature: featureId, role: n.role, of: [n.key], instance };
    if (n.sketch) name.sketch = n.sketch;
    if (n.entity) name.entity = n.entity;
    return { ...name, key: faceKey(name) };
  });
  return { faces, edges: nameEdges(g, faces) };
}

/** Faces adjacent to every edge, from the points that edge and face tessellations share. */
export function edgeFaces(g: BodyGeometry): number[][] {
  const key = (p: Vec3): string =>
    `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const faceSets = g.faces.map((face) => {
    const set = new Set<string>();
    for (let k = face.start; k < face.start + face.count; k++) set.add(key(vertex(g, g.indices[k]!)));
    return set;
  });
  return g.edges.map((edge) => {
    const pts = edgePolyline(g, edge).map(key);
    const out: number[] = [];
    if (pts.length === 0) return out;
    faceSets.forEach((set, faceIndex) => {
      if (pts.every((p) => set.has(p))) out.push(faceIndex);
    });
    return out;
  });
}

export function nameEdges(g: BodyGeometry, faces: FaceName[]): EdgeName[] {
  const adjacency = edgeFaces(g);
  const raw = g.edges.map((_, i) => {
    const names = [...new Set(adjacency[i]!.map((f) => faces[f]?.key ?? `?${f}`))].sort();
    return names;
  });
  const groups = new Map<string, number[]>();
  raw.forEach((names, i) => {
    const key = names.join("|");
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const out: EdgeName[] = new Array<EdgeName>(g.edges.length);
  for (const [key, list] of groups) {
    list.sort((i, j) => {
      const a = g.edges[i]!;
      const b = g.edges[j]!;
      return Math.abs(a.length - b.length) > 1e-6 ? b.length - a.length : lexicographic(a.midpoint, b.midpoint);
    });
    list.forEach((edgeIndex, rank) => {
      const name: EdgeName = { key: `edge(${key})`, faces: raw[edgeIndex]! };
      if (list.length > 1) {
        name.index = rank;
        if (rank > 0) name.key += `#${rank}`;
      }
      out[edgeIndex] = name;
    });
  }
  return out;
}

// ------------------------------------------------------------------ references

function edgeDirection(edge: MeshEdgeGroup): Vec3 {
  return unit(sub(edge.to, edge.from));
}

export function makeFaceRef(body: NamedBody, faceIndex: number): TopologyRef | null {
  const face = body.geometry.faces[faceIndex];
  const name = body.names.faces[faceIndex];
  if (!face) return null;
  const ref: TopologyRef = {
    kind: "face",
    point: face.center,
    normal: face.normal,
    signature: {
      center: face.center,
      normal: face.normal,
      area: face.area,
      surfaceType: face.surface,
    },
  };
  if (name) {
    ref.name = name.key;
    ref.sourceFeatureId = name.feature;
    ref.role = name.role;
    if (name.sketch) ref.sourceSketchId = name.sketch;
    if (name.entity) ref.sourceEntityId = name.entity;
  }
  return ref;
}

export function makeEdgeRef(body: NamedBody, edgeIndex: number): TopologyRef | null {
  const edge = body.geometry.edges[edgeIndex];
  const name = body.names.edges[edgeIndex];
  if (!edge) return null;
  const ref: TopologyRef = {
    kind: "edge",
    point: edge.midpoint,
    signature: {
      center: edge.midpoint,
      direction: edgeDirection(edge),
      length: edge.length,
      curveType: edge.curve,
    },
  };
  if (edge.radius !== undefined) ref.signature!.radius = edge.radius;
  if (name) {
    ref.name = name.key;
    ref.faces = name.faces;
  }
  return ref;
}

export interface Resolution {
  index: number;
  /** How the reference was resolved. */
  by: "name" | "provenance" | "signature" | "proximity";
}

const relative = (a: number | undefined, b: number): number =>
  a === undefined ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);

/** Lower is better. Position only breaks ties between otherwise equal candidates. */
function faceScore(ref: TopologyRef, g: BodyGeometry, index: number): number {
  const face = g.faces[index]!;
  const s = ref.signature ?? {};
  let score = 0;
  if (s.surfaceType && s.surfaceType !== face.surface) score += 10;
  const n = s.normal ?? ref.normal;
  if (n) score += (1 - dot(unit(n), face.normal)) * 3;
  score += Math.min(1, relative(s.area, face.area));
  score += Math.min(1, distance(ref.point, face.center) / 1000);
  return score;
}

function edgeScore(ref: TopologyRef, g: BodyGeometry, index: number): number {
  const edge = g.edges[index]!;
  const s = ref.signature ?? {};
  let score = 0;
  if (s.curveType && s.curveType !== edge.curve) score += 10;
  if (s.direction && edge.curve === "line") {
    score += (1 - Math.abs(dot(unit(s.direction), edgeDirection(edge)))) * 3;
  }
  score += Math.min(1, relative(s.length, edge.length));
  if (s.radius !== undefined && edge.radius !== undefined) {
    score += Math.min(1, relative(s.radius, edge.radius));
  }
  score += Math.min(1, distanceToEdge(g, edge, ref.point) / 1000);
  return score;
}

const bestOf = (candidates: number[], score: (i: number) => number): number | null => {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const i of candidates) {
    const s = score(i);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
};

/**
 * Find the face a reference points at. Order: exact name; same feature, role and sketch entity
 * (the face may have been split or merged); same feature and role; geometric signature; and
 * only when the reference carries no name at all, proximity.
 */
export function resolveFaceRef(ref: TopologyRef, body: NamedBody): Resolution | null {
  const { geometry, names } = body;
  const all = geometry.faces.map((_, i) => i);
  if (all.length === 0) return null;
  if (ref.name) {
    const exact = names.faces.findIndex((n) => n?.key === ref.name);
    if (exact >= 0) return { index: exact, by: "name" };
    const base = baseKey(ref.name);
    const split = all.filter((i) => names.faces[i] && baseKey(names.faces[i]!.key) === base);
    const pick = bestOf(split, (i) => faceScore(ref, geometry, i));
    if (pick !== null) return { index: pick, by: "provenance" };
  }
  if (ref.sourceFeatureId) {
    // A face of a pattern instance is never a stand-in for the same face of another instance.
    const instance = ref.name ? instanceOfKey(ref.name) : undefined;
    const sameFeature = all.filter(
      (i) =>
        names.faces[i]?.feature === ref.sourceFeatureId &&
        (ref.name === undefined || names.faces[i]?.instance === instance),
    );
    const sameEntity = sameFeature.filter(
      (i) =>
        ref.sourceEntityId !== undefined &&
        names.faces[i]?.entity === ref.sourceEntityId &&
        names.faces[i]?.role === ref.role,
    );
    const sameRole = sameFeature.filter((i) => names.faces[i]?.role === ref.role);
    for (const candidates of [sameEntity, sameRole]) {
      const pick = bestOf(candidates, (i) => faceScore(ref, geometry, i));
      if (pick !== null) return { index: pick, by: "provenance" };
    }
  }
  if (ref.signature) {
    const pick = bestOf(all, (i) => faceScore(ref, geometry, i));
    if (pick !== null) return { index: pick, by: "signature" };
  }
  const pick = bestOf(all, (i) => distanceToFace(geometry, i, ref.point).distance);
  return pick === null ? null : { index: pick, by: "proximity" };
}

export function resolveEdgeRef(ref: TopologyRef, body: NamedBody): Resolution | null {
  const { geometry, names } = body;
  const all = geometry.edges.map((_, i) => i);
  if (all.length === 0) return null;
  if (ref.name) {
    const exact = names.edges.findIndex((n) => n?.key === ref.name);
    if (exact >= 0) return { index: exact, by: "name" };
  }
  if (ref.faces && ref.faces.length > 0) {
    // The edge between the same faces, allowing for faces that were split since.
    const wanted = ref.faces.map(baseKey);
    const overlap = (i: number): number => {
      const have = (names.edges[i]?.faces ?? []).map(baseKey);
      return wanted.filter((w) => have.includes(w)).length;
    };
    const most = Math.max(...all.map(overlap));
    if (most > 0) {
      const candidates = all.filter((i) => overlap(i) === most);
      const pick = bestOf(candidates, (i) => edgeScore(ref, geometry, i));
      if (pick !== null) return { index: pick, by: "provenance" };
    }
  }
  if (ref.signature) {
    const pick = bestOf(all, (i) => edgeScore(ref, geometry, i));
    if (pick !== null) return { index: pick, by: "signature" };
  }
  const pick = bestOf(all, (i) => distanceToEdge(geometry, geometry.edges[i]!, ref.point));
  return pick === null ? null : { index: pick, by: "proximity" };
}

/** Name of the edge that lies closest to a face: the edge a fillet or chamfer face replaces. */
export function nearestNamedEdge(
  body: NamedBody,
  edgeIndices: number[],
  samples: FaceSample[],
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const i of edgeIndices) {
    const edge = body.geometry.edges[i];
    const name = body.names.edges[i];
    if (!edge || !name) continue;
    const d = Math.min(...samples.map((s) => distanceToEdge(body.geometry, edge, s.point)));
    if (d < bestD) {
      bestD = d;
      best = name.key;
    }
  }
  return best;
}

// -------------------------------------------------------------------- vertices

const vertexAt = (g: BodyGeometry, index: number): Vec3 => ({
  x: g.vertices[index * 3]!,
  y: g.vertices[index * 3 + 1]!,
  z: g.vertices[index * 3 + 2]!,
});

/**
 * Reference to a vertex. Vertices carry no name of their own: a vertex is where edges meet, so
 * it is identified by the names of those edges.
 */
export function makeVertexRef(
  body: NamedBody,
  bodyId: string,
  vertexIndex: number,
): Extract<Point3Ref, { type: "vertex" }> | null {
  const count = body.geometry.vertices.length / 3;
  if (vertexIndex < 0 || vertexIndex >= count) return null;
  const point = vertexAt(body.geometry, vertexIndex);
  const edges: string[] = [];
  body.geometry.edges.forEach((e, i) => {
    const name = body.names.edges[i];
    if (name && (distance(e.from, point) < 1e-6 || distance(e.to, point) < 1e-6)) {
      edges.push(name.key);
    }
  });
  return { type: "vertex", bodyId, edges, index: vertexIndex, count, point };
}

/**
 * Position of the vertex a reference points at. Order: the vertex at which most of the named
 * edges meet; the index while the body has as many vertices as it had; the nearest vertex.
 */
export function resolveVertexRef(
  ref: Extract<Point3Ref, { type: "vertex" }>,
  body: NamedBody,
): Vec3 | null {
  const g = body.geometry;
  const count = g.vertices.length / 3;
  if (count === 0) return null;
  if (ref.edges && ref.edges.length > 0) {
    const wanted = new Set(ref.edges);
    const ends: Vec3[] = [];
    g.edges.forEach((e, i) => {
      const name = body.names.edges[i];
      if (name && wanted.has(name.key)) ends.push(e.from, e.to);
    });
    let best: Vec3 | null = null;
    let bestMeet = 0;
    let bestD = Infinity;
    for (const p of ends) {
      const meet = ends.filter((q) => distance(p, q) < 1e-6).length;
      const d = distance(p, ref.point);
      if (meet > bestMeet || (meet === bestMeet && d < bestD)) {
        best = p;
        bestMeet = meet;
        bestD = d;
      }
    }
    // One edge alone does not tell which of its two ends is meant.
    if (best && (bestMeet >= 2 || wanted.size === 1)) return best;
  }
  if (ref.index !== undefined && ref.count === count && ref.index < count) {
    return vertexAt(g, ref.index);
  }
  let nearest: Vec3 | null = null;
  let nearestD = Infinity;
  for (let i = 0; i < count; i++) {
    const v = vertexAt(g, i);
    const d = distance(v, ref.point);
    if (d < nearestD) {
      nearestD = d;
      nearest = v;
    }
  }
  return nearest;
}
