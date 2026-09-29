import type { CadDocument } from "@fabcad/cad-document";
import {
  type MaterialCategory,
  type MaterialProfile,
  type NestingAlgorithm,
  type SheetSpec,
  DEFAULT_MATERIALS,
  DEFAULT_SHEET,
} from "@fabcad/fabrication-core";
import {
  type BoardSettings,
  type PaperSettings,
  defaultBoardSettings,
  defaultPaperSettings,
} from "@fabcad/fabrication-laser";

/**
 * Settings of the laser fabrication workspace (pure model: no React, no DOM, no session).
 *
 * The CAD document stores this object as opaque extension data under
 * `FABRICATION_EXTENSION_KEY`. The CAD core never interprets it; this module is the only place
 * that reads, validates and normalises it.
 */

/** Manufacturing process of this workspace. More processes (cnc, print, …) get their own key. */
export const FABRICATION_PROCESS = "laser";
export type FabricationProcess = typeof FABRICATION_PROCESS;

export const FABRICATION_EXTENSION_KEY = "fabrication.laser";
export const DEFAULT_MATERIAL_ID = "mdf-5.5";

/** User overrides on top of `defaultBoardSettings(material)`. A missing key = default. */
export interface BoardOverrides {
  capJoint?: BoardSettings["capJoint"];
  sideJoint?: BoardSettings["sideJoint"];
  slotEdgeMargin?: number;
  tabWidth?: number;
  tabSpacing?: number;
  fingerWidth?: number;
  kerfCompensation?: boolean;
}

/** User overrides on top of `defaultPaperSettings(material)`. A missing key = default. */
export interface PaperOverrides {
  /** How cut edges are joined: glue tabs, or tabs pushed through slits. */
  joint?: PaperSettings["joint"];
  insertTabs?: Partial<PaperSettings["insertTabs"]>;
  glueTabs?: {
    enabled?: boolean;
    width?: number;
    angle?: number;
    inset?: number;
  };
  foldCurvedFacets?: boolean;
  kerfCompensation?: boolean;
}

export interface LaserFabricationSettings {
  version: 1;
  /** Selected material (a built-in preset or a custom material). */
  materialId: string;
  /**
   * User materials. An entry with the id of a built-in preset is an edited copy that replaces
   * the preset; every other entry is an additional material.
   */
  customMaterials: MaterialProfile[];
  /** Bodies to fabricate; `null` = all visible bodies. */
  bodyIds: string[] | null;
  board: BoardOverrides;
  paper: PaperOverrides;
  sheet: SheetSpec;
  nesting: NestingAlgorithm;
  allowRotation: boolean;
  /** Draw part names into exported files. */
  exportLabels: boolean;
}

export function defaultFabricationSettings(): LaserFabricationSettings {
  return {
    version: 1,
    materialId: DEFAULT_MATERIAL_ID,
    customMaterials: [],
    bodyIds: null,
    board: {},
    paper: {},
    sheet: { ...DEFAULT_SHEET },
    nesting: "row",
    allowRotation: false,
    exportLabels: false,
  };
}

// ------------------------------------------------------------------------------ validation

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const positive = (value: unknown): number | undefined => {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
};

const nonNegative = (value: unknown): number | undefined => {
  const n = finite(value);
  return n !== undefined && n >= 0 ? n : undefined;
};

const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Copy of `source` without keys whose value is `undefined`. */
function compact<T extends object>(source: T): T {
  const out: Dict = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined) out[key] = value;
  return out as T;
}

export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = ["board", "paper"];
export const CAP_JOINTS: readonly BoardSettings["capJoint"][] = ["tab-slot", "finger", "flat"];
export const SIDE_JOINTS: readonly BoardSettings["sideJoint"][] = ["flat", "finger"];
export const PAPER_JOINTS: readonly PaperSettings["joint"][] = ["glue", "insert"];
export const NESTING_ALGORITHMS: readonly NestingAlgorithm[] = ["row", "shelf"];
/** Largest glue tab taper in degrees (90° would be a tab without height). */
export const MAX_GLUE_TAB_ANGLE = 85;

