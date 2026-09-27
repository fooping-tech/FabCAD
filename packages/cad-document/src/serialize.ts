import { createAssembly } from "@fabcad/assembly";
import {
  type CadDocument,
  DOCUMENT_SCHEMA,
  DOCUMENT_VERSION,
  createDocument,
} from "./document";
import type { Feature } from "./features";

/** File wrapper for `.fabcad.json` project files. */
export interface ProjectFile {
  format: "fabcad";
  formatVersion: number;
  savedAt: string;
  app: string;
  document: CadDocument;
}

export const PROJECT_FILE_EXTENSION = ".fabcad.json";
export const PROJECT_FORMAT_VERSION = 1;

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export function serializeDocument(doc: CadDocument, pretty = true): string {
  const file: ProjectFile = {
    format: "fabcad",
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    app: "FabCAD",
    document: doc,
  };
  return JSON.stringify(file, null, pretty ? 2 : undefined);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Migrations by the `formatVersion` they upgrade FROM. */
const MIGRATIONS: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

export function deserializeDocument(json: string): CadDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectFormatError("The file is not valid JSON.");
  }
  if (!isRecord(raw) || raw.format !== "fabcad") {
    throw new ProjectFormatError("This is not a FabCAD project file.");
  }
  let version = typeof raw.formatVersion === "number" ? raw.formatVersion : 0;
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(
      `The file was saved by a newer version of FabCAD (format ${version}).`,
    );
  }
  let file = raw;
  while (version < PROJECT_FORMAT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new ProjectFormatError(`Cannot upgrade project format ${version}.`);
    file = migrate(file);
    version++;
  }
  return normalizeDocument(file.document);
}

/** Validate the shape of a document and fill in anything missing with defaults. */
export function normalizeDocument(input: unknown): CadDocument {
  if (!isRecord(input)) throw new ProjectFormatError("The project contains no document.");
  if (input.schema !== DOCUMENT_SCHEMA) {
    throw new ProjectFormatError("Unknown document schema.");
  }
  const base = createDocument(typeof input.name === "string" ? input.name : "Untitled");
  const features: Record<string, Feature> = {};
  if (isRecord(input.features)) {
    for (const [id, f] of Object.entries(input.features)) {
      if (!isRecord(f) || typeof f.type !== "string" || f.id !== id) {
        throw new ProjectFormatError(`Feature "${id}" is malformed.`);
      }
      if (f.type === "sketch") {
        const s = f.sketch;
        if (!isRecord(s) || !isRecord(s.entities) || !isRecord(s.constraints)) {
          throw new ProjectFormatError(`Sketch "${id}" is malformed.`);
        }
        if (!isRecord(s.dimensions)) s.dimensions = {};
        if (!Array.isArray(s.projections)) s.projections = [];
        if (typeof s.nextId !== "number") s.nextId = Object.keys(s.entities).length * 4 + 1000;
      }
      features[id] = f as unknown as Feature;
    }
  }
  const timeline = Array.isArray(input.timeline)
    ? input.timeline.filter((id): id is string => typeof id === "string" && !!features[id])
    : [];
  // Features missing from the timeline would never be evaluated; append them.
  for (const id of Object.keys(features)) if (!timeline.includes(id)) timeline.push(id);

  const assembly =
    isRecord(input.assembly) && isRecord(input.assembly.components)
      ? (input.assembly as unknown as CadDocument["assembly"])
      : createAssembly(base.name);

  const doc: CadDocument = {
    ...base,
    version: DOCUMENT_VERSION,
    id: typeof input.id === "string" ? input.id : base.id,
    units: isRecord(input.units)
      ? {
          length: (input.units.length as CadDocument["units"]["length"]) ?? "mm",
          angle: (input.units.angle as CadDocument["units"]["angle"]) ?? "deg",
        }
      : base.units,
    parameters: Array.isArray(input.parameters)
      ? (input.parameters.filter(
          (p) => isRecord(p) && typeof p.name === "string" && typeof p.expression === "string",
        ) as unknown as CadDocument["parameters"])
      : [],
    assembly,
    features,
    timeline,
    timelineCursor:
      typeof input.timelineCursor === "number"
        ? Math.max(0, Math.min(timeline.length, input.timelineCursor))
        : null,
    bodies: isRecord(input.bodies) ? (input.bodies as CadDocument["bodies"]) : {},
    origin:
      isRecord(input.origin) && Array.isArray(input.origin.hidden)
        ? {
            visible: input.origin.visible !== false,
            hidden: input.origin.hidden.filter((h): h is string => typeof h === "string"),
          }
        : base.origin,
    extensions: isRecord(input.extensions) ? input.extensions : {},
    nextId: typeof input.nextId === "number" ? input.nextId : 100000,
  };
  return doc;
}
