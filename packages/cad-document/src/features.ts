import type { GeometricSignature, OriginPlaneName, TopologyRef, Vec3 } from "@fabcad/geometry";

export type { GeometricSignature, TopologyRef };
import { type EntityId, type ProfileRef, type Sketch, setTextExpression, textExpressions } from "@fabcad/sketch";

/**
 * Feature definitions. A feature is serialisable data describing one step of the design
 * history; evaluating it is the job of the feature engine, not of this package.
 */

export type EdgeRef = TopologyRef;
export type FaceRef = TopologyRef;

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

// ------------------------------------------------------------ dynamic bodies

/**
 * Bodies whose existence depends on evaluated values (the instances of a body pattern, the
 * second half of a split, a mirrored or copied body) cannot get an id from the document counter
 * when the feature is added: how many there are is only known after evaluation. Their id is
 * derived instead: `<featureId>:<sourceBodyId>:<instance>`. Ids handed out by the document never
 * contain a colon, so the two kinds cannot be confused, and the feature that makes such a body
 * can be read from the id.
 */
export function dynamicBodyId(
  featureId: string,
  sourceBodyId: string,
  instance: number | string,
): string {
  return `${featureId}:${sourceBodyId}:${instance}`;
}

export interface DynamicBodyId {
  /** Feature that creates the body. */
  featureId: string;
  /** Body it is derived from. May itself be a dynamic body. */
  sourceBodyId: string;
  /** "1", "2", … or "i.j" for the instances of a two-directional pattern. */
  instance: string;
}

export function parseDynamicBodyId(id: string): DynamicBodyId | null {
  const first = id.indexOf(":");
  const last = id.lastIndexOf(":");
  if (first <= 0 || last <= first || last === id.length - 1) return null;
  return {
    featureId: id.slice(0, first),
    sourceBodyId: id.slice(first + 1, last),
    instance: id.slice(last + 1),
  };
}

// ---------------------------------------------------------- shared references

export type OriginAxisName = "X" | "Y" | "Z";

/**
 * A straight direction: an origin axis, a linear edge of a body (by persistent name) or a line
 * of a sketch.
 */
export type PatternDirection =
  | { type: "origin-axis"; axis: OriginAxisName }
  | { type: "edge"; bodyId: string; ref: EdgeRef }
  | { type: "sketch-line"; sketchId: string; entityId: EntityId };

/**
 * An axis of rotation. Same choices as a direction, but an edge may also be circular: its axis
 * is the line through the centre of the circle, perpendicular to it.
 */
export type PatternAxis =
  | { type: "origin-axis"; axis: OriginAxisName }
  | { type: "edge"; bodyId: string; ref: EdgeRef }
  | { type: "sketch-line"; sketchId: string; entityId: EntityId };

/**
 * What a pattern or mirror repeats.
 *
 * - `features`: the effect of the features is applied again at every instance, to the bodies
 *   the features themselves changed. Instances of a feature that created a body ("new") are
 *   joined to that body.
 * - `bodies`: every instance is a body of its own.
 */
export type PatternSource =
  | { kind: "features"; featureIds: string[] }
  | { kind: "bodies"; bodyIds: string[] };

/** A plane: an origin plane, or the (infinite) plane of a planar face. */
export type PlaneReference =
  | { type: "origin-plane"; plane: OriginPlaneName }
  | { type: "face"; bodyId: string; ref: FaceRef };

export type MirrorPlane = PlaneReference;
export type SplitTool = PlaneReference;

/**
 * A point in space.
 *
 * - `fixed`: world coordinates in mm.
 * - `vertex`: a vertex of a body. Vertices have no name of their own; they are identified by
 *   the names of the edges that meet there (`edges`). `index` / `count` (position among the
 *   vertices of the body, and how many it had) and `point` are the fallbacks, in that order.
 * - `sketch-point`: a point entity of a sketch.
 */
export type Point3Ref =
  | { type: "fixed"; point: Vec3 }
  | {
      type: "vertex";
      bodyId: string;
      edges?: string[];
      index?: number;
      count?: number;
      point: Vec3;
    }
  | { type: "sketch-point"; sketchId: string; entityId: EntityId };

// ---------------------------------------------------------------------- hole

export type HoleType = "simple" | "counterbore" | "countersink";

/**
 * How deep a hole goes. Further kinds (e.g. "to-object") are added as new literals together
 * with an optional field that holds their data, so files written today stay valid.
 */
export type HoleExtent = "distance" | "through-all";

