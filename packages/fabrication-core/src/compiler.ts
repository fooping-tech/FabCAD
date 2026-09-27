import type {
  CadBody,
  FabricationResult,
  FabricationStrategy,
  MaterialProfile,
  StrategySettings,
} from "./types";

/**
 * The Fabrication Compiler boundary. CAD data crosses into manufacturing only through this
 * call: a body, a material and a strategy go in, flat parts and explicit connections come out.
 */
export function fabricate<S extends StrategySettings>(
  body: CadBody,
  material: MaterialProfile,
  strategy: FabricationStrategy<S>,
  settings?: Partial<S>,
): FabricationResult {
  if (!strategy.supports(material)) {
    return {
      bodyId: body.id,
      material,
      strategyId: strategy.id,
      parts: [],
      connections: [],
      warnings: [
        {
          code: "unsupported",
          severity: "error",
          message: `Strategy "${strategy.name}" does not support material "${material.name}".`,
        },
      ],
    };
  }
  const merged = { ...strategy.defaultSettings(material), ...(settings ?? {}) } as S;
  return strategy.fabricate(body, material, merged);
}

/** Registry of strategies contributed by manufacturing workspaces. */
export class StrategyRegistry {
  private strategies = new Map<string, FabricationStrategy<never>>();

  register<S extends StrategySettings>(strategy: FabricationStrategy<S>): void {
    this.strategies.set(strategy.id, strategy as unknown as FabricationStrategy<never>);
  }

  get(id: string): FabricationStrategy | undefined {
    return this.strategies.get(id) as unknown as FabricationStrategy | undefined;
  }

  list(process?: string): FabricationStrategy[] {
    const all = [...this.strategies.values()] as unknown as FabricationStrategy[];
    return process ? all.filter((s) => s.process === process) : all;
  }

  /** Strategies able to process the given material, in registration order. */
  forMaterial(material: MaterialProfile, process?: string): FabricationStrategy[] {
    return this.list(process).filter((s) => s.supports(material));
  }
}
