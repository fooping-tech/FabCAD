import type { Plane3, Profile2, SolidTopology, Vec3 } from "@fabcad/geometry";

/**
 * Geometry Kernel Adapter boundary.
 *
 * Everything above this interface (feature engine, document model, UI, manufacturing) is
 * kernel-agnostic. Everything below it (OpenCASCADE / Replicad) is an implementation detail
 * confined to `replicadAdapter.ts`. Swapping the kernel means writing one new adapter.
 */

/** Opaque handle to a shape owned by the kernel. */
export interface KernelShape {
  readonly kernelShape: unique symbol;
}

export type BooleanOp = "union" | "cut" | "intersect";

/** "extrusion": a curve swept along a straight line (the side walls of an extruded spline). */
export type SurfaceKind =
  | "plane"
  | "cylinder"
  | "cone"
  | "sphere"
  | "torus"
  | "extrusion"
  | "other";

/**
 * Surfaces that are known to lie flat without stretching (developable). Others may or may not
 * be; for them only the facets can tell.
 */
export const isDevelopableSurface = (surface: SurfaceKind): boolean =>
  surface === "plane" || surface === "cylinder" || surface === "cone" || surface === "extrusion";

export interface MeshFaceGroup {
  faceIndex: number;
  /** Offset and length in `indices`. */
  start: number;
  count: number;
  surface: SurfaceKind;
  /** A point on the face and the outward normal there; used for persistent face references. */
  center: Vec3;
  normal: Vec3;
  /** mm² */
  area: number;
}

export interface MeshEdgeGroup {
  edgeIndex: number;
  /** Offset and length in `positions`, counted in vertices (two per line segment). */
  start: number;
  count: number;
  /** A point on the edge; used for persistent edge references. */
  midpoint: Vec3;
  curve: "line" | "circle" | "other";
  length: number;
  /** End points of the edge. */
  from: Vec3;
  to: Vec3;
  /** True for a full circle or another closed curve. */
  closed: boolean;
  /** For circles and circular arcs. */
  radius?: number;
  center?: Vec3;
  /** For circles: the unit normal of the circle's plane, from the B-Rep. */
  axis?: Vec3;
  /**
   * Control points of a Bézier edge (the spans of sketch splines and ellipses), trimmed to the
   * edge, in the direction of the curve. A projection of the edge onto a plane is the Bézier
   * of the projected control points: exact, unlike anything fitted to the tessellation.
   */
  bezier?: Vec3[];
  /**
   * Any other curve (B-splines, ellipses, …): a chain of cubic Béziers within 1e-6 mm of it,
   * 3·n + 1 points for n spans, in the direction of the curve. Projects like `bezier`.
   */
  cubics?: Vec3[];
}

/** Display geometry of one body. All arrays are transferable between threads. */
export interface BodyGeometry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: MeshFaceGroup[];
  /** Line segments of the B-Rep edges: x0,y0,z0, x1,y1,z1, … */
  edgePositions: Float32Array;
  edges: MeshEdgeGroup[];
  /** B-Rep vertices: x,y,z, … in double precision: they are exact, unlike the mesh. */
  vertices: Float64Array;
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
  area: number;
}

export interface TessellationOptions {
  /** Linear deflection in mm. */
  tolerance?: number;
  /** Angular deflection in radians. */
  angularTolerance?: number;
}

/**
 * Selects a face or an edge of a shape. `index` is the position in the tessellation of that
 * very shape (`BodyGeometry.faces` / `.edges`) and wins when present; `point` is the fallback.
 */
export interface PointRef {
  index?: number;
  point: Vec3;
  normal?: Vec3;
}

/**
 * One drilled hole. `position` is where the axis meets the surface, `direction` points into the
 * material. All sizes in mm; the hole is `depth` deep measured from `position`.
 */
export interface HoleSpec {
  position: Vec3;
  direction: Vec3;
  diameter: number;
  depth: number;
  /** A wider cylinder of the given depth at the top. */
  counterbore?: { diameter: number; depth: number };
  /** A cone from `diameter` at the surface down to the hole diameter; `angle`: included, degrees. */
  countersink?: { diameter: number; angle: number };
}

/**
 * A rigid motion or a reflection. Angles are degrees, counter-clockwise about `axis` seen
 * against its direction.
 */
export type ShapeTransform =
  | { type: "translate"; vector: Vec3 }
  | { type: "rotate"; origin: Vec3; axis: Vec3; angle: number }
  | { type: "mirror"; origin: Vec3; normal: Vec3 };

