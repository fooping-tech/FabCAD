#!/usr/bin/env bash
# Preserve each publicly distributed OCCT WASM's corresponding-source
# candidate under a versioned GitHub Release, in addition to the Pages copy.
# Tag identity includes BOTH served WASM and source archive SHA-256 values.
# Creating this archive is evidence of availability, not LGPL certification.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
manifest="$repo_root/dist/lgpl/occt-source-manifest.json"
archive="$repo_root/dist/lgpl/occt-corresponding-source-candidate.tar.gz"
test -s "$manifest" && test -s "$archive" || {
  echo "Stage the OCCT source archive before publishing it" >&2
  exit 1
}
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
: "${GH_TOKEN:?A GitHub token with contents:write is required}"
: "${GH_REPO:=fooping-tech/FabCAD}"

readarray -t values < <(node --input-type=module - "$manifest" <<'NODE'
import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const key of ["archiveSha256", "archiveReleaseTag", "archiveReleaseUrl"]) {
  if (!m[key]) throw new Error("Missing manifest field " + key);
}
if (!/^[a-f0-9]{64}$/.test(m.archiveSha256)) throw new Error("Invalid archive digest");
if (!/^occt-source-[a-f0-9]{64}-[a-f0-9]{64}$/.test(m.archiveReleaseTag)) {
  throw new Error("Unexpected release tag");
}
const expected = `https://github.com/${process.env.GH_REPO}/releases/download/${m.archiveReleaseTag}/occt-corresponding-source-candidate.tar.gz`;
if (m.archiveReleaseUrl !== expected) throw new Error("Unexpected release URL");
console.log(m.archiveSha256);
console.log(m.archiveReleaseTag);
NODE
)
if (( ${#values[@]} != 2 )); then
  echo "Could not read the source manifest" >&2
  exit 1
fi
expected_sha="${values[0]}"
tag="${values[1]}"
actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
test "$actual_sha" = "$expected_sha" || {
  echo "Local source bundle SHA-256 does not match the manifest" >&2
  exit 1
}

# An existing release with this identity must never be modified in place.
# Fail on missing assets or changed bytes rather than replacing published source.
if gh release view "$tag" --repo "$GH_REPO" >/dev/null 2>&1; then
  echo "Source release already exists: $tag"
else
  gh release create "$tag" "$archive" \
    --repo "$GH_REPO" --target "${GITHUB_SHA:?GITHUB_SHA is required}" \
    --title "OCCT corresponding source candidate ${tag#occt-source-}" \
    --notes "Immutable-by-policy copy of the corresponding-source candidate for a FabCAD-distributed OCCT WASM. The tag contains both WASM and source archive SHA-256 values. This release is not a certification of LGPL completeness or reproducibility. Refer to the accompanying deployment manifest on GitHub Pages." \
    --latest=false
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
gh release download "$tag" --repo "$GH_REPO" \
  --pattern 'occt-corresponding-source-candidate.tar.gz' --dir "$tmp"
downloaded="$tmp/occt-corresponding-source-candidate.tar.gz"
test -s "$downloaded" || { echo "Release source asset is unavailable" >&2; exit 1; }
downloaded_sha="$(sha256sum "$downloaded" | awk '{print $1}')"
test "$downloaded_sha" = "$expected_sha" || {
  echo "Published release asset SHA-256 mismatch for $tag" >&2
  exit 1
}
echo "Long-term source candidate release available: https://github.com/$GH_REPO/releases/tag/$tag"
echo "Archived source SHA-256 verified: $expected_sha"
