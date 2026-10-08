#!/usr/bin/env node
/**
 * Reproducible metadata check for the OCCT WebAssembly artifact shipped by
 * FabCAD. This is an integrity/provenance aid, NOT a legal compliance verdict.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const versionOf = (name) => lock.packages?.[`node_modules/${name}`]?.version;

if (versionOf("replicad") !== "1.1.0" || versionOf("replicad-opencascadejs") !== "1.1.0") {
  throw new Error("OCCT provenance documentation must be reviewed when Replicad versions change");
}

async function walk(directory) {
  const paths = [];
  for (const child of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, child.name);
    if (child.isDirectory()) paths.push(...await walk(path));
    else if (child.isFile()) paths.push(path);
  }
  return paths;
}

const files = await walk(dist);
const wasmFiles = files.filter((p) => p.endsWith(".wasm"));
const normalWasm = wasmFiles.filter((p) => /replicad_single.*\.wasm$/i.test(p));
const override = process.env.VITE_FABCAD_OCCT_WASM_OVERRIDE === "1";
const overridePath = join(dist, "occt-override.wasm");
const selected = override ? overridePath : normalWasm[0];

if (!selected || !wasmFiles.includes(selected)) {
  throw new Error(`OCCT WASM not found in dist (override=${override}; assets=${wasmFiles.map((p)=>relative(dist,p)).join(", ")})`);
}
if (!override && normalWasm.length !== 1) {
  throw new Error(`Expected exactly one bundled replicad_single*.wasm asset, found ${normalWasm.length}`);
}

const bytes = await readFile(selected);
const wasmHeader = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
if (bytes.length < wasmHeader.length || !bytes.subarray(0, 8).equals(wasmHeader)) {
  throw new Error(`Selected OCCT binary is not a valid WebAssembly header: ${selected}`);
}
const info = await stat(selected);
const report = {
  status: "artifact checks passed (not an LGPL compliance certification)",
  "replicad": versionOf("replicad"),
  "replicad-opencascadejs": versionOf("replicad-opencascadejs"),
  selectedWasm: relative(root, selected),
  sizeBytes: info.size,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  replacementMode: override,
};
console.log(JSON.stringify(report, null, 2));
