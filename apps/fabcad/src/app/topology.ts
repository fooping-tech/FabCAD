import type { Point3Ref, TopologyRef } from "@fabcad/cad-document";
import {
  type NamedBody,
  makeEdgeRef,
  makeFaceRef,
  makeVertexRef,
  resolveEdgeRef,
  resolveFaceRef,
  resolveVertexRef,
} from "@fabcad/features";
import type { Vec3 } from "@fabcad/geometry";
import type { Selection } from "./appState";
import { modelState } from "./session";
import { type Picked, featureOfFace } from "./solidDialogs";

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

export function vertexRefOf(
  bodyId: string,
  vertexIndex: number,
  point: Vec3,
): Extract<Point3Ref, { type: "vertex" }> {
  const body = namedBody(bodyId);
  return (body && makeVertexRef(body, bodyId, vertexIndex)) ?? { type: "vertex", bodyId, point };
}

/** Where a referenced vertex is in the body as it is shown, or null. */
export function vertexPointOf(ref: Extract<Point3Ref, { type: "vertex" }>): Vec3 | null {
  const body = namedBody(ref.bodyId);
  return body ? resolveVertexRef(ref, body) : null;
}

/** Faces of the bodies on screen that a feature made, by the names of the faces. */
export function facesOfFeatures(featureIds: readonly string[]): { bodyId: string; faceIndex: number }[] {
  if (featureIds.length === 0) return [];
  const wanted = new Set(featureIds);
  const out: { bodyId: string; faceIndex: number }[] = [];
  for (const b of Object.values(modelState.get().bodies)) {
    b.names.faces.forEach((name, faceIndex) => {
      if (wanted.has(name.feature)) out.push({ bodyId: b.id, faceIndex });
    });
  }
  return out;
}

/** What is selected or hovered, in the form a feature dialog stores it. */
export function pickedOf(s: Selection): Picked | null {
  switch (s.kind) {
    case "body":
      return { kind: "body", bodyId: s.bodyId };
    case "face":
      return {
        kind: "face",
        bodyId: s.bodyId,
        faceIndex: s.faceIndex,
        ref: faceRefOf(s.bodyId, s.faceIndex, s.point, s.normal),
        planar: s.planar,
        featureId: featureOfFace(modelState.get().bodies[s.bodyId]?.names, s.faceIndex),
      };
    case "edge":
      return {
        kind: "edge",
        bodyId: s.bodyId,
        ref: edgeRefOf(s.bodyId, s.edgeIndex, s.point),
        curve: modelState.get().bodies[s.bodyId]?.geometry.edges[s.edgeIndex]?.curve ?? "other",
      };
    case "vertex":
      return { kind: "vertex", ref: vertexRefOf(s.bodyId, s.vertexIndex, s.point) };
    case "origin-plane":
      return { kind: "origin-plane", plane: s.plane };
    case "plane":
      return { kind: "plane", featureId: s.featureId };
    case "entity":
      return { kind: "entity", sketchId: s.sketchId, entityId: s.entityId };
    case "profile":
      return { kind: "profile", sketchId: s.sketchId, ref: s.ref };
    case "feature":
      return { kind: "feature", featureId: s.featureId };
    case "text":
    case "constraint":
    case "dimension":
      return null;
  }
}
