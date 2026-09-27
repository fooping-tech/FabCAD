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
} from "./board";
export { type PaperSettings, defaultPaperSettings, laserPaperStrategy } from "./paper";

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
