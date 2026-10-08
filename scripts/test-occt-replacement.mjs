#!/usr/bin/env node
/**
 * Exercise the opt-in OCCT WASM replacement path in CI.
 *
 * This creates a *valid but semantically unchanged* alternative WASM by
 * appending a WebAssembly custom section, then instantiates that exact file
 * with Replicad, checks CAD operations, builds FabCAD with the override,
 * and checks the build output. It is NOT an independently rebuilt/modified
 * OCCT library and does NOT certify LGPL compliance.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const originalPath = require.resolve("replicad-opencascadejs/wasm");
const overridePath = join(root, "apps/fabcad/public/occt-override.wasm");
const distDir = join(root, "dist");

function uleb128(number) {
  assert.ok(Number.isSafeInteger(number) && number >= 0);
  const bytes = [];
  do {
    let next = number & 0x7f;
    number = Math.floor(number / 128);
    if (number) next |= 0x80;
    bytes.push(next);
  } while (number);
  return Buffer.from(bytes);
}

function appendCustomSection(wasm) {
  const name = Buffer.from("fabcad-replacement-smoke", "utf8");
  const description = Buffer.from("Testing separate WASM replacement; OCCT instructions unchanged", "utf8");
  const payload = Buffer.concat([uleb128(name.length), name, description]);
  const section = Buffer.concat([Buffer.from([0]), uleb128(payload.length), payload]);
  return Buffer.concat([wasm, section]);
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const values = await Promise.all(entries.map(async (entry) => {
    const target = join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return values.flat();
}

const original = await readFile(originalPath);
const replacement = appendCustomSection(original);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.notEqual(digest(original), digest(replacement), "test artifact must differ from original");
assert.equal(WebAssembly.validate(replacement), true, "appended WASM must be structurally valid");

try {
  await writeFile(overridePath, replacement);
  console.log("Alternative WASM written", { bytes: replacement.length, sha256: digest(replacement) });

  // Load the changed binary through the actual OpenCascade.js glue.
  const { default: initOC } = await import("replicad-opencascadejs");
  const replicad = await import("replicad");
  const oc = await initOC({ wasmBinary: replacement });
  replicad.setOC(oc);

  const box = replicad.makeBox([0, 0, 0], [10, 20, 30]);
  assert.ok(Math.abs(replicad.measureVolume(box) - 6000) < 1e-3, "box volume");
  const cylinder = replicad.makeCylinder(2, 30, [5, 10, 0]);
  const cut = box.cut(cylinder);
  assert.ok(replicad.measureVolume(cut) < 6000, "Boolean cut must remove material");
  assert.ok(replicad.measureVolume(cut) > 5500, "Boolean cut volume should remain plausible");
  const stepBlob = replicad.exportSTEP([{ shape: cut, name: "Replacement verification" }], {
    unit: "MM",
    modelUnit: "MM",
  });
  const step = new Uint8Array(await stepBlob.arrayBuffer());
  assert.ok(step.length > 500 && new TextDecoder().decode(step.subarray(0, 200)).includes("ISO-10303-21"), "STEP export");
  const stl = cut.blobSTL({ tolerance: 0.1, angularTolerance: 0.3, binary: true });
  assert.ok((await stl.arrayBuffer()).byteLength > 100, "STL export");
  console.log("Altered-section WASM: OCCT initialization, solid creation, Boolean, STEP/STL passed");

  // Build the browser app against that same alternate binary.
  run("npm", ["run", "build"], { VITE_FABCAD_OCCT_WASM_OVERRIDE: "1" });
  run("npm", ["run", "audit:occt"], { VITE_FABCAD_OCCT_WASM_OVERRIDE: "1" });

  const published = await readFile(join(distDir, "occt-override.wasm"));
  assert.equal(digest(published), digest(replacement), "built WASM must exactly match supplied alternative");
  const files = await walk(distDir);
  const js = (await Promise.all(files.filter(f => f.endsWith(".js")).map(f => readFile(f, "utf8")))).join("\n");
  assert.ok(js.includes("occt-override.wasm"), "compiled worker must reference the override asset");
  console.log("FabCAD build: alternate WASM byte identity and worker reference verified");
} finally {
  // Never leave the locally generated replacement in the developer's working tree.
  await rm(overridePath, { force: true });
}
