import type { Vec3 } from "@fabcad/geometry";
import type { Orientation, PrintMesh } from "./types";

export interface MeshBounds {
  min: Vec3;
  max: Vec3;
}

export function meshBounds(mesh: PrintMesh): MeshBounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    if (p[i]! < min.x) min.x = p[i]!;
    if (p[i + 1]! < min.y) min.y = p[i + 1]!;
    if (p[i + 2]! < min.z) min.z = p[i + 2]!;
    if (p[i]! > max.x) max.x = p[i]!;
    if (p[i + 1]! > max.y) max.y = p[i + 1]!;
    if (p[i + 2]! > max.z) max.z = p[i + 2]!;
  }
  if (p.length === 0) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  return { min, max };
}

/**
 * Merge vertices that share a position and drop degenerate triangles. Kernels tessellate face
 * by face and repeat the vertices along shared edges; slicers expect one connected surface.
 */
export function weldMesh(mesh: PrintMesh, tolerance = 1e-4): PrintMesh {
  const p = mesh.positions;
  const q = 1 / tolerance;
  const lookup = new Map<string, number>();
  const remap = new Uint32Array(p.length / 3);
  const positions: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = p[i * 3]!;
    const y = p[i * 3 + 1]!;
    const z = p[i * 3 + 2]!;
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      positions.push(x, y, z);
      lookup.set(key, index);
    }
    remap[i] = index;
  }
  const indices: number[] = [];
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!;
    const b = remap[mesh.indices[t + 1]!]!;
    const c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Number of edges that do not have exactly two triangles: 0 for a closed surface. */