/**
 * One or more holes of the same size, one at each sketch point.
 *
 * The axis is the normal of the sketch plane. A sketch on a face drills into the body, i.e.
 * against the face normal. A sketch on any other plane drills against the plane normal too,
 * unless the body lies entirely on the normal side of the plane, where drilling the other way
 * is the only direction that removes material. `flip` reverses the direction found this way.
 *
 * Room for growth: thread, drill point (`tip`), tapped / clearance sizes are meant to become
 * optional nested objects of this feature; a missing object means "none", as today.
 */
export interface HoleFeature extends FeatureBase {
  type: "hole";
  bodyId: string;
  sketchId: string;
  /** Sketch point entities; one hole each. */
  points: EntityId[];
  holeType: HoleType;
  /** Length expression. */
  diameter: string;
  extent: HoleExtent;
  /** Length expression, measured from the sketch plane. Used when `extent` is "distance". */
  depth: string;
  /** Length expressions. Used when `holeType` is "counterbore". */
  counterboreDiameter: string;
  counterboreDepth: string;
  /** Length expression. Used when `holeType` is "countersink". */
  countersinkDiameter: string;
  /** Included angle of the countersink in degrees (angle expression). */
  countersinkAngle: string;
  flip?: boolean;
}

// ------------------------------------------------------------------ patterns

export interface RectangularPatternFeature extends FeatureBase {
  type: "rectangular-pattern";
  source: PatternSource;
  direction: PatternDirection;
  /** Number of instances along `direction`, the original included. Dimensionless expression. */
  count: string;
  /** Spacing between neighbouring instances (length expression). */
  distance: string;
  flip?: boolean;
  /** Second direction. Without it the pattern is a single row. */
  direction2?: PatternDirection;
  count2?: string;
  distance2?: string;
  flip2?: boolean;
}

export interface CircularPatternFeature extends FeatureBase {
  type: "circular-pattern";
  source: PatternSource;
  axis: PatternAxis;
  /** Number of instances, the original included. Dimensionless expression. */
  count: string;
  /**
   * Total angle in degrees (angle expression). With 360 the instances are spread evenly
   * around the full turn; otherwise the last instance lies at `angle`.
   */
  angle: string;
  flip?: boolean;
}

export interface MirrorFeature extends FeatureBase {
  type: "mirror";
  source: PatternSource;
  plane: MirrorPlane;
}

// ---------------------------------------------------------------- move / align

export type MoveTransform =
  /** Length expressions along the world axes. */
  | { type: "translate"; x: string; y: string; z: string }
  /** `angle` is an angle expression in degrees, counter-clockwise about the axis. */
  | { type: "rotate"; axis: PatternAxis; angle: string }
  /** Translation that takes `from` to `to`. */
  | { type: "point-to-point"; from: Point3Ref; to: Point3Ref };

export interface MoveFeature extends FeatureBase {
  type: "move";
  bodyIds: string[];
  /** Leave the bodies where they are and move a copy of each. */
  copy: boolean;
  transform: MoveTransform;
}

interface AlignBase extends FeatureBase {
  type: "align";
  /** Body that moves. */
  bodyId: string;
}

/**
 * Moves `bodyId` so that `from` (on the moving body) coincides with `to`.
 *
 * - face-to-face: both faces planar. The body is turned until the normals are opposite (the
 *   faces touch) and shifted until the face centres coincide. `flip` makes the normals equal
 *   instead, i.e. the faces end up flush, looking the same way.
 * - point-to-point: a translation.
 */
export type AlignFeature =
  | (AlignBase & {
      mode: "face-to-face";
      from: FaceRef;
      to: { bodyId: string; ref: FaceRef };
      flip?: boolean;
    })
  | (AlignBase & { mode: "point-to-point"; from: Point3Ref; to: Point3Ref; flip?: boolean });

// --------------------------------------------------------------------- split

/**
 * Cut a body in two with a plane. "Positive" is the side the plane normal points to (for a
 * face: the outside of the body the face belongs to).
 *
 * The body keeps its id: with `keep: "both"` it becomes the positive side and the negative
 * side is the new body `<featureId>:<bodyId>:1`; otherwise it becomes the side that is kept.
 */
export interface SplitFeature extends FeatureBase {
  type: "split";
  bodyId: string;
  tool: SplitTool;
  keep: "both" | "positive" | "negative";
}

// -------------------------------------------------------------- sweep / loft

