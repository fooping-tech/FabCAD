import {
  type CadBody,
  type EdgeConnection,
  type FabricationResult,
  type FabricationWarning,
  type FlatPart,
  type MaterialProfile,
  type SheetGeometry,
  type SheetLayout,
  type StrategySettings,
  StrategyRegistry,
  dedupeWarnings,
  fabricate,
  layoutParts,
  resolveSheetGeometry,
} from "@fabcad/fabrication-core";
import { registerLaserStrategies } from "@fabcad/fabrication-laser";
import { renderSheetDxf } from "@fabcad/dxf";
import { renderSheetSvg } from "@fabcad/svg";
import {
  type LaserFabricationSettings,
  FABRICATION_PROCESS,
  currentMaterial,
  resolveBoardSettings,
  resolvePaperSettings,
} from "./settingsModel";

/**
 * The fabrication pipeline of the workspace (pure: no React, no DOM):
 *
 *   CAD solid → analyzer / strategy → flat parts + connections → sheet layout → sheet geometry
 *
 * `FabricationOutput.geometry` is the single source for the on-screen preview and for export.
 */
export interface FabricationOutput {
  material: MaterialProfile;
  strategyId: string;
  results: FabricationResult[];
  parts: FlatPart[];
  connections: EdgeConnection[];
  warnings: FabricationWarning[];
  layout: SheetLayout;
  geometry: SheetGeometry;
}

let sharedRegistry: StrategyRegistry | null = null;

/** Strategies of all manufacturing workspaces. New processes register themselves here. */
export function fabricationRegistry(): StrategyRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new StrategyRegistry();
    registerLaserStrategies(sharedRegistry);
  }
  return sharedRegistry;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const errorWarning = (message: string): FabricationWarning => ({
  code: "unsupported",
  severity: "error",
  message,
});

/** Strategy settings for a material: the defaults of its category plus the user's overrides. */
export function strategySettingsFor(
  material: MaterialProfile,
  settings: Pick<LaserFabricationSettings, "board" | "paper">,
): StrategySettings {
  return material.category === "paper"
    ? resolvePaperSettings(material, settings.paper)
    : resolveBoardSettings(material, settings.board);
}

export interface CompileOptions {
  registry?: StrategyRegistry;
  process?: string;
}

function emptyLayout(settings: LaserFabricationSettings, parts: FlatPart[]): SheetLayout {
  return {
    sheet: settings.sheet,
    algorithm: settings.nesting,
    sheetCount: 1,
    placements: [],
    unplaced: parts.map((p) => p.id),
    warnings: [],
  };
}