export function openEdges(mesh: PrintMesh): number {
  const count = new Map<string, number>();
  const ix = mesh.indices;
  for (let t = 0; t + 2 < ix.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = ix[t + k]!;
      const b = ix[t + ((k + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of count.values()) if (n !== 2) open += 1;
  return open;
}

/** Calls `fn` with the corner coordinates, the area-weighted normal (length = 2 · area). */
function forEachTriangle(
  mesh: PrintMesh,
  fn: (t: number, a: number, b: number, c: number, nx: number, ny: number, nz: number) => void,
): void {
  const p = mesh.positions;
  const ix = mesh.indices;
  for (let t = 0; t * 3 + 2 < ix.length; t++) {
    const a = ix[t * 3]! * 3;
    const b = ix[t * 3 + 1]! * 3;
    const c = ix[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    fn(t, a, b, c, uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
}

/** Signed volume (mm³): positive when the triangles face outwards. */
export function meshVolume(mesh: PrintMesh): number {
  const p = mesh.positions;
  let v = 0;
  forEachTriangle(mesh, (_t, a, b, c) => {
    v +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  });
  return v / 6;
}

export function meshArea(mesh: PrintMesh): number {
  let area = 0;
  forEachTriangle(mesh, (_t, _a, _b, _c, nx, ny, nz) => {
    area += Math.hypot(nx, ny, nz) / 2;
  });
  return area;
}

const AXES: Record<string, Vec3> = {
  "+x": { x: 1, y: 0, z: 0 },
  "-x": { x: -1, y: 0, z: 0 },
  "+y": { x: 0, y: 1, z: 0 },
  "-y": { x: 0, y: -1, z: 0 },
  "+z": { x: 0, y: 0, z: 1 },
  "-z": { x: 0, y: 0, z: -1 },
};

export function orientationVector(orientation: Exclude<Orientation, "auto">): Vec3 {
  if (typeof orientation === "string") return AXES[orientation]!;
  const d = orientation.down;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

/** Rotation (row-major 3 × 3) that turns the unit vector `down` into −Z. */
export function rotationToDown(down: Vec3): number[] {
  // Rodrigues' formula for the rotation from `down` to (0, 0, −1).
  const c = -down.z;
  if (c > 1 - 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // Opposite: half a turn about X.
  if (c < -1 + 1e-12) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  // axis = down × (0, 0, −1)
  const ax = -down.y;
  const ay = down.x;
  const k = 1 / (1 + c);
  return [
    c + ax * ax * k, ax * ay * k, ay,
    ax * ay * k, c + ay * ay * k, -ax,
    -ay, ax, c,
  ];
}

/**
 * Turn the mesh so that `down` points at the bed and move it so that its bounding box starts
 * at the origin (resting on Z = 0).
 */
export function orientMesh(mesh: PrintMesh, down: Vec3): PrintMesh {
  const r = rotationToDown(down);
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  // Rotate in double precision, shift, then store.
  const tmp = new Float64Array(src.length);
  for (let i = 0; i + 2 < src.length; i += 3) {
    const x = src[i]!;
    const y = src[i + 1]!;
    const z = src[i + 2]!;
    const rx = r[0]! * x + r[1]! * y + r[2]! * z;
    const ry = r[3]! * x + r[4]! * y + r[5]! * z;
    const rz = r[6]! * x + r[7]! * y + r[8]! * z;
    tmp[i] = rx;
    tmp[i + 1] = ry;
    tmp[i + 2] = rz;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rz < minZ) minZ = rz;
  }
  for (let i = 0; i + 2 < src.length; i += 3) {
    out[i] = tmp[i]! - minX;
    out[i + 1] = tmp[i + 1]! - minY;
    out[i + 2] = tmp[i + 2]! - minZ;
  }
  return { positions: out, indices: mesh.indices };
}

export function translateMesh(mesh: PrintMesh, dx: number, dy: number, dz = 0): PrintMesh {
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i] = mesh.positions[i]! + dx;
    out[i + 1] = mesh.positions[i + 1]! + dy;
    out[i + 2] = mesh.positions[i + 2]! + dz;
  }
  return { positions: out, indices: mesh.indices };
}

export interface OverhangReport {
  /** 1 per triangle that needs support. */
  flags: Uint8Array;
  /** mm² */
  area: number;
  /** Area resting on the bed, mm². */
  contactArea: number;
}

/**
 * Overhangs of a mesh standing on Z = 0. A downward face needs support when it leans further
 * from vertical than `angle` degrees; faces lying on the bed do not.
 */
export function analyzeOverhangs(mesh: PrintMesh, angle: number): OverhangReport {
  const p = mesh.positions;
  const flags = new Uint8Array(Math.floor(mesh.indices.length / 3));
  const limit = -Math.sin((Math.max(0, Math.min(89.9, angle)) * Math.PI) / 180);
  let area = 0;
  let contactArea = 0;
  forEachTriangle(mesh, (t, a, b, c, nx, ny, nz) => {
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    const onBed = p[a + 2]! < 1e-3 && p[b + 2]! < 1e-3 && p[c + 2]! < 1e-3;
    if (onBed) {
      if (nz < 0) contactArea += len / 2;
      return;
    }
    if (nz / len < limit - 1e-9) {
      flags[t] = 1;
      area += len / 2;
    }
  });
  return { flags, area, contactArea };
}

/**
 * Directions worth trying as "down": the six axes and the normals of the largest flat areas
 * of the mesh (a part usually prints best lying on one of its big faces).
 */
export function candidateDirections(mesh: PrintMesh, limit = 12): Vec3[] {
  const buckets = new Map<string, { n: Vec3; area: number }>();
  forEachTriangle(mesh, (_t, _a, _b, _c, nx, ny, nz) => {
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    const n = { x: nx / len, y: ny / len, z: nz / len };
    const key = `${Math.round(n.x * 50)},${Math.round(n.y * 50)},${Math.round(n.z * 50)}`;
    const b = buckets.get(key);
    if (b) b.area += len / 2;
    else buckets.set(key, { n, area: len / 2 });
  });
  const flat = [...buckets.values()].sort((a, b) => b.area - a.area).slice(0, limit);
  const out: Vec3[] = Object.values(AXES).slice();
  for (const f of flat) {
    if (!out.some((d) => d.x * f.n.x + d.y * f.n.y + d.z * f.n.z > 0.9995)) out.push(f.n);
  }
  return out;
}

/** The direction with the least overhang; ties go to more bed contact, then to a lower part. */
export function autoOrient(mesh: PrintMesh, angle: number): Vec3 {
  let best: { down: Vec3; score: number[] } | null = null;
  for (const down of candidateDirections(mesh)) {
    const oriented = orientMesh(mesh, down);
    const report = analyzeOverhangs(oriented, angle);
    const height = meshBounds(oriented).max.z;
    const score = [Math.round(report.area * 100) / 100, -Math.round(report.contactArea), height];
    if (!best || compare(score, best.score) < 0) best = { down, score };
  }
  return best ? best.down : { x: 0, y: 0, z: -1 };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-6) return a[i]! - b[i]!;
  }
  return 0;
}
