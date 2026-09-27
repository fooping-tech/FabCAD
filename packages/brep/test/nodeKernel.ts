import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { GeometryKernel } from "../src/kernel";
import { createReplicadKernel } from "../src/replicadAdapter";

let kernel: Promise<GeometryKernel> | null = null;

/** OpenCASCADE kernel for tests running in Node: the wasm is read from node_modules. */
export function nodeKernel(): Promise<GeometryKernel> {
  if (!kernel) {
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(require.resolve("replicad-opencascadejs/wasm"));
    kernel = createReplicadKernel({ wasmBinary: wasm });
  }
  return kernel;
}
