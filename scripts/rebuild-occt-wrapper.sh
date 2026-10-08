#!/usr/bin/env bash
# Re-link the Replicad/OCCT WASM from pinned upstream build inputs, changing
# executable C++ wrapper behavior (not just appending a custom WASM section).
#
# This is an optional, resource-intensive integration check.
# It links against the OCCT 8.0.1 libraries inside a pinned OCI build image.
# It DOES NOT rebuild the upstream OCCT C++ sources from scratch and is NOT
# an LGPL compliance certificate.
set -euo pipefail

REPLICAD_TAG="v1.1.0"
OCJS_SOURCE_SHA="ebd263f15337b440b391492af073662707e86482"
OCCT_SOURCE_SHA="b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
BUILD_IMAGE="ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="${OCCT_REBUILD_WORK:-${RUNNER_TEMP:-}/fabcad-occt-source-rebuild}"
if [[ -z "${OCCT_REBUILD_WORK:-}" && -z "${RUNNER_TEMP:-}" ]]; then
  work="$(mktemp -d)"
fi
mkdir -p "$work"
echo "Working dir: $work"
echo "Upstream tag: $REPLICAD_TAG"
echo "OCJS source commit: $OCJS_SOURCE_SHA"
echo "OCCT source commit: $OCCT_SOURCE_SHA"
echo "Pinned OCI image: $BUILD_IMAGE"

git clone --depth 1 --branch "$REPLICAD_TAG" https://github.com/sgenoud/replicad.git "$work/replicad"
pkg="$work/replicad/packages/replicad-opencascadejs"
cpp="$pkg/build-config/wrappers/shape-hasher.cpp"
export OCCT_WRAPPER_FILE="$cpp"

# The replacement C++ hash function returns different labels but unchanged
# geometric solid/Boolean results.
python3 - <<'PY'
import os
from pathlib import Path
p = Path(os.environ["OCCT_WRAPPER_FILE"])
source = p.read_text()
before = "TopTools_ShapeMapHasher{}(shape) % static_cast<std::size_t>(upperBound) + 1);"
after = "(TopTools_ShapeMapHasher{}(shape) + 1) % static_cast<std::size_t>(upperBound) + 1);"
if source.count(before) != 1:
    raise SystemExit("Aborting: unexpected upstream C++ wrapper content")
p.write_text(source.replace(before, after))
PY

cd "$work/replicad"
git diff -- packages/replicad-opencascadejs/build-config/wrappers/shape-hasher.cpp > "$work/replicad-wrapper-change.patch"
test -s "$work/replicad-wrapper-change.patch"
cat "$work/replicad-wrapper-change.patch"
cd "$repo_root"

# The v1.1.0 tree includes generated ytt config and C++ wrapper sources.
# Pull by OCI digest, never the mutable canary tag.
docker pull "$BUILD_IMAGE"
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$pkg/build-config:/src" \
  "$BUILD_IMAGE" link custom_build_single.yml

out="$pkg/build-config/replicad_single.wasm"
test -s "$out"
sha256sum "$out"

# Run the genuinely re-linked WASM with installed npm JavaScript glue.
OCCT_WASM_PATH="$out" \
  node scripts/test-occt-replacement.mjs

echo "SOURCE WRAPPER REBUILD PASSED: modified C++ wrapper, linked WASM, CAD smoke"
echo "NOT TESTED: independent OCCT C++ source rebuild, LGPL legal compliance"