/**
 * A chain of sketch curves (lines, arcs, splines) that join end to end. The order in
 * `entityIds` does not matter; the chain is put in order when the feature is evaluated.
 */
export interface SweepPath {
  sketchId: string;
  entityIds: EntityId[];
}

export interface SweepFeature extends FeatureBase {
  type: "sweep";
  sketchId: string;
  profiles: ProfileRef[];
  path: SweepPath;
  operation: BodyOperation;
  targetBodyIds: string[];
  bodyId: string;
  /**
   * How the profile is carried along the path. "perpendicular": it keeps the angle to the path
   * that it has at the start. Twist, guide rails … come as further optional fields.
   */
  orientation: "perpendicular";
}

export type LoftSection =
  | { type: "profile"; sketchId: string; profile: ProfileRef }
  /** A planar face: its outer boundary is the section. */
  | { type: "face"; bodyId: string; ref: FaceRef };

export interface LoftFeature extends FeatureBase {
  type: "loft";
  /** At least two, in the order the loft passes through them. */
  sections: LoftSection[];
  operation: BodyOperation;
  targetBodyIds: string[];
  bodyId: string;
  /** Straight lines between neighbouring sections instead of a smooth surface. */
  ruled?: boolean;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | BooleanFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | ImportFeature
  | HoleFeature
  | RectangularPatternFeature
  | CircularPatternFeature
  | MirrorFeature
  | MoveFeature
  | AlignFeature
  | SplitFeature
  | SweepFeature
  | LoftFeature;

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
  hole: "Hole",
  "rectangular-pattern": "Rectangular Pattern",
  "circular-pattern": "Circular Pattern",
  mirror: "Mirror",
  move: "Move",
  align: "Align",
  split: "Split Body",
  sweep: "Sweep",
  loft: "Loft",
};

/**
 * An expression of a feature. `key` is the path of the field that holds it ("distance",
 * "transform.x"); `kind` is the unit the value is expected to have, "none" for counts.
 */
export interface FeatureExpression {
  key: string;
  expression: string;
  kind: "length" | "angle" | "none";
}

/**
 * Expressions used by a feature. Only the ones that take part in the evaluation are listed: the
 * depth of a hole that goes through all is not, so a parameter used only there does not make
 * the hole depend on it.
 */
export function featureExpressions(feature: Feature): FeatureExpression[] {
  switch (feature.type) {
    case "sketch":
      return [
        ...Object.values(feature.sketch.dimensions)
          .filter((d) => d.driving)
          .map((d) => ({
            key: `dimension:${d.id}`,
            expression: d.expression,
            kind: d.type === "angle" ? ("angle" as const) : ("length" as const),
          })),
        ...Object.values(feature.sketch.texts ?? {}).flatMap((t) =>
          textExpressions(t).map((e) => ({
            key: `text:${t.id}:${e.field}`,
            expression: e.expression,
            kind: e.kind,
          })),
        ),
      ];
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
    case "hole": {
      const out: FeatureExpression[] = [
        { key: "diameter", expression: feature.diameter, kind: "length" },
      ];
      if (feature.extent === "distance") {
        out.push({ key: "depth", expression: feature.depth, kind: "length" });
      }
      if (feature.holeType === "counterbore") {
        out.push(
          { key: "counterboreDiameter", expression: feature.counterboreDiameter, kind: "length" },
          { key: "counterboreDepth", expression: feature.counterboreDepth, kind: "length" },
        );
      }
      if (feature.holeType === "countersink") {
        out.push(
          { key: "countersinkDiameter", expression: feature.countersinkDiameter, kind: "length" },
          { key: "countersinkAngle", expression: feature.countersinkAngle, kind: "angle" },
        );
      }
      return out;
    }
    case "rectangular-pattern": {
      const out: FeatureExpression[] = [
        { key: "count", expression: feature.count, kind: "none" },
        { key: "distance", expression: feature.distance, kind: "length" },
      ];
      if (feature.direction2) {
        out.push(
          { key: "count2", expression: feature.count2 ?? "1", kind: "none" },
          { key: "distance2", expression: feature.distance2 ?? "0", kind: "length" },
        );
      }
      return out;
    }
    case "circular-pattern":
      return [
        { key: "count", expression: feature.count, kind: "none" },
        { key: "angle", expression: feature.angle, kind: "angle" },
      ];
    case "move": {
      const t = feature.transform;
      if (t.type === "translate") {
        return [
          { key: "transform.x", expression: t.x, kind: "length" },
          { key: "transform.y", expression: t.y, kind: "length" },
          { key: "transform.z", expression: t.z, kind: "length" },
        ];
      }
      if (t.type === "rotate") {
        return [{ key: "transform.angle", expression: t.angle, kind: "angle" }];
      }
      return [];
    }
    case "boolean":
    case "import":
    case "mirror":
    case "align":
    case "split":
    case "sweep":
    case "loft":
      return [];
  }
}

