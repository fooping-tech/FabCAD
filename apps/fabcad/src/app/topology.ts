import type { TopologyRef } from "@fabcad/cad-document";
import {
  type NamedBody,
  makeEdgeRef,
  makeFaceRef,
  resolveEdgeRef,
  resolveFaceRef,
} from "@fabcad/features";
import type { Vec3 } from "@fabcad/geometry";
import { modelState } from "./session";

/**
 * Persistent references for what the user picks in the 3D view. A pick is an index into the
 * tessellation on screen; what is stored in a feature is the name of the face or edge.
 */

function namedBody(bodyId: string): NamedBody | null {
  const b = modelState.get().bodies[bodyId];
  return b ? { geometry: b.geometry, names: b.names } : null;
}

export function edgeRefOf(bodyId: string, edgeIndex: number, point: Vec3): TopologyRef {
  const body = namedBody(bodyId);
  return (body && makeEdgeRef(body, edgeIndex)) ?? { kind: "edge", point };
}

export function faceRefOf(bodyId: string, faceIndex: number, point: Vec3, normal?: Vec3): TopologyRef {
  const body = namedBody(bodyId);
  const ref = body && makeFaceRef(body, faceIndex);
  if (ref) return ref;
  return normal ? { kind: "face", point, normal } : { kind: "face", point };
}

/** Index of the edge a reference points at in the body as it is shown, or -1. */
export function edgeIndexOf(bodyId: string, ref: TopologyRef): number {
  const body = namedBody(bodyId);
  return (body && resolveEdgeRef(ref, body)?.index) ?? -1;
}

export function faceIndexOf(bodyId: string, ref: TopologyRef): number {
  const body = namedBody(bodyId);
  return (body && resolveFaceRef(ref, body)?.index) ?? -1;
}