/** Compile bodies into flat parts, lay them out and resolve the sheet geometry. Never throws. */
export function compileFabrication(
  bodies: CadBody[],
  settings: LaserFabricationSettings,
  options: CompileOptions = {},
): FabricationOutput {
  const process = options.process ?? FABRICATION_PROCESS;
  const material = currentMaterial(settings);
  const warnings: FabricationWarning[] = [];
  const results: FabricationResult[] = [];
  const parts: FlatPart[] = [];
  const connections: EdgeConnection[] = [];

  let strategy;
  try {
    strategy = (options.registry ?? fabricationRegistry()).forMaterial(material, process)[0];
  } catch (err) {
    warnings.push(errorWarning(`Strategy lookup failed: ${errorText(err)}`));
  }
  if (!strategy && warnings.length === 0) {
    warnings.push(
      errorWarning(`No ${process} strategy supports the material "${material.name}".`),
    );
  }

  if (strategy) {
    const strategySettings = strategySettingsFor(material, settings);
    const seenBodies = new Set<string>();
    const seenParts = new Set<string>();
    const multiple = bodies.length > 1;
    for (const body of bodies) {
      if (seenBodies.has(body.id)) continue;
      seenBodies.add(body.id);
      try {
        const result = fabricate(body, material, strategy, strategySettings);
        // Part ids are prefixed with the body id by the strategies; enforce uniqueness anyway.
        const clash = result.parts.find((p) => seenParts.has(p.id));
        if (clash) {
          warnings.push(
            errorWarning(`Body "${body.name}" produced the duplicate part id "${clash.id}".`),
          );
          continue;
        }
        const named = multiple
          ? result.parts.map((p) => ({ ...p, name: `${body.name} ${p.name}` }))
          : result.parts;
        for (const p of named) seenParts.add(p.id);
        results.push({ ...result, parts: named });
        parts.push(...named);
        connections.push(...result.connections);
        warnings.push(...result.warnings);
      } catch (err) {
        warnings.push(errorWarning(`Body "${body.name}" could not be compiled: ${errorText(err)}`));
      }
    }
  }

  let layout: SheetLayout;
  try {
    layout = layoutParts(parts, settings.sheet, settings.nesting, {
      allowRotation: settings.allowRotation,
    });
    warnings.push(...layout.warnings);
  } catch (err) {
    layout = emptyLayout(settings, parts);
    warnings.push(errorWarning(`Sheet layout failed: ${errorText(err)}`));
  }

  let geometry: SheetGeometry;
  try {
    geometry = resolveSheetGeometry(parts, layout, { labels: true });
  } catch (err) {
    geometry = { sheet: layout.sheet, sheetCount: layout.sheetCount, paths: [], labels: [] };
    warnings.push(errorWarning(`Sheet geometry failed: ${errorText(err)}`));
  }

  return {
    material,
    strategyId: strategy?.id ?? "",
    results,
    parts,
    connections,
    warnings: dedupeWarnings(warnings),
    layout,
    geometry,
  };
}

// ----------------------------------------------------------------------------------- stats

export interface FabricationStats {
  parts: number;
  connections: number;
  /** Sheets that carry at least one part. */
  sheets: number;
  unplaced: number;
  /** Total length of all cut paths on the sheets (mm). */
  cutLength: number;
  foldLength: number;
  errors: number;
  warnings: number;
}

function pathLength(points: readonly { x: number; y: number }[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1]!;
    const b = points[0]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Sheets that carry at least one placed part, in order. */
export function usedSheets(output: Pick<FabricationOutput, "layout">): number[] {
  const used = new Set<number>();
  for (const p of output.layout.placements) used.add(p.sheet);
  return [...used].sort((a, b) => a - b);
}

export function fabricationStats(output: FabricationOutput): FabricationStats {
  let cutLength = 0;
  let foldLength = 0;
  for (const path of output.geometry.paths) {
    if (path.type === "cut") cutLength += pathLength(path.points, path.closed);
    else if (path.type === "fold") foldLength += pathLength(path.points, path.closed);
  }
  return {
    parts: output.parts.length,
    connections: output.connections.length,
    sheets: usedSheets(output).length,
    unplaced: output.layout.unplaced.length,
    cutLength,
    foldLength,
    errors: output.warnings.filter((w) => w.severity === "error").length,
    warnings: output.warnings.filter((w) => w.severity === "warning").length,
  };
}

// ---------------------------------------------------------------------------------- export

export type ExportFormat = "svg" | "dxf";

export interface SheetFile {
  fileName: string;
  mime: string;
  data: string;
  sheet: number;
}

/**
 * Export files, one per used sheet, drawn from the same `SheetGeometry` as the preview.
 * `baseName` must already be safe for file names.
 */
export function buildSheetFiles(
  format: ExportFormat,
  output: Pick<FabricationOutput, "geometry" | "layout">,
  baseName: string,
  labels: boolean,
): SheetFile[] {
  const sheets = usedSheets(output);
  return sheets.map((sheet, i) => {
    const suffix = sheets.length > 1 ? `-sheet-${i + 1}` : "";
    return format === "svg"
      ? {
          fileName: `${baseName}${suffix}.svg`,
          mime: "image/svg+xml",
          data: renderSheetSvg(output.geometry, { sheet, labels }),
          sheet,
        }
      : {
          fileName: `${baseName}${suffix}.dxf`,
          mime: "application/dxf",
          data: renderSheetDxf(output.geometry, { sheet }),
          sheet,
        };
  });
}
