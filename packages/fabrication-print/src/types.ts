import type { FabricationWarning } from "@fabcad/fabrication-core";
import type { Vec3 } from "@fabcad/geometry";

/**
 * 3D printing (FDM) as a manufacturing workspace. It prepares bodies for a slicer: orientation,
 * placement on the bed, checks and estimates, and mesh export. Slicing itself (G-code) is left
 * to the slicer.
 */

/** Triangle mesh in millimetres. Triangles are counter-clockwise seen from outside. */
export interface PrintMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** What the workspace receives from the CAD side: a tessellated body, nothing else. */
export interface PrintBody {
  id: string;
  name: string;
  mesh: PrintMesh;
}

export interface PrintMaterial {
  id: string;
  name: string;
  /** g / cm³ */
  density: number;
  /** Filament diameter in mm. */
  diameter: number;
}

export interface PrinterProfile {
  /** Build volume in mm. */
  bed: { width: number; depth: number; height: number };
  nozzle: number;
  layerHeight: number;
}

/**
 * Which direction of the body points down, towards the bed. "auto" picks the direction with
 * the least overhang (then the lowest height).
 */
export type Orientation = "auto" | "+x" | "-x" | "+y" | "-y" | "+z" | "-z" | { down: Vec3 };

export interface PrintSettings {
  material: PrintMaterial;
  printer: PrinterProfile;
  /** Infill density, 0 … 1. */
  infill: number;
  /** Number of perimeters. */
  walls: number;
  /** Number of solid top and bottom layers. */
  topBottomLayers: number;
  /**
   * Steepest printable overhang, in degrees from vertical. Faces that lean further than this
   * need support. 45 is the usual rule of thumb.
   */
  overhangAngle: number;
  /** Gap between parts on the bed, in mm. */
  gap: number;
  orientations: Record<string, Orientation>;
}

export interface PrintEstimate {
  /** Volume of the solid body, mm³. */
  volume: number;
  /** Volume of plastic actually extruded (walls, top / bottom, infill), mm³. */
  plastic: number;
  /** g */
  mass: number;
  /** Filament length in m. */
  filament: number;
  layers: number;
}

export interface PrintPart {
  bodyId: string;
  name: string;
  /** Oriented and placed on the bed: X right, Y back, Z up, bed at Z = 0, corner at origin. */
  mesh: PrintMesh;
  /** 1 for every triangle that needs support, 0 otherwise. */
  overhang: Uint8Array;
  /** Direction of the original body that points down. */
  down: Vec3;
  size: Vec3;
  /** Position of the part's bounding box corner on the bed. */
  position: { x: number; y: number };
  overhangArea: number;
  /** Area in contact with the bed, mm². */
  contactArea: number;
  estimate: PrintEstimate;
  placed: boolean;
}

export interface PrintJob {
  parts: PrintPart[];
  warnings: FabricationWarning[];
  total: PrintEstimate;
  printer: PrinterProfile;
  material: PrintMaterial;
}