/** Validate one material; returns `null` when it cannot be repaired. */
export function normalizeMaterial(value: unknown): MaterialProfile | null {
  if (!isDict(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const thickness = positive(value.thickness);
  const category = oneOf(value.category, MATERIAL_CATEGORIES);
  if (id.length === 0 || thickness === undefined || category === undefined) return null;
  const name = typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : id;
  return {
    id,
    name,
    category,
    thickness,
    kerf: nonNegative(value.kerf) ?? 0,
    fitOffset: finite(value.fitOffset) ?? 0,
  };
}

function normalizeMaterials(value: unknown): MaterialProfile[] {
  if (!Array.isArray(value)) return [];
  const out: MaterialProfile[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    const material = normalizeMaterial(item);
    if (!material || seen.has(material.id)) continue;
    seen.add(material.id);
    out.push(material);
  }
  return out;
}

export function normalizeBoardOverrides(value: unknown): BoardOverrides {
  if (!isDict(value)) return {};
  return compact<BoardOverrides>({
    capJoint: oneOf(value.capJoint, CAP_JOINTS),
    sideJoint: oneOf(value.sideJoint, SIDE_JOINTS),
    slotEdgeMargin: nonNegative(value.slotEdgeMargin),
    tabWidth: positive(value.tabWidth),
    tabSpacing: positive(value.tabSpacing),
    fingerWidth: positive(value.fingerWidth),
    kerfCompensation: bool(value.kerfCompensation),
  });
}

export function normalizePaperOverrides(value: unknown): PaperOverrides {
  if (!isDict(value)) return {};
  const out: PaperOverrides = compact<PaperOverrides>({
    joint: oneOf(value.joint, PAPER_JOINTS),
    foldCurvedFacets: bool(value.foldCurvedFacets),
    kerfCompensation: bool(value.kerfCompensation),
  });
  if (isDict(value.glueTabs)) {
    const angle = nonNegative(value.glueTabs.angle);
    const tabs = compact<NonNullable<PaperOverrides["glueTabs"]>>({
      enabled: bool(value.glueTabs.enabled),
      width: positive(value.glueTabs.width),
      angle: angle !== undefined && angle <= MAX_GLUE_TAB_ANGLE ? angle : undefined,
      inset: nonNegative(value.glueTabs.inset),
    });
    if (Object.keys(tabs).length > 0) out.glueTabs = tabs;
  }
  if (isDict(value.insertTabs)) {
    const insert = compact<NonNullable<PaperOverrides["insertTabs"]>>({
      width: positive(value.insertTabs.width),
      depth: positive(value.insertTabs.depth),
      spacing: positive(value.insertTabs.spacing),
      slitOffset: positive(value.insertTabs.slitOffset),
      clearance: nonNegative(value.insertTabs.clearance),
      lock: nonNegative(value.insertTabs.lock),
    });
    if (Object.keys(insert).length > 0) out.insertTabs = insert;
  }
  return out;
}

export function normalizeSheet(value: unknown): SheetSpec {
  const source = isDict(value) ? value : {};
  const width = positive(source.width) ?? DEFAULT_SHEET.width;
  const height = positive(source.height) ?? DEFAULT_SHEET.height;
  let margin = nonNegative(source.margin) ?? DEFAULT_SHEET.margin;
  // The margin must leave a usable area.
  if (margin * 2 >= Math.min(width, height)) margin = 0;
  return { width, height, margin, gap: nonNegative(source.gap) ?? DEFAULT_SHEET.gap };
}

/**
 * Turn unknown data (e.g. from a project file written by another version) into valid settings.
 * Every invalid or missing value is replaced by its default; nothing here throws.
 */
export function normalizeFabricationSettings(value: unknown): LaserFabricationSettings {
  const defaults = defaultFabricationSettings();
  if (!isDict(value)) return defaults;
  const customMaterials = normalizeMaterials(value.customMaterials);
  const known = new Set<string>([
    ...DEFAULT_MATERIALS.map((m) => m.id),
    ...customMaterials.map((m) => m.id),
  ]);
  const materialId =
    typeof value.materialId === "string" && known.has(value.materialId)
      ? value.materialId
      : defaults.materialId;
  let bodyIds: string[] | null = null;
  if (Array.isArray(value.bodyIds)) {
    const ids = (value.bodyIds as unknown[]).filter((id): id is string => typeof id === "string");
    bodyIds = [...new Set(ids)];
  }
  return {
    version: 1,
    materialId,
    customMaterials,
    bodyIds,
    board: normalizeBoardOverrides(value.board),
    paper: normalizePaperOverrides(value.paper),
    sheet: normalizeSheet(value.sheet),
    nesting: oneOf(value.nesting, NESTING_ALGORITHMS) ?? defaults.nesting,
    allowRotation: bool(value.allowRotation) ?? defaults.allowRotation,
    exportLabels: bool(value.exportLabels) ?? defaults.exportLabels,
  };
}

/** Settings of a document; defaults when the document has none (or invalid ones). */
export function readFabricationSettings(
  doc: Pick<CadDocument, "extensions">,
): LaserFabricationSettings {
  return normalizeFabricationSettings(doc.extensions?.[FABRICATION_EXTENSION_KEY]);
}

// ------------------------------------------------------------------------------- materials

export const isBuiltInMaterial = (id: string): boolean =>
  DEFAULT_MATERIALS.some((m) => m.id === id);

export const builtInMaterial = (id: string): MaterialProfile | undefined =>
  DEFAULT_MATERIALS.find((m) => m.id === id);

/** Built-in presets (replaced by their edited copies) followed by the user's own materials. */
export function allMaterials(
  settings: Pick<LaserFabricationSettings, "customMaterials">,
): MaterialProfile[] {
  const custom = new Map<string, MaterialProfile>();
  for (const m of settings.customMaterials) custom.set(m.id, m);
  const out: MaterialProfile[] = DEFAULT_MATERIALS.map((m) => custom.get(m.id) ?? m);
  for (const m of settings.customMaterials) if (!isBuiltInMaterial(m.id)) out.push(m);
  return out;
}

const FALLBACK_MATERIAL: MaterialProfile = {
  id: DEFAULT_MATERIAL_ID,
  name: "MDF 5.5 mm",
  category: "board",
  thickness: 5.5,
  kerf: 0.2,
  fitOffset: 0.1,
};

export function currentMaterial(
  settings: Pick<LaserFabricationSettings, "customMaterials" | "materialId">,
): MaterialProfile {
  const materials = allMaterials(settings);
  return (
    materials.find((m) => m.id === settings.materialId) ??
    materials.find((m) => m.id === DEFAULT_MATERIAL_ID) ??
    materials[0] ??
    FALLBACK_MATERIAL
  );
}

export type MaterialOrigin = "preset" | "edited" | "custom";

export function materialOrigin(
  settings: Pick<LaserFabricationSettings, "customMaterials">,
  id: string,
): MaterialOrigin {
  if (!isBuiltInMaterial(id)) return "custom";
  return settings.customMaterials.some((m) => m.id === id) ? "edited" : "preset";
}

/** Settings patch that stores `material` (as an edited copy or a custom material). */
export function withMaterial(
  settings: LaserFabricationSettings,
  material: MaterialProfile,
): Pick<LaserFabricationSettings, "customMaterials"> {
  const exists = settings.customMaterials.some((m) => m.id === material.id);
  return {
    customMaterials: exists
      ? settings.customMaterials.map((m) => (m.id === material.id ? material : m))
      : [...settings.customMaterials, material],
  };
}

/**
 * Settings patch that removes a custom material. For an edited preset this restores the
 * preset; for a user material the selection falls back to the default material.
 */
export function withoutMaterial(
  settings: LaserFabricationSettings,
  id: string,
): Pick<LaserFabricationSettings, "customMaterials" | "materialId"> {
  const customMaterials = settings.customMaterials.filter((m) => m.id !== id);
  const gone = !isBuiltInMaterial(id) && settings.materialId === id;
  return { customMaterials, materialId: gone ? DEFAULT_MATERIAL_ID : settings.materialId };
}

/** A new id for a user material, derived from its name. */
export function newMaterialId(settings: LaserFabricationSettings, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "material";
  const used = new Set(allMaterials(settings).map((m) => m.id));
  let n = 1;
  let id = `custom-${slug}`;
  while (used.has(id)) id = `custom-${slug}-${++n}`;
  return id;
}

// -------------------------------------------------------------------------------- strategy

export function resolveBoardSettings(
  material: MaterialProfile,
  overrides: BoardOverrides,
): BoardSettings {
  return { ...defaultBoardSettings(material), ...normalizeBoardOverrides(overrides) };
}

export function resolvePaperSettings(
  material: MaterialProfile,
  overrides: PaperOverrides,
): PaperSettings {
  const defaults = defaultPaperSettings(material);
  const { glueTabs, insertTabs, ...rest } = normalizePaperOverrides(overrides);
  return {
    ...defaults,
    ...rest,
    glueTabs: { ...defaults.glueTabs, ...(glueTabs ?? {}) },
    insertTabs: { ...defaults.insertTabs, ...(insertTabs ?? {}) },
  };
}

// ---------------------------------------------------------------------------------- bodies

export interface BodyChoice {
  id: string;
  name: string;
  visible: boolean;
  included: boolean;
}

/** Bodies of the document with their inclusion state (`bodyIds: null` = all visible). */
export function chooseBodies(
  doc: Pick<CadDocument, "bodies">,
  settings: Pick<LaserFabricationSettings, "bodyIds">,
): BodyChoice[] {
  const chosen = settings.bodyIds ? new Set(settings.bodyIds) : null;
  return Object.values(doc.bodies).map((b) => ({
    id: b.id,
    name: b.name,
    visible: b.visible,
    included: chosen ? chosen.has(b.id) : b.visible,
  }));
}

/** `bodyIds` after switching one body on or off; `null` when it equals "all visible". */
export function toggleBody(bodies: readonly BodyChoice[], id: string, included: boolean): string[] | null {
  const next = bodies.filter((b) => (b.id === id ? included : b.included)).map((b) => b.id);
  const visible = bodies.filter((b) => b.visible).map((b) => b.id);
  const same = next.length === visible.length && next.every((v, i) => v === visible[i]);
  return same ? null : next;
}
