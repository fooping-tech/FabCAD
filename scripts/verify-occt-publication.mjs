#!/usr/bin/env node
/**
 * Verify OCCT bytes from the actual public GitHub Pages deployment.
 * This is a transport/integrity test, NOT a proof of corresponding
 * OCCT source completeness, rebuildability, or LGPL legal compliance.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = new URL(process.env.FABCAD_PUBLIC_BASE || "https://fooping-tech.github.io/FabCAD/");
if (!base.pathname.endsWith("/")) throw new Error("Public base URL must end in /");
const expectedCommit = process.env.GITHUB_SHA || "";

async function jsonAt(path) {
  const response = await fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(path + " responded with HTTP " + response.status);
  return await response.json();
}

async function digestAt(path) {
  const url = new URL(path, base);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(240000) });
  if (!response.ok || !response.body) throw new Error(path + " responded with HTTP " + response.status);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { url: url.href, sha256: hash.digest("hex"), sizeBytes };
}

async function verify() {
  const manifest = await jsonAt("lgpl/occt-source-manifest.json");
  const provenance = await jsonAt("occt-wasm-provenance.json");
  assert.ok(/^[a-f0-9]{64}$/.test(manifest.archiveSha256), "invalid source digest");
  assert.ok(/^[a-f0-9]{64}$/.test(manifest.servedWasmSha256), "invalid WASM digest");
  assert.equal(manifest.servedWasmSha256, provenance.sha256);
  const tag = `occt-source-${manifest.servedWasmSha256}-${manifest.archiveSha256}`;
  const releaseUrl = `https://github.com/fooping-tech/FabCAD/releases/download/${tag}/occt-corresponding-source-candidate.tar.gz`;
  assert.equal(manifest.archiveReleaseTag, tag);
  assert.equal(manifest.archiveReleaseUrl, releaseUrl);
  if (expectedCommit) assert.equal(manifest.siteBuildCommit, expectedCommit, "Pages publication is from another commit");
  assert.equal(manifest.archive, "occt-corresponding-source-candidate.tar.gz");
  const source = await digestAt("lgpl/" + manifest.archive);
  assert.equal(source.sha256, manifest.archiveSha256, "published source archive hash mismatch");
  assert.equal(source.sizeBytes, manifest.archiveSizeBytes, "published source archive size mismatch");
  const archivedSource = await digestAt(releaseUrl);
  assert.equal(archivedSource.sha256, manifest.archiveSha256, "release source hash mismatch");
  assert.equal(archivedSource.sizeBytes, manifest.archiveSizeBytes, "release source size mismatch");
  assert.ok(provenance.selectedWasm.startsWith("dist/"), "untrusted WASM relative path");
  const wasmPath = provenance.selectedWasm.slice(5);
  assert.ok(!wasmPath.includes("..") && !wasmPath.startsWith("/"), "invalid WASM asset path");
  const wasm = await digestAt(wasmPath);
  assert.equal(wasm.sha256, manifest.servedWasmSha256, "published WASM hash mismatch");
  assert.equal(wasm.sizeBytes, manifest.servedWasmSizeBytes, "published WASM size mismatch");
  const notice = await fetch(new URL("licenses.html", base), { signal: AbortSignal.timeout(120000) });
  assert.ok(notice.ok, "published license page unavailable");
  const html = await notice.text();
  assert.ok(html.includes("occt-corresponding-source-candidate.tar.gz"), "missing public source download link");
  console.log(JSON.stringify({
    status: "public bytes and release manifest verified (not LGPL compliance)",
    siteBuildCommit: manifest.siteBuildCommit,
    source, archivedSource, wasm,
    sourceToOriginalBinaryReproducible: "not established by this check"
  }, null, 2));
}

let failure;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    await verify();
    process.exit(0);
  } catch (err) {
    failure = err;
    console.warn("Public Pages verification attempt " + (attempt + 1) + " failed: " + String(err));
    if (attempt !== 11) await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
throw failure;
