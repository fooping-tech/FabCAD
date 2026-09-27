import { type SolidTopology, meshToTopology } from "@fabcad/geometry";
import type { BodyGeometry } from "./kernel";

/** Derive the polyhedral topology of a body from its tessellation. Pure; no kernel needed. */
export function topologyFromGeometry(geometry: BodyGeometry): SolidTopology {
  return meshToTopology({
    positions: geometry.positions,
    indices: geometry.indices,
    faceGroups: geometry.faces.map((f) => ({
      faceIndex: f.faceIndex,
      start: f.start,
      count: f.count,
      surface: f.surface === "plane" ? "plane" : "curved",
    })),
  });
}
