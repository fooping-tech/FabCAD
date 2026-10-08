import type {
  RequestEnvelope,
  ResponseEnvelope,
  WorkerRequest,
  WorkerResponses,
} from "./protocol";

/**
 * The worker itself failed (crashed, or was stopped): unlike an error the engine reports for a
 * request, it leaves the worker unusable until it is restarted.
 */
export class WorkerFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerFailure";
  }
}

/** Promise-based client for the CAD worker. */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./cadWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<ResponseEnvelope>) => {
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    };
    this.worker.onerror = (event) => {
      const error = new WorkerFailure(event.message || "The CAD worker crashed.");
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
  }

  request<T extends WorkerRequest>(request: T): Promise<WorkerResponses[T["type"]]> {
    const id = this.nextId++;
    const envelope: RequestEnvelope = { id, request };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage(envelope);
    });
  }

  dispose(): void {
    this.worker.terminate();
    const error = new WorkerFailure("CAD worker stopped.");
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
