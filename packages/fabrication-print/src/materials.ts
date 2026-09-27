import type { PrintMaterial, PrintSettings, PrinterProfile } from "./types";

export const PRINT_MATERIALS: PrintMaterial[] = [
  { id: "pla", name: "PLA", density: 1.24, diameter: 1.75 },
  { id: "petg", name: "PETG", density: 1.27, diameter: 1.75 },
  { id: "abs", name: "ABS", density: 1.04, diameter: 1.75 },
  { id: "asa", name: "ASA", density: 1.07, diameter: 1.75 },
  { id: "tpu", name: "TPU", density: 1.21, diameter: 1.75 },
];

export const DEFAULT_PRINTER: PrinterProfile = {
  bed: { width: 220, depth: 220, height: 250 },
  nozzle: 0.4,
  layerHeight: 0.2,
};

export function defaultPrintSettings(): PrintSettings {
  return {
    material: PRINT_MATERIALS[0]!,
    printer: DEFAULT_PRINTER,
    infill: 0.15,
    walls: 2,
    topBottomLayers: 4,
    overhangAngle: 45,
    gap: 5,
    orientations: {},
  };
}
