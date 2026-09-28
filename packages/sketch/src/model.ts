import type {
  Bounds2,
  Curve2,
  OriginPlaneName,
  Plane3,
  TopologyRef,
  Vec2,
  Vec3,
} from "@fabcad/geometry";

/**
 * Sketch data model. A sketch is plain serialisable data: entities reference points by id,
 * constraints and dimensions reference entities by id. Nothing here knows about the UI, the
 * solver implementation or the geometry kernel.
 */

export type EntityId = string;

export interface PointEntity {
  id: EntityId;
  type: "point";
  x: number;
  y: number;
  construction?: boolean;
}

export interface LineEntity {
  id: EntityId;
  type: "line";
  p1: EntityId;
  p2: EntityId;
  construction?: boolean;
}

export interface CircleEntity {
  id: EntityId;
  type: "circle";
  center: EntityId;
  radius: number;
  construction?: boolean;
}

/** Circular arc running counter-clockwise from `start` to `end` around `center`. */
export interface ArcEntity {
  id: EntityId;
  type: "arc";
  center: EntityId;
  start: EntityId;
  end: EntityId;
  construction?: boolean;
}

/** Full ellipse. `majorPoint` is the end of the major axis, `minorRadius` the other half axis. */
export interface EllipseEntity {
  id: EntityId;
  type: "ellipse";
  center: EntityId;
  majorPoint: EntityId;
  minorRadius: number;
  construction?: boolean;
}

export interface SplineEntity {
  id: EntityId;
  type: "spline";
  /** `fit`: the curve passes through the points. `control`: the points form a control polygon. */
  kind: "fit" | "control";
  points: EntityId[];
  closed: boolean;
  construction?: boolean;
}

export type CurveEntity = LineEntity | CircleEntity | ArcEntity | EllipseEntity | SplineEntity;
export type SketchEntity = PointEntity | CurveEntity;
export type SketchEntityType = SketchEntity["type"];

export type TextHorizontalAlign = "left" | "center" | "right";
export type TextVerticalAlign = "top" | "middle" | "bottom" | "baseline";

/** Text that follows a sketch curve (line, arc, circle, ...). */
export interface SketchTextPath {
  entityId: EntityId;
  /** Distance of the baseline from the path (length expression). */
  offset: string;
  /** Shift along the path (length expression). */
  start: string;
  flip: boolean;
  align: TextHorizontalAlign;
}

/**
 * Glyph outlines derived from a text. They are a cache: `key` identifies the inputs they were
 * made from, and whoever has the fonts renews them when the key no longer matches. Keeping
 * them in the sketch means that everything downstream (profiles, Extrude, the CAD worker,
 * export) needs neither fonts nor a text layout engine, and that a project still shows and
 * builds its texts when a font is not available.
 */
export interface SketchTextOutline {
  key: string;
  /** Closed loops, in the orientation of the font. */
  loops: Curve2[][];
  /**
   * "local": relative to the origin point of the text, not rotated; the text follows its
   * origin without a new layout. "sketch": sketch coordinates (text on a path).
   */
  space: "local" | "sketch";
  /** Rotation about the origin in radians (space "local"). */
  rotation: number;
  /** Bounds of `loops` in their own space; null when the text has no outline. */
  bounds: Bounds2 | null;
  /** Characters the font has no glyph for. */
  missing: string[];
}

/**
 * Text in a sketch. What is stored is the text and how it is set, never curves: the text stays
 * editable, and its outlines are derived. `text` is a plain string today; the numeric fields
 * are parameter expressions, and `text` may later hold parameter references in the same way.
 *
 * A text is not a `SketchEntity`: the solver only knows its origin point, which can be
 * dimensioned, constrained and dragged like any other point.
 */
export interface SketchText {
  id: string;
  type: "text";
  text: string;
  fontId: string;
  /** Name of the font for messages when the font itself is not available. */
  fontName: string;
  /** Font size: height of the em square (length expression). */
  height: string;
  /** Extra space between characters (length expression). */
  letterSpacing: string;
  /** Line pitch as a factor of the height (expression without unit). */
  lineSpacing: string;
  /** Angle expression, counter-clockwise. */
  rotation: string;
  horizontalAlign: TextHorizontalAlign;
  verticalAlign: TextVerticalAlign;
  direction: "horizontal" | "vertical";
  /** Point entity the text is placed at. */
  origin: EntityId;
  path?: SketchTextPath;
  construction?: boolean;
  outline?: SketchTextOutline;
}