/** A piece of a path in space. Pieces of a path join end to end. */
export type PathCurve3 =
  | { type: "line"; from: Vec3; to: Vec3 }
  /** Circular arc through three points. Less than a full turn. */
  | { type: "arc"; from: Vec3; via: Vec3; to: Vec3 }
  /** Cubic Bézier curve. */
  | { type: "bezier"; points: [Vec3, Vec3, Vec3, Vec3] };

export interface SweepOptions {
  /**
   * Normal of the plane a planar path lies in. With it the profile only turns about this
   * direction while it follows the path, so it cannot flip over where the path changes from
   * bending one way to bending the other.
   */
  pathNormal?: Vec3;
}

/** A cross-section of a loft: a sketch profile, or the outer boundary of a face of a shape. */
export type LoftSectionInput =
  | { type: "profile"; profile: Profile2; plane: Plane3 }
  | { type: "face"; shape: KernelShape; faceIndex: number };

export interface LoftOptions {
  /** Straight lines between neighbouring sections instead of a smooth surface. */
  ruled?: boolean;
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelError";
  }
}

/**
 * What is wrong with a shape that should be a solid: nothing there, a gap (an edge of one face
 * only), a broken B-Rep, or parts that touch only along an edge (an edge of more than two
 * faces), which is no solid either.
 */
export type SolidProblem = "empty" | "open" | "invalid" | "non-manifold";

export interface GeometryKernel {
  readonly name: string;

  /**
   * Extrude planar profiles along the plane normal between the signed offsets `from` and `to`
   * (mm, measured from the plane).
   */
  extrude(profiles: Profile2[], plane: Plane3, from: number, to: number): KernelShape;

  /** Revolve planar profiles about an axis by `angle` degrees. */
  revolve(
    profiles: Profile2[],
    plane: Plane3,
    axisOrigin: Vec3,
    axisDirection: Vec3,
    angle: number,
  ): KernelShape;

  boolean(op: BooleanOp, target: KernelShape, tools: KernelShape[]): KernelShape;
  fillet(shape: KernelShape, edges: PointRef[], radius: number): KernelShape;
  chamfer(shape: KernelShape, edges: PointRef[], distance: number): KernelShape;
  /** Hollow the shape. `openFaces` are removed; with none the result is a closed hollow body. */
  shell(shape: KernelShape, openFaces: PointRef[], thickness: number): KernelShape;

  /**
   * The solid that drilling the holes removes, in one piece. The caller cuts it from the body:
   * that way it can name the faces of the holes, and a pattern can use the tool again.
   */
  hole(holes: HoleSpec[]): KernelShape;

  /** A copy of the shape with the steps applied in order. The shape itself is left alone. */
  transform(shape: KernelShape, steps: ShapeTransform[]): KernelShape;

  /**
   * Cut a shape in two along a plane. `positive` is the part on the side the normal points to.
   * A side on which nothing lies is null.
   */
  split(
    shape: KernelShape,
    plane: Plane3,
  ): { positive: KernelShape | null; negative: KernelShape | null };

  /**
   * Move planar profiles along a path. The profile stays where it is drawn; the path starts
   * at `path[0].from` and the profile keeps the angle to the path it has there.
   */
  sweep(profiles: Profile2[], plane: Plane3, path: PathCurve3[], options?: SweepOptions): KernelShape;

  /** A solid through the given cross-sections, in order. */
  loft(sections: LoftSectionInput[], options?: LoftOptions): KernelShape;

  tessellate(shape: KernelShape, options?: TessellationOptions): BodyGeometry;
  /** Polyhedral topology used by manufacturing workspaces. */
  topology(shape: KernelShape, options?: TessellationOptions): SolidTopology;

  importSTEP(data: Uint8Array): Promise<KernelShape[]>;
  exportSTEP(shapes: { shape: KernelShape; name: string }[]): Promise<Uint8Array>;
  exportSTL(shapes: KernelShape[], options?: TessellationOptions & { binary?: boolean }): Promise<Uint8Array>;

  /** True when `solidProblem` finds nothing wrong with the shape. */
  isValidSolid(shape: KernelShape): boolean;
  /**
   * What is wrong with a shape that should be a solid: nothing there or no volume (`empty`), a
   * shell with edges that do not join two faces (`open`), or a B-Rep that OpenCASCADE's checker
   * rejects (`invalid`). Null for a closed, valid solid.
   */
  solidProblem(shape: KernelShape): SolidProblem | null;
  dispose(shape: KernelShape): void;
}
