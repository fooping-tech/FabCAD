#!/usr/bin/env bash
# Extract the actual tracked OCCT source modifications present inside the
# pinned upstream builder image. Unpatched sources + patch-tool scripts alone
# do NOT establish corresponding source.
#
# This is source-input provenance evidence, not proof the npm WASM came from
# those exact objects and not an LGPL-2.1 compliance determination.
set -euo pipefail

IMAGE="ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c"
OCCT_SHA="b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/export-occt-image-patches.sh OUTPUT_DIRECTORY" >&2
  exit 2
fi
out="$1"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

docker pull "$IMAGE"
docker run --rm --user "$(id -u):$(id -g)" \
  --env "EXPECTED_OCCT_SHA=$OCCT_SHA" \
  --volume "$out:/evidence" \
  --entrypoint bash "$IMAGE" -lc '
set -euo pipefail
repo=/opencascade.js/deps/OCCT
test -d "$repo/.git" || {
  echo "Pinned builder missing OCCT source Git metadata; cannot attest patches" >&2
  exit 1
}
actual="$(git -C "$repo" rev-parse HEAD)"
test "$actual" = "$EXPECTED_OCCT_SHA" || {
  echo "Builder source commit differs from released snapshot: $actual" >&2
  exit 1
}
# Include staged + unstaged modifications of all tracked OCCT files.
git -C "$repo" diff --binary --no-ext-diff HEAD -- > /evidence/occt-image-applied.patch
git -C "$repo" diff --name-only HEAD -- > /evidence/occt-image-changed-paths.txt
git -C "$repo" ls-files --others --exclude-standard > /evidence/occt-image-untracked-paths.txt
test ! -s /evidence/occt-image-untracked-paths.txt || {
  echo "Untracked OCCT source files are missing from the patch!" >&2
  cat /evidence/occt-image-untracked-paths.txt >&2
  exit 1
}
test -s /evidence/occt-image-applied.patch || {
  echo "Expected OCCT patch not found; inspect builder" >&2
  exit 1
}
test -s /opencascade.js/build/patches-applied.json || {
  echo "Builder lacks patch-state manifest" >&2
  exit 1
}
cp /opencascade.js/build/patches-applied.json /evidence/ocjs-patches-applied.json
if test -s /opencascade.js/build/build-flags.json; then
  cp /opencascade.js/build/build-flags.json /evidence/ocjs-build-flags.json
fi
printf "%s\n" "$actual" > /evidence/occt-source-commit.txt
echo "Builder OCCT tracked changes:"
wc -l /evidence/occt-image-applied.patch
sha256sum /evidence/occt-image-applied.patch
'
printf '%s\n' "$IMAGE" > "$out/ocjs-builder-image.txt"
echo "OCCT builder patch evidence saved to $out"
echo "This is NOT evidence of complete application relinking material."
