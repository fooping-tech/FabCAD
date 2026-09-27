import {
  type SolidTopology,
  type TopoEdge,
  type TopoFace,
  type Vec2,
  type Vec3,
  cross3,
  norm3,
  prismTopology,
  sub3,
} from "@fabcad/geometry";
import {
  type CadBody,
  type FlatPart,
  DEFAULT_MATERIALS,
  type MaterialProfile,
} from "@fabcad/fabrication-core";

export const material = (id: string): MaterialProfile => {
  const m = DEFAULT_MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown material ${id}`);
  return m;
};

export const MDF = material("mdf-5.5");
export const PAPER = material("paper-0.2");

export const body = (topology: SolidTopology, id = "body"): CadBody => ({
  id,
  name: id,
  topology,
});

export const rectangle = (w: number, h: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

export const regularPolygon = (n: number, radius: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({
    x: radius * Math.cos((2 * Math.PI * i) / n),
    y: radius * Math.sin((2 * Math.PI * i) / n),
  }));

export const starPolygon = (points: number, outer: number, inner: number): Vec2[] =>
  Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (Math.PI * i) / points;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });

export const boxBody = (): CadBody => body(prismTopology(rectangle(100, 80), 50), "box");
export const hexBody = (): CadBody => body(prismTopology(regularPolygon(6, 40), 60), "hex");
export const starBody = (): CadBody => body(prismTopology(starPolygon(5, 60, 25), 40), "star");
export const triangleBody = (): CadBody =>
  body(prismTopology(regularPolygon(3, 50), 40), "triangle");
/** A facetted cylinder: the side facets are flagged as one curved face. */
export const cylinderBody = (segments = 24): CadBody => {
  const topology = prismTopology(regularPolygon(segments, 30), 50);
  for (const face of topology.faces) {
    if (face.id >= 2) {
      face.surface = "curved";
      face.sourceFace = 2;
    }
  }
  for (const edge of topology.edges) {
    edge.smooth = edge.faces.every((f) => f >= 2);
  }
  return body(topology, "cylinder");
};

/** Build a topology from vertices and outer loops only (hand-made, not a prism). */
export function topologyFromLoops(vertices: Vec3[], loops: number[][]): SolidTopology {
  const faces: TopoFace[] = loops.map((loop, id) => {
    // Newell normal; loops are counter-clockwise seen from outside.
    let n: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 1; i + 1 < loop.length; i++) {
      const c = cross3(
        sub3(vertices[loop[i]!]!, vertices[loop[0]!]!),
        sub3(vertices[loop[i + 1]!]!, vertices[loop[0]!]!),
      );
      n = { x: n.x + c.x, y: n.y + c.y, z: n.z + c.z };
    }
    return { id, sourceFace: id, surface: "plane", normal: norm3(n), loops: [loop] };
  });
  const map = new Map<string, TopoEdge>();
  for (const f of faces) {
    const loop = f.loops[0]!;
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let e = map.get(key);
      if (!e) {
        e = { id: map.size, a: Math.min(a, b), b: Math.max(a, b), faces: [], smooth: false };
        map.set(key, e);
      }
      e.faces.push(f.id);
    });
  }
  return { vertices, faces, edges: [...map.values()] };
}

/** Square pyramid: 80 × 80 base, apex 60 above the centre. */
export const pyramidBody = (): CadBody =>
  body(
    topologyFromLoops(
      [
        { x: 0, y: 0, z: 0 },
        { x: 80, y: 0, z: 0 },
        { x: 80, y: 80, z: 0 },
        { x: 0, y: 80, z: 0 },
        { x: 40, y: 40, z: 60 },
      ],
      [
        [0, 3, 2, 1],
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
    ),
    "pyramid",
  );

/** Truncated pyramid (frustum): 100 × 100 base, 60 × 60 top, height 50. */
export const frustumBody = (): CadBody =>
  body(
    topologyFromLoops(
      [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 100, y: 100, z: 0 },
        { x: 0, y: 100, z: 0 },
        { x: 20, y: 20, z: 50 },
        { x: 80, y: 20, z: 50 },
        { x: 80, y: 80, z: 50 },
        { x: 20, y: 80, z: 50 },
      ],
      [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ],
    ),
    "frustum",
  );

export const size = (part: FlatPart): { width: number; height: number } => ({
  width: part.bounds.maxX - part.bounds.minX,
  height: part.bounds.maxY - part.bounds.minY,
});

export const polygonSize = (poly: readonly Vec2[]): { width: number; height: number } => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

/** Map a point of a part into model space through the part frame. */
export const toWorld = (part: FlatPart, p: Vec2, depth = 0): Vec3 => {
  const f = part.frame;
  if (!f) throw new Error("part has no frame");
  return {
    x: f.origin.x + f.xDir.x * p.x + f.yDir.x * p.y - f.normal.x * depth,
    y: f.origin.y + f.xDir.y * p.x + f.yDir.y * p.y - f.normal.y * depth,
    z: f.origin.z + f.xDir.z * p.x + f.yDir.z * p.y - f.normal.z * depth,
  };
};

export const toPart = (part: FlatPart, p: Vec3): Vec2 => {
  const f = part.frame;
  if (!f) throw new Error("part has no frame");
  const d = sub3(p, f.origin);
  return {
    x: d.x * f.xDir.x + d.y * f.xDir.y + d.z * f.xDir.z,
    y: d.x * f.yDir.x + d.y * f.yDir.y + d.z * f.yDir.z,
  };
};
