import { type AssemblyModel, createAssembly } from "@fabcad/assembly";
import type { Sketch } from "@fabcad/sketch";
import type { Feature, FeatureType, SketchFeature } from "./features";
import { FEATURE_LABELS, featureCreatedBodies } from "./features";
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

export function listBodies(doc: CadDocument, componentId?: string): BodyRecord[] {
  return Object.values(doc.bodies).filter(
    (b) => componentId === undefined || b.componentId === componentId,
  );
}

/** Drop body records whose creating feature no longer exists or no longer creates them. */
export function pruneBodies(doc: CadDocument): CadDocument {
  const alive = new Set<string>();
  for (const f of Object.values(doc.features)) {
    for (const id of featureCreatedBodies(f)) alive.add(id);
  }
  const bodies = Object.fromEntries(Object.entries(doc.bodies).filter(([id]) => alive.has(id)));
  return Object.keys(bodies).length === Object.keys(doc.bodies).length ? doc : { ...doc, bodies };
}
