/// <reference lib="webworker" />
import { createReplicadKernel } from "@fabcad/brep/replicad";
import { FeatureEngine } from "@fabcad/features";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import type { RequestEnvelope, ResponseEnvelope, WorkerRequest } from "./protocol";

/**
 * CAD worker: the feature engine and the geometry kernel live here, off the UI thread.
 * The UI only ever sends documents in and receives meshes / topology / files back.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

let enginePromise: Promise<FeatureEngine> | null = null;
let kernelName = "";

function engine(): Promise<FeatureEngine> {
  if (!enginePromise) {
    enginePromise = createReplicadKernel({ wasmUrl }).then((kernel) => {
      kernelName = kernel.name;
      return new FeatureEngine(kernel, createDefaultSolver());
    });
  }
  return enginePromise;
}

async function handle(request: WorkerRequest): Promise<{ result: unknown; transfer: Transferable[] }> {
  const e = await engine();
  switch (request.type) {
    case "init":
      return { result: { kernel: kernelName }, transfer: [] };
    case "recompute": {
      const result = await e.recompute(request.document, { known: request.known });
      // Geometry is cached inside the engine, so send copies and transfer their buffers.
      const transfer: Transferable[] = [];
      const bodies = result.bodies.map((b) => {
        if (!b.geometry) return b;
        const g = b.geometry;
        const copy = {
          ...g,
          positions: g.positions.slice(),
          normals: g.normals.slice(),
          indices: g.indices.slice(),
          edgePositions: g.edgePositions.slice(),
          vertices: g.vertices.slice(),
        };
        transfer.push(
          copy.positions.buffer,
          copy.normals.buffer,
          copy.indices.buffer,
          copy.edgePositions.buffer,
          copy.vertices.buffer,
        );
        return { ...b, geometry: copy };
      });
      return { result: { ...result, bodies }, transfer };
    }
    case "topology":
      return { result: e.bodyTopology(request.bodyId), transfer: [] };
    case "export-step": {
      const data = await e.exportSTEP(request.bodies);
      return { result: data, transfer: [data.buffer] };
    }
    case "export-stl": {
      const data = await e.exportSTL(request.bodyIds, request.binary);
      return { result: data, transfer: [data.buffer] };
    }
  }
}

// Requests are processed strictly in order: the engine is stateful.
let queue: Promise<void> = Promise.resolve();

ctx.onmessage = (event: MessageEvent<RequestEnvelope>) => {
  const { id, request } = event.data;
  queue = queue.then(async () => {
    try {
      const { result, transfer } = await handle(request);
      const response: ResponseEnvelope = { id, ok: true, result };
      ctx.postMessage(response, transfer);
    } catch (err) {
      const response: ResponseEnvelope = {
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(response);
    }
  });
};