export type ConstraintType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "equal"
  | "concentric"
  | "collinear"
  | "midpoint"
  | "fix"
  | "symmetry";

/**
 * Reference conventions (`refs`):
 * - coincident:    [point, point] or [point, line | circle | arc]
 * - horizontal:    [line] or [point, point]
 * - vertical:      [line] or [point, point]
 * - parallel:      [line, line]
 * - perpendicular: [line, line]
 * - tangent:       [line, circle | arc] or [circle | arc, circle | arc]
 * - equal:         [line, line] (length) or [circle | arc, circle | arc] (radius)
 * - concentric:    [circle | arc, circle | arc]
 * - collinear:     [line, line]
 * - midpoint:      [point, line]
 * - fix:           [point] or any curve (all of its defining points and radii are held)
 * - symmetry:      [point, point, line] or [line, line, line]; the last ref is the mirror axis
 */
export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  refs: EntityId[];
}

export type DimensionType =
  | "distance"
  | "hdistance"
  | "vdistance"
  | "angle"
  | "radius"
  | "diameter";

/**
 * Reference conventions (`refs`):
 * - distance:  [line] (length), [point, point], [point, line] or [line, line] (parallel offset)
 * - hdistance: [point, point] or [line]
 * - vdistance: [point, point] or [line]
 * - angle:     [line, line], degrees, measured counter-clockwise from the first to the second
 * - radius / diameter: [circle | arc]
 */
export interface SketchDimension {
  id: string;
  type: DimensionType;
  refs: EntityId[];
  /** Parameter expression, e.g. "100", "width / 2", "materialThickness + clearance". */
  expression: string;
  /** Driving dimensions are solver constraints; driven dimensions only report a measurement. */
  driving: boolean;
  /** Where the label is drawn, in sketch coordinates. */
  labelPosition?: Vec2;
}

/**
 * Geometry projected from 3D bodies into the sketch (Project / Include / Intersect).
 * Projected entities are recomputed upstream of the solver and then treated as fixed.
 */
export interface ProjectedGeometryRef {
  id: string;
  mode: "project" | "include" | "intersect";
  bodyId: string;
  /** What was picked on the body. Defaults to "edge". */
  source?: "edge" | "vertex";
  /** Point on the source edge or face used to re-identify it after recompute. */
  hint: Vec3;
  /**
   * Index of the source edge or vertex in its body and the number of edges or vertices the
   * body had. While the count is unchanged the index identifies the source; otherwise the
   * hint does.
   */
  index?: number;
  count?: number;
  /** Persistent name of the source edge. Takes precedence over `index` and `hint`. */
  ref?: TopologyRef;
  entityIds: EntityId[];
}

export type SketchPlaneRef =
  | { type: "origin"; plane: OriginPlaneName }
  | { type: "custom"; plane: Plane3 }
  | {
      type: "face";
      bodyId: string;
      hint: Vec3;
      /** The plane of the face when the sketch was last evaluated. */
      plane: Plane3;
      /** Persistent name of the face: the sketch follows the face when the body changes. */
      ref?: TopologyRef;
    }
  | {
      /** A construction plane, by the id of the feature that defines it. */
      type: "plane";
      featureId: string;
      /** The plane when the sketch was last evaluated. */
      plane: Plane3;
    };

export interface Sketch {
  id: string;
  name: string;
  plane: SketchPlaneRef;
  entities: Record<EntityId, SketchEntity>;
  constraints: Record<string, SketchConstraint>;
  dimensions: Record<string, SketchDimension>;
  projections: ProjectedGeometryRef[];
  /** Texts by id. Absent in sketches without text. */
  texts?: Record<string, SketchText>;
  /** The fixed point at the sketch origin, if the sketch has one. */
  originId?: EntityId;
  /** Monotonic counter used to allocate entity / constraint / dimension ids. */
  nextId: number;
}

export type SolveStatus =
  | "under-constrained"
  | "fully-constrained"
  | "over-constrained";

export function createSketch(id: string, name: string, plane: SketchPlaneRef): Sketch {
  return {
    id,
    name,
    plane,
    entities: {},
    constraints: {},
    dimensions: {},
    projections: [],
    nextId: 1,
  };
}
