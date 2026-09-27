import type { Vec3 } from "@fabcad/geometry";
import type { ProfileRef, Sketch } from "@fabcad/sketch";

/**
 * Feature definitions. A feature is serialisable data describing one step of the design
 * history; evaluating it is the job of the feature engine, not of this package.
 */

/** Persistent reference to a B-Rep edge: a point on the edge, matched by proximity on recompute. */
export interface EdgeRef {
  point: Vec3;
}

/** Persistent reference to a B-Rep face: a point on the face and its normal there. */
export interface FaceRef {
  point: Vec3;
  normal?: Vec3;
}

export type BodyOperation = "new" | "join" | "cut" | "intersect";
export type ExtrudeDirection = "positive" | "negative" | "symmetric";

export interface FeatureBase {
  id: string;
  name: string;
  componentId: string;
  suppressed: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  sketch: Sketch;
  visible: boolean;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketchId: string;
  profiles: ProfileRef[];
  /** Length expression. */
  distance: string;
  direction: ExtrudeDirection;
  operation: BodyOperation;
  /** Bodies modified by join / cut / intersect. */
  targetBodyIds: string[];
  /** Body created when `operation` is "new". */
  bodyId: string;
}

export type RevolveAxis =
  | { type: "sketch-line"; entityId: string }
  | { type: "origin-axis"; axis: "X" | "Y" | "Z" };

export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  sketchId: string;
  profiles: ProfileRef[];
  axis: RevolveAxis;
  /** Angle expression in degrees. */
  angle: string;
  operation: BodyOperation;
  targetBodyIds: string[];
  bodyId: string;
}

export interface BooleanFeature extends FeatureBase {
  type: "boolean";
  operation: "union" | "cut" | "intersect";
  targetBodyId: string;
  toolBodyIds: string[];
  keepTools: boolean;
}

export interface FilletFeature extends FeatureBase {
  type: "fillet";
  bodyId: string;
  edges: EdgeRef[];
  radius: string;
}

export interface ChamferFeature extends FeatureBase {
  type: "chamfer";
  bodyId: string;
  edges: EdgeRef[];
  distance: string;
}

export interface ShellFeature extends FeatureBase {
  type: "shell";
  bodyId: string;
  /** Faces removed to open the shell. */
  faces: FaceRef[];
  thickness: string;
}

export interface ImportFeature extends FeatureBase {
  type: "import";
  format: "step";
  fileName: string;
  /** Base64 encoded file contents, so that projects stay self-contained. */
  data: string;
  bodyId: string;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | BooleanFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | ImportFeature;

export type FeatureType = Feature["type"];

export const FEATURE_LABELS: Record<FeatureType, string> = {
  sketch: "Sketch",
  extrude: "Extrude",
  revolve: "Revolve",
  boolean: "Combine",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  import: "Import",
};

/** Expressions used by a feature, with the unit kind each one is expected to evaluate to. */
export function featureExpressions(
  feature: Feature,
): { key: string; expression: string; kind: "length" | "angle" }[] {
  switch (feature.type) {
    case "sketch":
      return Object.values(feature.sketch.dimensions)
        .filter((d) => d.driving)
        .map((d) => ({
          key: `dimension:${d.id}`,
          expression: d.expression,
          kind: d.type === "angle" ? ("angle" as const) : ("length" as const),
        }));
    case "extrude":
      return [{ key: "distance", expression: feature.distance, kind: "length" }];
    case "revolve":
      return [{ key: "angle", expression: feature.angle, kind: "angle" }];
    case "fillet":
      return [{ key: "radius", expression: feature.radius, kind: "length" }];
    case "chamfer":
      return [{ key: "distance", expression: feature.distance, kind: "length" }];
    case "shell":
      return [{ key: "thickness", expression: feature.thickness, kind: "length" }];
    case "boolean":
    case "import":
      return [];
  }
}

/** Bodies a feature reads and modifies in place. */
export function featureInputBodies(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
      return feature.operation === "new" ? [] : feature.targetBodyIds.slice();
    case "boolean":
      return [feature.targetBodyId, ...feature.toolBodyIds];
    case "fillet":
    case "chamfer":
    case "shell":
      return [feature.bodyId];
    case "sketch": {
      const plane = feature.sketch.plane;
      const ids = feature.sketch.projections.map((p) => p.bodyId);
      if (plane.type === "face") ids.push(plane.bodyId);
      return [...new Set(ids)];
    }
    case "import":
      return [];
  }
}

/** Bodies that exist (or change) after the feature has run. */
export function featureOutputBodies(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
      return feature.operation === "new" ? [feature.bodyId] : feature.targetBodyIds.slice();
    case "boolean":
      return [feature.targetBodyId];
    case "fillet":
    case "chamfer":
    case "shell":
      return [feature.bodyId];
    case "import":
      return [feature.bodyId];
    case "sketch":
      return [];
  }
}

/** Bodies that a feature creates (as opposed to modifies). */
export function featureCreatedBodies(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
      return feature.operation === "new" ? [feature.bodyId] : [];
    case "import":
      return [feature.bodyId];
    default:
      return [];
  }
}

/** Bodies consumed (removed) by the feature. */
export function featureConsumedBodies(feature: Feature): string[] {
  if (feature.type === "boolean" && !feature.keepTools) return feature.toolBodyIds.slice();
  return [];
}

/** Sketches (feature ids) a feature reads. */
export function featureInputSketches(feature: Feature): string[] {
  return feature.type === "extrude" || feature.type === "revolve" ? [feature.sketchId] : [];
}
