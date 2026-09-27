import type { CadDocument } from "@fabcad/cad-document";
import type { RecomputeResult } from "@fabcad/features";
import type { SolidTopology } from "@fabcad/geometry";

/** Messages between the UI thread and the CAD worker that hosts the feature engine + kernel. */
export type WorkerRequest =
  | { type: "init" }
  | { type: "recompute"; document: CadDocument; known: Record<string, string> }
  | { type: "topology"; bodyId: string }
  | { type: "export-step"; bodies: { id: string; name: string }[] }
  | { type: "export-stl"; bodyIds: string[]; binary: boolean };

export interface WorkerResponses {
  init: { kernel: string };
  recompute: RecomputeResult;
  topology: SolidTopology | null;
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
