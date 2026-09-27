import type { PrintMesh } from "./types";

/** Binary STL of one or more meshes. STL has no unit; the numbers are millimetres. */
export function writeBinaryStl(meshes: PrintMesh[], header = "FabCAD"): Uint8Array {
  const count = meshes.reduce((n, m) => n + Math.floor(m.indices.length / 3), 0);
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // A header starting with "solid" makes some readers take the file for ASCII.
  const text = header.replace(/^solid/i, "model").slice(0, 80);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
  view.setUint32(80, count, true);
  let o = 84;
  for (const mesh of meshes) {
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
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      view.setFloat32(o, nx, true);
      view.setFloat32(o + 4, ny, true);
      view.setFloat32(o + 8, nz, true);
      for (const [k, v] of [a, b, c].entries()) {
        view.setFloat32(o + 12 + k * 12, p[v]!, true);
        view.setFloat32(o + 16 + k * 12, p[v + 1]!, true);
        view.setFloat32(o + 20 + k * 12, p[v + 2]!, true);
      }
      o += 50;
    }
  }
  return bytes;
}
