import type { MaterialProfile } from "./types";

/** Built-in material presets. Users can edit copies of these in the Fabrication workspace. */
export const DEFAULT_MATERIALS: MaterialProfile[] = [
  { id: "mdf-2.5", name: "MDF 2.5 mm", category: "board", thickness: 2.5, kerf: 0.15, fitOffset: 0.05 },
  { id: "mdf-4", name: "MDF 4 mm", category: "board", thickness: 4, kerf: 0.18, fitOffset: 0.05 },
  { id: "mdf-5.5", name: "MDF 5.5 mm", category: "board", thickness: 5.5, kerf: 0.2, fitOffset: 0.1 },
  { id: "acrylic-2", name: "Acrylic 2 mm", category: "board", thickness: 2, kerf: 0.12, fitOffset: 0.05 },
  { id: "acrylic-3", name: "Acrylic 3 mm", category: "board", thickness: 3, kerf: 0.15, fitOffset: 0.05 },
  { id: "acrylic-5", name: "Acrylic 5 mm", category: "board", thickness: 5, kerf: 0.2, fitOffset: 0.08 },
  { id: "cardboard-1.5", name: "Cardboard 1.5 mm", category: "board", thickness: 1.5, kerf: 0.1, fitOffset: 0 },
  { id: "paper-0.2", name: "Paper 0.2 mm", category: "paper", thickness: 0.2, kerf: 0, fitOffset: 0 },
  { id: "kraft-0.3", name: "Kraft paper 0.3 mm", category: "paper", thickness: 0.3, kerf: 0, fitOffset: 0 },
];

export function findMaterial(
  materials: readonly MaterialProfile[],
  id: string,
): MaterialProfile | undefined {
  return materials.find((m) => m.id === id);
}