/**
 * Write an expression back by the key `featureExpressions` reported it under. Keys are paths
 * ("transform.x"), so that code which edits expressions need not know the feature types.
 * Returns the same object when the key does not name an expression of the feature.
 */
export function setFeatureExpression(feature: Feature, key: string, expression: string): Feature {
  if (feature.type === "sketch" && key.startsWith("text:")) {
    const [, id = "", field = ""] = key.split(":");
    const text = feature.sketch.texts?.[id];
    const next = text ? setTextExpression(text, field, expression) : text;
    if (!text || !next || next === text) return feature;
    return {
      ...feature,
      sketch: { ...feature.sketch, texts: { ...feature.sketch.texts, [id]: next } },
    };
  }
  if (feature.type === "sketch") {
    const id = key.startsWith("dimension:") ? key.slice("dimension:".length) : "";
    const d = feature.sketch.dimensions[id];
    if (!d || d.expression === expression) return feature;
    return {
      ...feature,
      sketch: {
        ...feature.sketch,
        dimensions: { ...feature.sketch.dimensions, [id]: { ...d, expression } },
      },
    };
  }
  if (!featureExpressions(feature).some((e) => e.key === key)) return feature;
  const set = (node: unknown, path: string[]): unknown => {
    const [head, ...rest] = path;
    if (head === undefined) return expression;
    const record = (typeof node === "object" && node !== null ? node : {}) as Record<string, unknown>;
    return { ...record, [head]: set(record[head], rest) };
  };
  return set(feature, key.split(".")) as Feature;
}

/** Looks up a feature by id; lets the functions below follow a pattern to what it repeats. */
export type FeatureLookup = (id: string) => Feature | undefined;

const bodyOf = (ref: { type: string; bodyId?: string }): string[] =>
  ref.bodyId !== undefined && (ref.type === "edge" || ref.type === "face" || ref.type === "vertex")
    ? [ref.bodyId]
    : [];

const sketchOf = (ref: { type: string; sketchId?: string }): string[] =>
  ref.sketchId !== undefined && (ref.type === "sketch-line" || ref.type === "sketch-point")
    ? [ref.sketchId]
    : [];

/** The geometry references of a feature other than the bodies it works on. */
function featureReferences(
  feature: Feature,
): { type: string; bodyId?: string; sketchId?: string }[] {
  switch (feature.type) {
    case "rectangular-pattern":
      return feature.direction2 ? [feature.direction, feature.direction2] : [feature.direction];
    case "circular-pattern":
      return [feature.axis];
    case "mirror":
      return [feature.plane];
    case "move":
      return feature.transform.type === "rotate"
        ? [feature.transform.axis]
        : feature.transform.type === "point-to-point"
          ? [feature.transform.from, feature.transform.to]
          : [];
    case "align":
      return feature.mode === "face-to-face"
        ? [{ type: "face", bodyId: feature.to.bodyId }]
        : [feature.from, feature.to];
    case "split":
      return [feature.tool];
    case "loft":
      return feature.sections.filter((s) => s.type === "face");
    default:
      return [];
  }
}

/** Features whose recorded effect a feature applies again (the sources of a pattern). */
export function featureInputFeatures(feature: Feature): string[] {
  if (
    (feature.type === "rectangular-pattern" ||
      feature.type === "circular-pattern" ||
      feature.type === "mirror") &&
    feature.source.kind === "features"
  ) {
    return feature.source.featureIds.slice();
  }
  return [];
}

/**
 * Bodies changed by the features a pattern repeats. Needs `lookup`: the pattern itself only
 * stores feature ids. `seen` guards against features that (wrongly) refer to each other.
 */
function sourceFeatureBodies(
  feature: Feature,
  lookup: FeatureLookup | undefined,
  seen: Set<string>,
): string[] {
  if (!lookup) return [];
  const out: string[] = [];
  for (const id of featureInputFeatures(feature)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const source = lookup(id);
    if (source) out.push(...outputBodies(source, lookup, seen));
  }
  return out;
}

