import type { Vec3 } from "./vec";

/**
 * What a face or edge looked like when it was referenced. Used to tell candidates apart when
 * the name alone does not decide, before falling back to position.
 */
export interface GeometricSignature {
  center?: Vec3;
  normal?: Vec3;
  direction?: Vec3;
  length?: number;
  area?: number;
  radius?: number;
  surfaceType?: string;
  curveType?: string;
}

/**
 * Persistent reference to a face or an edge of a body.
 *
 * Faces are named after the feature that made them and the part they play in it, e.g. "the side
 * face of Extrude001 that comes from sketch line l7". Edges are named by the faces that meet
 * there. Such a name survives changes of size and position, which a point in space does not.
 *
 * Resolution order on recompute: name (feature provenance, sketch entity provenance, role),
 * then the geometric signature, and only then proximity to `point`.
 */
export interface TopologyRef {
  kind?: "face" | "edge";
  /** Canonical name of the face or edge in the body it was picked from. */
  name?: string;
  sourceFeatureId?: string;
  sourceSketchId?: string;
  sourceEntityId?: string;
  role?: string;
  /** For edges: the names of the faces that meet at the edge. */
  faces?: string[];
  signature?: GeometricSignature;
  /** Fallback: a point on the face or edge. Files from before names existed have only this. */
  point: Vec3;
  normal?: Vec3;
}

