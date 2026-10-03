import { type AssemblyModel, createAssembly } from "@fabcad/assembly";
import type { Sketch } from "@fabcad/sketch";
import type { Feature, FeatureType, SketchFeature } from "./features";
import {
  FEATURE_LABELS,
  featureConsumedBodies,
  featureCreatedBodies,
  parseDynamicBodyId,
} from "./features";
import type { Parameter } from "./parameters";

export const DOCUMENT_SCHEMA = "fabcad.document";
export const DOCUMENT_VERSION = 1;

export type LengthDisplayUnit = "mm" | "cm" | "in";
export type AngleDisplayUnit = "deg" | "rad";

export interface DocumentUnits {
  /** Display units. Stored values are always millimetres and degrees. */
  length: LengthDisplayUnit;
  angle: AngleDisplayUnit;
}

/** Bookkeeping for a body. Its shape is produced by the feature engine from the timeline. */
export interface BodyRecord {
  id: string;
  name: string;
  componentId: string;
  visible: boolean;
  /** Feature that created the body. */
  createdBy: string;
  color?: string;
}

export interface CadDocument {
  schema: typeof DOCUMENT_SCHEMA;
  version: number;
  id: string;
  name: string;
  units: DocumentUnits;
  parameters: Parameter[];
  assembly: AssemblyModel;
  features: Record<string, Feature>;
  /** Feature ids in history order. */
  timeline: string[];
  /**
   * History marker: number of timeline entries that are evaluated. `null` means the whole
   * timeline (the marker sits at the end).
   */
  timelineCursor: number | null;
  bodies: Record<string, BodyRecord>;
  /** Visibility of the origin planes and axes in the browser tree. */
  origin: { visible: boolean; hidden: string[] };
  /**
   * Opaque per-workspace data (e.g. material settings of the Fabrication workspace). The CAD
   * core stores it and round-trips it through save / load but never interprets it.
   */
  extensions: Record<string, unknown>;
  /** Counter for unique ids within the document. */
  nextId: number;
}

export function createDocument(name = "Untitled"): CadDocument {
  return {
    schema: DOCUMENT_SCHEMA,
    version: DOCUMENT_VERSION,
    id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    units: { length: "mm", angle: "deg" },
    parameters: [],
    assembly: createAssembly(name),
    features: {},
    timeline: [],
    timelineCursor: null,
    bodies: {},
    origin: { visible: true, hidden: [] },
    extensions: {},
    nextId: 1,
  };
}

/** Allocate a document-unique id. Returns the id and the document with the counter advanced. */
export function allocateId(doc: CadDocument, prefix: string): [string, CadDocument] {
  return [`${prefix}-${doc.nextId}`, { ...doc, nextId: doc.nextId + 1 }];
}

/** Next free display name such as "Sketch003" or "Extrude001". */
export function nextFeatureName(doc: CadDocument, type: FeatureType): string {
  const label = FEATURE_LABELS[type];
  const used = new Set(Object.values(doc.features).map((f) => f.name));
  for (let i = 1; ; i++) {
    const name = `${label}${String(i).padStart(3, "0")}`;
    if (!used.has(name)) return name;
  }
}

export function nextBodyName(doc: CadDocument): string {
  const used = new Set(Object.values(doc.bodies).map((b) => b.name));
  for (let i = 1; ; i++) {
    const name = `Body${String(i).padStart(3, "0")}`;
    if (!used.has(name)) return name;
  }
}

/** Features in timeline order, limited to the part before the history marker. */
export function activeTimeline(doc: CadDocument): Feature[] {
  const limit = doc.timelineCursor ?? doc.timeline.length;
  const out: Feature[] = [];
  doc.timeline.slice(0, limit).forEach((id) => {
    const f = doc.features[id];
    if (f) out.push(f);
  });
  return out;
}

export function listFeatures(doc: CadDocument): Feature[] {
  const out: Feature[] = [];
  for (const id of doc.timeline) {
    const f = doc.features[id];
    if (f) out.push(f);
  }
  return out;
}

export function listSketchFeatures(doc: CadDocument, componentId?: string): SketchFeature[] {
  return listFeatures(doc).filter(
    (f): f is SketchFeature =>
      f.type === "sketch" && (componentId === undefined || f.componentId === componentId),
  );
}

export function getSketch(doc: CadDocument, featureId: string): Sketch | undefined {
  const f = doc.features[featureId];
  return f?.type === "sketch" ? f.sketch : undefined;
}

/**
 * Bodies that a step before the history marker used up (the tools of Combine), with the step
 * that did. Their records stay: moved before that step, the marker brings them back.
 */
