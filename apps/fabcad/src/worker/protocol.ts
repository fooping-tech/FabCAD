import type { CadDocument } from "@fabcad/cad-document";
import type { ExportItem, RecomputeResult } from "@fabcad/features";
import type { BodyGeometry, TessellationOptions } from "@fabcad/brep";
import type { SolidTopology } from "@fabcad/geometry";

/** Messages between the UI thread and the CAD worker that hosts the feature engine + kernel. */
export type WorkerRequest =
  | { type: "init" }
  | { type: "recompute"; document: CadDocument; known: Record<string, string> }
  | { type: "topology"; bodyId: string; options?: TessellationOptions }
  | { type: "mesh"; bodyId: string; options: TessellationOptions }
  | { type: "export-step"; bodies: ExportItem[] }
  | { type: "export-stl"; bodies: ExportItem[]; binary: boolean };

export interface WorkerResponses {
  init: { kernel: string };
  recompute: RecomputeResult;
  topology: SolidTopology | null;
  mesh: BodyGeometry | null;
  "export-step": Uint8Array;
  "export-stl": Uint8Array;
}

export interface RequestEnvelope {
  id: number;
  request: WorkerRequest;
}

export type ResponseEnvelope =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
