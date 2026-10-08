/**
 * Writes the benchmark projects (20, 80 and 200 steps) and checks in Node, with the real kernel,
 * that every step computes. Prints the cold recompute time of each.
 *
 *   npx vite-node apps/fabcad/bench/makeModels.ts <out-dir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeDocument } from "@fabcad/cad-document";
import { FeatureEngine } from "@fabcad/features";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import { benchmarkDocument } from "./models";

const out = process.argv[2] ?? "bench-out";
mkdirSync(out, { recursive: true });
const kernel = await nodeKernel();

for (const steps of [20, 80, 200]) {
  const doc = benchmarkDocument(steps);
  const engine = new FeatureEngine(kernel, createDefaultSolver());
  const t = performance.now();
  const result = await engine.recompute(doc);
  const ms = performance.now() - t;
  const errors = Object.entries(result.features).filter(([, s]) => s.state === "error");
  const file = join(out, `bench-${steps}.fabcad.json`);
  writeFileSync(file, serializeDocument(doc, false));
  console.log(
    `${steps} steps: ${result.bodies.length} bodies, ${errors.length} errors, node cold recompute ${ms.toFixed(0)} ms → ${file}`,
  );
  for (const [id, s] of errors) console.log(`  ${doc.features[id]?.type} ${id}: ${s.message}`);
}
