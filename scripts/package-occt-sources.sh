#!/usr/bin/env bash
# Prepare a reproducible, version-pinned candidate corresponding-source archive
# for review of LGPL-2.1 distribution obligations. The output is NOT a
# certification of complete corresponding source / relinking materials.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$repo_root/occt-corresponding-source-candidate.tar.gz}"
output="$(realpath -m "$output")"
mkdir -p "$(dirname "$output")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/source"

checkout() {
  local name="$1" url="$2" sha="$3"
  local dest="$tmp/source/$name"
  echo "Fetching $name at immutable SHA $sha"
  git init -q "$dest"
  git -C "$dest" fetch --quiet --depth=1 "$url" "$sha"
  git -C "$dest" checkout --quiet --detach FETCH_HEAD
  local resolved
  resolved="$(git -C "$dest" rev-parse HEAD)"
  [[ "$resolved" == "$sha" ]] || { echo "Source SHA mismatch for $name: $resolved"; exit 1; }
  rm -rf "$dest/.git"
}

checkout replicad "https://github.com/sgenoud/replicad.git" "e4b05f67dc4e2393a876ce8c5064a9c93db05bf1"
checkout occt "https://github.com/Open-Cascade-SAS/OCCT.git" "b8f597c677811d1f9f4d8a97f5ae2825c0353a42"
checkout opencascade.js "https://github.com/taucad/opencascade.js.git" "ebd263f15337b440b391492af073662707e86482"
checkout freetype "https://github.com/freetype/freetype.git" "de8b92dd7ec634e9e2b25ef534c54a3537555c11"
checkout rapidjson "https://github.com/Tencent/rapidjson.git" "24b5e7a8b27f42fa16b96fc70aade9106cf7102f"

cat > "$tmp/README.txt" <<'EOF'
FabCAD OCCT corresponding-source candidate bundle
===============================================

Purpose: assemble immutable upstream source snapshots for examination.
NOT a declaration of LGPL-2.1 compliance, exact npm binary correspondence,
nor confirmation of complete relinking materials.

Source trees:
  replicad       e4b05f67dc4e2393a876ce8c5064a9c93db05bf1 (v1.1.0)
  occt           b8f597c677811d1f9f4d8a97f5ae2825c0353a42 (V8_0_1)
  opencascade.js ebd263f15337b440b391492af073662707e86482
  freetype       de8b92dd7ec634e9e2b25ef534c54a3537555c11
  rapidjson      24b5e7a8b27f42fa16b96fc70aade9106cf7102f

Look under source/opencascade.js/src/patches/ for upstream patch tooling and
under source/opencascade.js/DEPS.json for the Emscripten version/digest.
The OCCT upstream build, applied patches, LGPL source delivery and the exact
FabCAD-distributed npm WASM remain subject to review.

Original binary linking image:
  ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c

See FabCAD docs/occt-wasm-lgpl.md and docs/lgpl-source-delivery.md.
EOF

mkdir -p "$tmp/documentation"
cp "$repo_root/docs/occt-wasm-lgpl.md" "$tmp/documentation/"
cp "$repo_root/docs/lgpl-source-delivery.md" "$tmp/documentation/"
cp "$repo_root/THIRD_PARTY_NOTICES.md" "$tmp/documentation/"
cp "$repo_root/scripts/rebuild-occt-wrapper.sh" "$tmp/documentation/"
cp "$repo_root/LICENSE" "$tmp/documentation/fabcad-original-code-LICENSE"
cp "$repo_root/licenses/LGPL-2.1.txt" "$tmp/documentation/"
cp "$repo_root/licenses/OCCT_LGPL_EXCEPTION.txt" "$tmp/documentation/"
cp "$repo_root/scripts/package-occt-sources.sh" "$tmp/documentation/"
cp "$repo_root/scripts/test-occt-browser.mjs" "$tmp/documentation/"
cp "$repo_root/scripts/test-occt-replacement.mjs" "$tmp/documentation/"
# Include this release's actual published WASM digest whenever available.
# The archive is still only a candidate until matching source/build and LGPL
# section 6 requirements have been independently validated.
if [[ -f "$repo_root/dist/occt-wasm-provenance.json" ]]; then
  cp "$repo_root/dist/occt-wasm-provenance.json" "$tmp/documentation/"
fi

# Zero timestamps and fixed ordering make repeated builds comparable.
tar --sort=name --mtime="@0" --owner=0 --group=0 --numeric-owner \
  -C "$tmp" -cf - README.txt documentation source | gzip -n > "$output"
sha256sum "$output"
du -h "$output"

echo "CANDIDATE SOURCE ARCHIVE COMPLETE (LEGAL COMPLIANCE NOT DETERMINED)"
echo "Before publishing: verify exact binary correspondence, source patches, "
echo "section 6(a)/(d) materials and equivalent stable download access."
