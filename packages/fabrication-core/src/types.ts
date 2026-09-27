import type { Bounds2, SolidTopology, Vec2, Vec3 } from "@fabcad/geometry";

/**
 * Manufacturing model shared by every manufacturing workspace (laser today; CNC, 3D printing,
 * sheet metal later). The CAD core never imports this package.
 */

/** The only view of a CAD body that manufacturing code receives. */
export interface CadBody {
  id: string;
  name: string;
  topology: SolidTopology;
}

export type MaterialCategory = "board" | "paper";

export interface MaterialProfile {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Sheet thickness in mm. */
  thickness: number;
  /** Width of material removed by the cut, in mm. */
  kerf: number;
  /** Extra clearance added to mating features such as slots (mm). Negative = press fit. */
  fitOffset: number;
}

export type FabricationLineType = "cut" | "fold" | "engrave";

export type JointType = "tab-slot" | "flat" | "finger" | "fold" | "glue-tab" | "none";

/** What a path is for. Part geometry and joint geometry are never mixed in one path. */
export type FlatPathRole =
  | "outline"
  | "hole"
  | "slot"
  | "fold"
  | "glue-tab"
  | "label";

export interface FlatPath {
  type: FabricationLineType;
  role: FlatPathRole;
  points: Vec2[];
  closed: boolean;
  /** Connection that produced this path, for joint geometry. */
  connectionId?: string;
}

/** Joint geometry attached to one edge of one part. Kept separate from the part outline. */
export type JointFeature =
  | {
      kind: "tab";
      connectionId: string;
      edgeId: string;
      /** Closed polygons added to the part along the edge. */
      polygons: Vec2[][];
    }
  | {
      kind: "slot";
      connectionId: string;
      /** Closed polygons removed from the part. */
      polygons: Vec2[][];
    }
  | {
      kind: "finger";
      connectionId: string;
      edgeId: string;
      /** Polygons added (`add`) or removed (`remove`) along the edge. */
      add: Vec2[][];
      remove: Vec2[][];
    }
  | {
      kind: "glue-tab";
      connectionId: string;
      edgeId: string;
      polygons: Vec2[][];
    };

export interface PartEdge {
  /** `${partId}.edge-${index}`, or a semantic alias such as `side-0.top`. */
  id: string;
  index: number;
  /** Which loop of the part the edge belongs to: 0 = outline, 1.. = holes. */
  loop: number;
  a: Vec2;
  b: Vec2;
  length: number;
  /** Connection this edge takes part in, if any. */
  connectionId?: string;
  /** Edge of the source solid. */
  sourceEdge?: number;
}

export interface FlatPart {
  id: string;
  name: string;
  materialId: string;
  thickness: number;
  /** Faces of the source solid that this part represents. */
  sourceFaces: number[];
  /** Part geometry before joints, counter-clockwise, in the part's own 2D frame (mm). */
  outline: Vec2[];
  holes: Vec2[][];
  edges: PartEdge[];
  /** Joint geometry, separate from `outline` / `holes`. */
  joints: JointFeature[];
  /** Fold lines (paper). */
  folds: { a: Vec2; b: Vec2; connectionId: string; angle: number }[];
  /**
   * Final manufacturing paths: outline with joints applied, then kerf compensation.
   * Preview and export both draw exactly these paths.
   */
  paths: FlatPath[];
  bounds: Bounds2;
  /** Placement of the part frame in model space: 2D origin and axes of the outer face. */
  frame?: { origin: Vec3; xDir: Vec3; yDir: Vec3; normal: Vec3 };
}

export interface ConnectionEnd {
  partId: string;
  edgeId: string;
  /** Role of this side in the joint, e.g. "tab", "slot", "through", "butt", "fold", "glue". */
  role: string;
}

/**
 * Explicit record that two part edges meet. Connections are derived from the topology of the
 * solid, never guessed from positions in the 2D layout.
 */
export interface EdgeConnection {
  id: string;
  a: ConnectionEnd;
  b: ConnectionEnd;
  joint: JointType;
  /** Interior dihedral angle between the two parts in degrees (90 for a box corner). */
  angle: number;
  length: number;
  sourceEdge?: number;
}

export type WarningSeverity = "info" | "warning" | "error";

export type WarningCode =
  | "concave-corner"
  | "acute-angle"
  | "short-edge"
  | "narrow-tab"
  | "edge-collapsed"
  | "curved-face"
  | "non-manifold"
  | "joint-fallback"
  | "overlap"
  | "part-too-large"
  | "unsupported";

export interface FabricationWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  partId?: string;
  edgeId?: string;
  connectionId?: string;
  /** Location in model space, for highlighting in the 3D view. */
  position?: Vec3;
}

export interface FabricationResult {
  bodyId: string;
  material: MaterialProfile;
  strategyId: string;
  parts: FlatPart[];
  connections: EdgeConnection[];
  warnings: FabricationWarning[];
}

/** Settings bag interpreted by the strategy. Each strategy documents its own keys. */
export type StrategySettings = Record<string, unknown>;

export interface FabricationStrategy<S extends StrategySettings = StrategySettings> {
  id: string;
  name: string;
  /** Manufacturing process this strategy belongs to, e.g. "laser". */
  process: string;
  supports(material: MaterialProfile): boolean;
  defaultSettings(material: MaterialProfile): S;
  fabricate(body: CadBody, material: MaterialProfile, settings: S): FabricationResult;
}

/** Result of analysing a body before or while compiling it (the Fabrication Analyzer). */
export interface FabricationAnalysis {
  planarFaces: number;
  curvedFaces: number;
  closed: boolean;
  warnings: FabricationWarning[];
}

export interface SheetSpec {
  width: number;
  height: number;
  /** Clear border around the sheet edge (mm). */
  margin: number;
  /** Minimum gap between parts (mm). */
  gap: number;
}

export type NestingAlgorithm = "row" | "shelf";

export interface PartPlacement {
  partId: string;
  sheet: number;
  /** Translation applied after rotation, in sheet coordinates (mm, origin top-left, Y down). */
  x: number;
  y: number;
  /** Rotation in degrees, counter-clockwise, about the part frame origin. */
  rotation: number;
}

export interface SheetLayout {
  sheet: SheetSpec;
  algorithm: NestingAlgorithm;
  sheetCount: number;
  placements: PartPlacement[];
  /** Parts that do not fit on a sheet at all. */
  unplaced: string[];
  warnings: FabricationWarning[];
}

/** A path positioned on a sheet. This is the single source for both preview and export. */
export interface PlacedPath extends FlatPath {
  partId: string;
  sheet: number;
}

export interface PlacedLabel {
  partId: string;
  sheet: number;
  text: string;
  position: Vec2;
}

export interface SheetGeometry {
  sheet: SheetSpec;
  sheetCount: number;
  paths: PlacedPath[];
  labels: PlacedLabel[];
}
