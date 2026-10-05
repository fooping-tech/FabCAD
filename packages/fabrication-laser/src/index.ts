import type {
  FabricationStrategy,
  MaterialProfile,
  StrategyRegistry,
} from "@fabcad/fabrication-core";
import { laserBoardStrategy } from "./board";
import { laserPaperStrategy } from "./paper";

export {
  type BoardSettings,
  defaultBoardSettings,
  edgeCompensation,
  laserBoardStrategy,
  unsupportedBoardMessage,
} from "./board";
export {
  type BoardBodyKind,
  type BoardClassification,
  type BoardClassifierOptions,
  type BoardUnsupportedCode,
  type FlatPartInfo,
  type RectangularBoxInfo,
  BOARD_KIND_LABELS,
  BOARD_SUPPORT_TEXT,
  classifyBoardBody,
} from "./boardClassifier";
export { BOARD_TESSELLATION } from "./boardSettings";
export { compileFlatPart } from "./flatPart";
export { compileRectangularBox } from "./rectangularBox";
export {
  type InsertTabSettings,
  type PaperJoint,
  type PaperSettings,
  defaultPaperSettings,
  goreTessellation,
  laserPaperStrategy,
} from "./paper";

export {
  type DoublyCurvedFace,
  type PaperClassifierOptions,
  type GorePlan,
  doublyCurvedFaces,
  planGores,
} from "./paperClassifier";

/** Add the laser strategies to a registry (the laser workspace calls this once). */
export function registerLaserStrategies(registry: StrategyRegistry): void {
  registry.register(laserBoardStrategy);
  registry.register(laserPaperStrategy);
}

/** The laser strategy normally used for a material, chosen by material category. */
export function defaultStrategyFor(material: MaterialProfile): FabricationStrategy | undefined {
  const all = [laserBoardStrategy, laserPaperStrategy] as unknown as FabricationStrategy[];
  return all.find((s) => s.supports(material));
}
