import type { CadDocument } from "@fabcad/cad-document";
import {
  DEFAULT_PRINTER,
  type Orientation,
  PRINT_MATERIALS,
  type PrintMaterial,
  type PrintSettings,
  type PrinterProfile,
} from "@fabcad/fabrication-print";

/**
 * Settings of the 3D printing workspace. They live in the document as opaque extension data,
 * like the laser settings: saved with the project and undoable, unknown to the CAD core.
 */
export const PRINT_EXTENSION_KEY = "fabrication.print";

export interface PrintWorkspaceSettings {
  version: 1;
  materialId: string;
  printer: PrinterProfile;
  /** Percent, 0 … 100. */
  infill: number;
  walls: number;
  topBottomLayers: number;
  overhangAngle: number;
  gap: number;
  /** null = all visible bodies. */
  bodyIds: string[] | null;
  orientations: Record<string, Orientation>;
  /**
   * How many copies of a component's bodies are printed, by component id: one per visible
   * instance ("instances", the default) or one ("once").
   */
  copies: Record<string, "instances" | "once">;
}

export function defaultPrintWorkspaceSettings(): PrintWorkspaceSettings {
  return {
    version: 1,
    materialId: "pla",
    printer: DEFAULT_PRINTER,
    infill: 15,
    walls: 2,
    topBottomLayers: 4,
    overhangAngle: 45,
    gap: 5,
    bodyIds: null,
    orientations: {},
    copies: {},
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const number = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

const AXES = ["auto", "+x", "-x", "+y", "-y", "+z", "-z"];

function orientation(v: unknown): Orientation | null {
  if (typeof v === "string") return AXES.includes(v) ? (v as Orientation) : null;
  if (isRecord(v) && isRecord(v.down)) {
    const { x, y, z } = v.down;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
      if (Number.isFinite(x + y + z) && Math.hypot(x, y, z) > 1e-9) return { down: { x, y, z } };
    }
  }
  return null;
}

/** Validate stored settings and fill in defaults for anything missing or out of range. */
export function normalizePrintSettings(input: unknown): PrintWorkspaceSettings {
  const base = defaultPrintWorkspaceSettings();
  if (!isRecord(input)) return base;
  const printer = isRecord(input.printer) ? input.printer : {};
  const bed = isRecord(printer.bed) ? printer.bed : {};
  const orientations: Record<string, Orientation> = {};
  if (isRecord(input.orientations)) {
    for (const [id, v] of Object.entries(input.orientations)) {
      const o = orientation(v);
      if (o) orientations[id] = o;
    }
  }
  return {
    version: 1,
    materialId:
      typeof input.materialId === "string" && PRINT_MATERIALS.some((m) => m.id === input.materialId)
        ? input.materialId
        : base.materialId,
    printer: {
      bed: {
        width: number(bed.width, base.printer.bed.width, 10, 2000),
        depth: number(bed.depth, base.printer.bed.depth, 10, 2000),
        height: number(bed.height, base.printer.bed.height, 10, 2000),
      },
      nozzle: number(printer.nozzle, base.printer.nozzle, 0.1, 2),
      layerHeight: number(printer.layerHeight, base.printer.layerHeight, 0.02, 1.5),
    },
    infill: number(input.infill, base.infill, 0, 100),
    walls: Math.round(number(input.walls, base.walls, 1, 20)),
    topBottomLayers: Math.round(number(input.topBottomLayers, base.topBottomLayers, 0, 50)),
    overhangAngle: number(input.overhangAngle, base.overhangAngle, 0, 89),
    gap: number(input.gap, base.gap, 0, 100),
    bodyIds: Array.isArray(input.bodyIds)
      ? input.bodyIds.filter((id): id is string => typeof id === "string")
      : null,
    orientations,
    copies: isRecord(input.copies)
      ? Object.fromEntries(
          Object.entries(input.copies).filter(
            (e): e is [string, "instances" | "once"] => e[1] === "instances" || e[1] === "once",
          ),
        )
      : {},
  };
}

export function readPrintSettings(doc: CadDocument): PrintWorkspaceSettings {
  return normalizePrintSettings(doc.extensions[PRINT_EXTENSION_KEY]);
}

export function printMaterial(settings: PrintWorkspaceSettings): PrintMaterial {
  return PRINT_MATERIALS.find((m) => m.id === settings.materialId) ?? PRINT_MATERIALS[0]!;
}

/** Settings in the form the print compiler takes. */
export function toPrintSettings(settings: PrintWorkspaceSettings): PrintSettings {
  return {
    material: printMaterial(settings),
    printer: settings.printer,
    infill: settings.infill / 100,
    walls: settings.walls,
    topBottomLayers: settings.topBottomLayers,
    overhangAngle: settings.overhangAngle,
    gap: settings.gap,
    orientations: settings.orientations,
  };
}
