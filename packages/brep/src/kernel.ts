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

export type SurfaceKind = "plane" | "cylinder" | "cone" | "sphere" | "torus" | "other";

export interface MeshFaceGroup {
  faceIndex: number;
  /** Offset and length in `indices`. */
  start: number;
  count: number;
  surface: SurfaceKind;
  /** A point on the face and the outward normal there; used for persistent face references. */
  center: Vec3;
  normal: Vec3;
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
  /** B-Rep vertices: x,y,z, … */
  vertices: Float32Array;
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

export interface PointRef {
  point: Vec3;
  normal?: Vec3;
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelError";
  }
}

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

  tessellate(shape: KernelShape, options?: TessellationOptions): BodyGeometry;
  /** Polyhedral topology used by manufacturing workspaces. */
  topology(shape: KernelShape, options?: TessellationOptions): SolidTopology;

  importSTEP(data: Uint8Array): Promise<KernelShape[]>;
  exportSTEP(shapes: { shape: KernelShape; name: string }[]): Promise<Uint8Array>;
  exportSTL(shapes: KernelShape[], options?: TessellationOptions & { binary?: boolean }): Promise<Uint8Array>;

  /** True when the shape contains at least one solid with positive volume. */
  isValidSolid(shape: KernelShape): boolean;
  dispose(shape: KernelShape): void;
}