export function consumedBodies(doc: CadDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of activeTimeline(doc)) {
    if (f.suppressed) continue;
    for (const id of featureConsumedBodies(f)) out.set(id, f.id);
  }
  return out;
}

/** The bodies there are at the history marker: not those that a step used up. */
export function listBodies(doc: CadDocument, componentId?: string): BodyRecord[] {
  const consumed = consumedBodies(doc);
  return Object.values(doc.bodies).filter(
    (b) => !consumed.has(b.id) && (componentId === undefined || b.componentId === componentId),
  );
}

/**
 * Drop body records whose creating feature no longer exists or no longer creates them.
 *
 * Records of dynamic bodies (see `dynamicBodyId`) are kept as long as the feature named in
 * their id exists: which of them are alive is only known after evaluation, and that is
 * `syncBodyRecords`' business.
 */
export function pruneBodies(doc: CadDocument): CadDocument {
  const alive = new Set<string>();
  for (const f of Object.values(doc.features)) {
    for (const id of featureCreatedBodies(f)) alive.add(id);
  }
  const bodies = Object.fromEntries(
    Object.entries(doc.bodies).filter(([id]) => {
      if (alive.has(id)) return true;
      const dynamic = parseDynamicBodyId(id);
      return dynamic !== null && doc.features[dynamic.featureId] !== undefined;
    }),
  );
  return Object.keys(bodies).length === Object.keys(doc.bodies).length ? doc : { ...doc, bodies };
}

/** What the feature engine reports about a body that has no record in the document yet. */
export interface DynamicBodyInfo {
  id: string;
  /** Feature that created the body. */
  createdBy: string;
  /** Body it was derived from (pattern instance, mirror image, copy, other half of a split). */
  sourceBodyId?: string;
  suggestedName: string;
  componentId: string;
}

/**
 * Bring the body records in line with the bodies that the last recompute produced.
 *
 * Bodies whose number depends on evaluated values (see `dynamicBodyId`) get their record here
 * rather than from the command that added the feature. `records` are the bodies the engine
 * found without a record, `liveBodyIds` all bodies that exist at the end of the active
 * timeline. Records of dynamic bodies that are not alive are removed, but only when the
 * feature that makes them is gone or did run: while it is suppressed or behind the history
 * marker the record stays, and with it the name and colour the user gave the body.
 *
 * The result is a function of the document, to be applied without a history entry:
 * `store.amend(syncBodyRecords(records, liveBodyIds))`. It returns the same document when
 * there is nothing to do.
 */
export function syncBodyRecords(
  records: readonly DynamicBodyInfo[],
  liveBodyIds: readonly string[],
): (doc: CadDocument) => CadDocument {
  return (doc) => {
    const live = new Set(liveBodyIds);
    const active = new Set(doc.timeline.slice(0, doc.timelineCursor ?? doc.timeline.length));
    let bodies = doc.bodies;
    const edit = (): Record<string, BodyRecord> => {
      if (bodies === doc.bodies) bodies = { ...doc.bodies };
      return bodies;
    };
    for (const id of Object.keys(doc.bodies)) {
      const dynamic = parseDynamicBodyId(id);
      if (!dynamic || live.has(id)) continue;
      const owner = doc.features[dynamic.featureId];
      const ran = owner !== undefined && active.has(owner.id) && !owner.suppressed;
      if (!owner || ran) delete edit()[id];
    }
    for (const r of records) {
      if (bodies[r.id] || !live.has(r.id) || !doc.features[r.createdBy]) continue;
      const used = new Set(Object.values(bodies).map((b) => b.name));
      let name = r.suggestedName;
      for (let i = 2; used.has(name); i++) name = `${r.suggestedName} ${i}`;
      edit()[r.id] = {
        id: r.id,
        name,
        componentId: r.componentId,
        visible: true,
        createdBy: r.createdBy,
      };
    }
    return bodies === doc.bodies ? doc : { ...doc, bodies };
  };
}

/**
 * The single component that all these bodies belong to, or null when they belong to more than
 * one (or there are none). Features may only combine bodies of one component.
 */
export function commonComponent(doc: CadDocument, bodyIds: readonly string[]): string | null {
  let found: string | null = null;
  for (const id of bodyIds) {
    const c = doc.bodies[id]?.componentId;
    if (c === undefined) continue;
    if (found !== null && c !== found) return null;
    found = c;
  }
  return found;
}

export const CROSS_COMPONENT_MESSAGE =
  "These bodies belong to different components. Combine and the other body operations work " +
  "on the bodies of one component only.";
