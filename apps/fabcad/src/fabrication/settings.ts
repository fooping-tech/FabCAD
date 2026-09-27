import { setExtension } from "@fabcad/cad-document";
import { documentStore, run } from "../app/session";
import {
  type LaserFabricationSettings,
  FABRICATION_EXTENSION_KEY,
  normalizeFabricationSettings,
  readFabricationSettings,
} from "./settingsModel";

export * from "./settingsModel";

export type FabricationSettingsPatch =
  | Partial<LaserFabricationSettings>
  | ((settings: LaserFabricationSettings) => Partial<LaserFabricationSettings>);

/**
 * Change the fabrication settings of the current document. The change is one undoable command
 * and is saved with the project. Returns false when nothing changed.
 */
export function updateFabricationSettings(
  patch: FabricationSettingsPatch,
  label = "Change fabrication settings",
): boolean {
  const current = readFabricationSettings(documentStore.document);
  const delta = typeof patch === "function" ? patch(current) : patch;
  const next = normalizeFabricationSettings({ ...current, ...delta, version: 1 });
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  return run(setExtension(FABRICATION_EXTENSION_KEY, next, label));
}
