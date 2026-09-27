/** Public API of the FABRICATION (laser) workspace. */
export { FabricationSidePanel } from "./FabricationSidePanel";
export { FabricationMain, FabricationTabs } from "./FabricationMain";
export {
  type FabricationState,
  type FabricationStatus,
  useFabrication,
  useFabricationSettings,
} from "./useFabrication";
export { exportSheets } from "./export";
export {
  type CompileOptions,
  type ExportFormat,
  type FabricationOutput,
  type FabricationStats,
  type SheetFile,
  buildSheetFiles,
  compileFabrication,
  fabricationRegistry,
  fabricationStats,
  strategySettingsFor,
  usedSheets,
} from "./pipeline";
export {
  type BoardOverrides,
  type BodyChoice,
  type FabricationProcess,
  type FabricationSettingsPatch,
  type LaserFabricationSettings,
  type MaterialOrigin,
  type PaperOverrides,
  DEFAULT_MATERIAL_ID,
  FABRICATION_EXTENSION_KEY,
  FABRICATION_PROCESS,
  allMaterials,
  currentMaterial,
  defaultFabricationSettings,
  normalizeFabricationSettings,
  readFabricationSettings,
  updateFabricationSettings,
} from "./settings";
export { type FabricationUiState, fabricationUiState, revealPart, selectPart } from "./uiState";
