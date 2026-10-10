#!/usr/bin/env bash
# Independent evidence for whether the exact pinned upstream C++ wrappers +
# pinned OCI linker regenerate the npm-distributed replicad_single.wasm.
# IMPORTANT: The pinned OCI image already contains compiled OCCT libraries.
# Matching this test NEVER proves an OCCT full source rebuild or LGPL compliance.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
IMAGE="ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c"
REPLICAD_SHA="e4b05f67dc4e2393a876ce8c5064a9c93db05bf1"
work="${OCCT_COMPARE_WORK:-${RUNNER_TEMP:-/tmp}/fabcad-occt-origin-compare}"
mkdir -p "$work"
test ! -e "$work/replicad" || { echo "Refusing to reuse nonempty comparison checkout" >&2; exit 1; }
git init -q "$work/replicad"
git -C "$work/replicad" fetch -q --depth=1 https://github.com/sgenoud/replicad.git "$REPLICAD_SHA"
git -C "$work/replicad" checkout -q --detach FETCH_HEAD
test "$(git -C "$work/replicad" rev-parse HEAD)" = "$REPLICAD_SHA"
wasm_npm="$(node -p "require.resolve('replicad-opencascadejs/wasm')")"
js_npm="$(dirname "$wasm_npm")/replicad_single.js"
test -s "$wasm_npm"
test -s "$js_npm"
pkg="$work/replicad/packages/replicad-opencascadejs"
docker pull "$IMAGE"
docker run --rm -u "$(id -u):$(id -g)" -v "$pkg/build-config:/src" "$IMAGE" link custom_build_single.yml
wasm_rebuilt="$pkg/build-config/replicad_single.wasm"
js_rebuilt="$pkg/build-config/replicad_single.js"
test -s "$wasm_rebuilt"
test -s "$js_rebuilt"

export COMPARE_NPM_WASM="$wasm_npm"
export COMPARE_REBUILT_WASM="$wasm_rebuilt"
export COMPARE_NPM_JS="$js_npm"
export COMPARE_REBUILT_JS="$js_rebuilt"
export COMPARE_REPORT="$work/original-wasm-comparison.json"
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const info = async path => {
  const buffer = await readFile(process.env[path]);
  return { sha256: createHash("sha256").update(buffer).digest("hex"), sizeBytes: buffer.length };
};
const npmWasm = await info("COMPARE_NPM_WASM");
const rebuiltWasm = await info("COMPARE_REBUILT_WASM");
const npmJs = await info("COMPARE_NPM_JS");
const rebuiltJs = await info("COMPARE_REBUILT_JS");
const data = {
  result: "comparison only, not LGPL compliance proof",
  exactUpstreamReplicadCommit: "e4b05f67dc4e2393a876ce8c5064a9c93db05bf1",
  pinnedBuilderDigest: "sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c",
  occtFullyRecompiledFromSource: false,
  npmWasm, rebuiltWasm, wasmByteIdentical: npmWasm.sha256 === rebuiltWasm.sha256,
  npmJs, rebuiltJs, jsByteIdentical: npmJs.sha256 === rebuiltJs.sha256,
  qualification: "A mismatch may reflect nondeterminism or differences in the original published build. A match demonstrates only the upstream wrapper/OCI linker regeneration, not exact source provenance of the precompiled OCCT libraries in the OCI image."
};
await writeFile(process.env.COMPARE_REPORT, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify(data, null, 2));
if (!data.wasmByteIdentical) console.warn("WASM BITWISE MISMATCH: original npm WASM not exactly reproduced from pinned wrapper and OCI linker.");
NODE
echo "Comparison report saved: $work/original-wasm-comparison.json"