const unique = (ids: string[]): string[] => [...new Set(ids.filter((id) => id !== ""))];

/**
 * Bodies a feature reads: the ones it modifies in place and the ones it only takes a
 * direction, a plane or a point from. Pass `lookup` to include the bodies that a pattern of
 * features changes (they are the bodies changed by the features it repeats).
 */
export function featureInputBodies(feature: Feature, lookup?: FeatureLookup): string[] {
  const references = featureReferences(feature).flatMap(bodyOf);
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "sweep":
      return feature.operation === "new" ? [] : feature.targetBodyIds.slice();
    case "loft":
      return unique([
        ...(feature.operation === "new" ? [] : feature.targetBodyIds),
        ...references,
      ]);
    case "boolean":
      return [feature.targetBodyId, ...feature.toolBodyIds];
    case "fillet":
    case "chamfer":
    case "shell":
    case "hole":
      return [feature.bodyId];
    case "sketch": {
      const plane = feature.sketch.plane;
      const ids = feature.sketch.projections.map((p) => p.bodyId);
      if (plane.type === "face") ids.push(plane.bodyId);
      return [...new Set(ids)];
    }
    case "rectangular-pattern":
    case "circular-pattern":
    case "mirror":
      return unique([
        ...(feature.source.kind === "bodies"
          ? feature.source.bodyIds
          : sourceFeatureBodies(feature, lookup, new Set([feature.id]))),
        ...references,
      ]);
    case "move":
      return unique([...feature.bodyIds, ...references]);
    case "align":
    case "split":
      return unique([feature.bodyId, ...references]);
    case "import":
      return [];
  }
}

function outputBodies(feature: Feature, lookup: FeatureLookup | undefined, seen: Set<string>): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "sweep":
    case "loft":
      return feature.operation === "new" ? [feature.bodyId] : feature.targetBodyIds.slice();
    case "boolean":
      return [feature.targetBodyId];
    case "fillet":
    case "chamfer":
    case "shell":
    case "hole":
    case "align":
      return [feature.bodyId];
    case "import":
      return [feature.bodyId];
    case "sketch":
      return [];
    case "rectangular-pattern":
    case "circular-pattern":
      // The instances of a body pattern are not listed: see `featureOutputBodies`.
      return feature.source.kind === "bodies" ? [] : unique(sourceFeatureBodies(feature, lookup, seen));
    case "mirror":
      return feature.source.kind === "bodies"
        ? featureCreatedBodies(feature)
        : unique(sourceFeatureBodies(feature, lookup, seen));
    case "move":
      return feature.copy ? featureCreatedBodies(feature) : feature.bodyIds.slice();
    case "split":
      return [feature.bodyId, ...featureCreatedBodies(feature)];
  }
}

/**
 * Bodies that exist (or change) after the feature has run.
 *
 * Dynamic bodies (see `dynamicBodyId`) are listed where the definition of the feature alone
 * tells which ones there are: mirror, copy and split. The instances of a body pattern are not,
 * because their number is the value of an expression. Whoever needs the feature that made such
 * a body reads it from the id (`parseDynamicBodyId`), as the dependency graph does.
 */
export function featureOutputBodies(feature: Feature, lookup?: FeatureLookup): string[] {
  return outputBodies(feature, lookup, new Set([feature.id]));
}

/**
 * Bodies that a feature creates (as opposed to modifies), as far as the definition of the
 * feature tells. The instances of a body pattern are missing here for the reason given at
 * `featureOutputBodies`.
 */
export function featureCreatedBodies(feature: Feature): string[] {
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "sweep":
    case "loft":
      return feature.operation === "new" && feature.bodyId ? [feature.bodyId] : [];
    case "import":
      return [feature.bodyId];
    case "mirror":
      return feature.source.kind === "bodies"
        ? feature.source.bodyIds.map((b) => dynamicBodyId(feature.id, b, 1))
        : [];
    case "move":
      return feature.copy ? feature.bodyIds.map((b) => dynamicBodyId(feature.id, b, 1)) : [];
    case "split":
      return feature.keep === "both" ? [dynamicBodyId(feature.id, feature.bodyId, 1)] : [];
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
  const references = featureReferences(feature).flatMap(sketchOf);
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "hole":
      return [feature.sketchId];
    case "sweep":
      return unique([feature.sketchId, feature.path.sketchId]);
    case "loft":
      return unique(feature.sections.flatMap((s) => (s.type === "profile" ? [s.sketchId] : [])));
    default:
      return unique(references);
  }
}
