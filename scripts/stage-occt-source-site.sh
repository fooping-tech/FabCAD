#!/usr/bin/env bash
# Stage a pinned candidate corresponding-source archive alongside the exact
# OCCT WASM served by GitHub Pages. This is NOT an LGPL-compliance certificate.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
dist="$repo_root/dist"
provenance="$dist/occt-wasm-provenance.json"
target_dir="$dist/lgpl"
archive="$target_dir/occt-corresponding-source-candidate.tar.gz"
manifest="$target_dir/occt-source-manifest.json"

test -s "$provenance" || { echo "Run npm run build && npm run audit:occt first"; exit 1; }
mkdir -p "$target_dir"

# The archive generator embeds this exact dist provenance file for traceability.
bash "$repo_root/scripts/package-occt-sources.sh" "$archive"
test -s "$archive"
tar -tzf "$archive" >/dev/null

# A hard cap prevents a silently oversized GitHub Pages publication.
size="$(stat -c %s "$archive")"
if (( size > 99000000 )); then
  echo "Candidate source bundle is too large for the planned Pages release: $size" >&2
  exit 1
fi

# Fail rather than publish a partially packaged archive.
listing="$(tar -tzf "$archive")"
for needed in \
  README.txt \
  documentation/occt-wasm-provenance.json \
  documentation/rebuild-occt-wrapper.sh \
  documentation/LGPL-2.1.txt \
  documentation/OCCT_LGPL_EXCEPTION.txt \
  source/replicad/packages/replicad-opencascadejs/build-config/wrappers/shape-hasher.cpp \
  source/occt/CMakeLists.txt \
  source/opencascade.js/DEPS.json; do
  if ! grep -Fxq "$needed" <<< "$listing"; then
    echo "Source bundle missing $needed" >&2
    exit 1
  fi
done

SOURCE_ARCHIVE="$archive" SOURCE_MANIFEST="$manifest" OCCT_PROVENANCE="$provenance" node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const provenance = JSON.parse(await readFile(process.env.OCCT_PROVENANCE, "utf8"));
if (provenance.replacementMode || provenance["replicad-opencascadejs"] !== "1.1.0")
  throw new Error("Source bundle correspondence must be reviewed when the distributed OCCT WASM changes");
const bytes = await readFile(process.env.SOURCE_ARCHIVE);
const report = {
  status: "candidate source archive: legal completeness and exact binary correspondence unverified",
  archive: "occt-corresponding-source-candidate.tar.gz",
  archiveSizeBytes: bytes.byteLength,
  archiveSha256: createHash("sha256").update(bytes).digest("hex"),
  servedWasmSha256: provenance.sha256,
  servedWasmSizeBytes: provenance.sizeBytes,
  servedWasmPath: provenance.selectedWasm,
  sourceProvenance: provenance.sourceProvenance,
  limitation: "Pinning upstream commits and packaging source does not establish that these exact sources generated the npm-distributed WASM, or that all required relink materials and LGPL notices have been provided."
};
await writeFile(process.env.SOURCE_MANIFEST, JSON.stringify(report, null, 2) + "\n");
console.log("Published candidate OCCT source bundle manifest:", JSON.stringify({
  archiveSizeBytes: report.archiveSizeBytes,
  archiveSha256: report.archiveSha256,
  servedWasmSha256: report.servedWasmSha256
}, null, 2));
NODE

# Check the published archive hash against the manifest on every deployment.
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = process.cwd();
const path = root + "/dist/lgpl/";
const manifest = JSON.parse(await readFile(path + "occt-source-manifest.json", "utf8"));
const archive = await readFile(path + manifest.archive);
if (createHash("sha256").update(archive).digest("hex") !== manifest.archiveSha256)
  throw new Error("Source bundle hash mismatch");
const provenance = JSON.parse(await readFile(root + "/dist/occt-wasm-provenance.json", "utf8"));
if (provenance.sha256 !== manifest.servedWasmSha256)
  throw new Error("Candidate bundle metadata is for a different served WASM");
console.log("Source bundle / distributed WASM hash correspondence metadata verified");
NODE

echo "Candidate source bundle staged in $target_dir (NOT a declaration of LGPL compliance)"
