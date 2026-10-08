# Open CASCADE / WebAssembly LGPL provenance and replacement

Status: **Work in progress. Not a legal compliance certification.**
Reviewed: 2026-10-08.

FabCAD uses `replicad@1.1.0` (MIT for the Replicad JavaScript code) and `replicad-opencascadejs@1.1.0` (LGPL-2.1-only metadata), with Open CASCADE Technology (OCCT) under LGPL-2.1 and the OCCT-specific exception. The original FabCAD license does not change those rights.

## 1. Exact upstream lineage known so far

- [Upstream Replicad release tag `v1.1.0`](https://github.com/sgenoud/replicad/tree/v1.1.0).
- The official [OCCT `V8_0_1` tag](https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_1) resolves to source commit [`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`](https://github.com/Open-Cascade-SAS/OCCT/commit/b8f597c677811d1f9f4d8a97f5ae2825c0353a42) (verified from the annotated upstream Git tag).
- The pinned `taucad/opencascade.js` canary label matches upstream commit [`ebd263f15337b440b391492af073662707e86482`](https://github.com/taucad/opencascade.js/commit/ebd263f15337b440b391492af073662707e86482), `Upgrade OCCT to 8.0.1`; that upstream contains OCCT patch tooling. The exact source image provenance still needs a build-level verification.
- [Migration PR #263](https://github.com/sgenoud/replicad/pull/263): explicitly says it migrated to **OCCT 8.0.1** and regenerated the single-threaded and multi-threaded WebAssembly modules with pinned build images.
- [Upstream `replicad-opencascadejs` package and build commands](https://github.com/sgenoud/replicad/blob/v1.1.0/packages/replicad-opencascadejs/package.json): `npm run generateConfig` (`ytt`), `npm run buildSingle`, `npm run buildMulti`.
- [Single-threaded ytt build configuration](https://github.com/sgenoud/replicad/tree/v1.1.0/packages/replicad-opencascadejs/build-source), plus checked-in [generated build configuration and C++ wrappers](https://github.com/sgenoud/replicad/tree/v1.1.0/packages/replicad-opencascadejs/build-config).
- The upstream build command uses `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`. PR #263 records OCI digest `sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c`; the multi-threaded digest is `sha256:5cb67064edc903ae50c254e32417da9662fa88ec2e734386c28a3806949862ce`.
- The pinned [taucad/opencascade.js source commit](https://github.com/taucad/opencascade.js/commit/ebd263f15337b440b391492af073662707e86482) includes a [`DEPS.json` source lock](https://github.com/taucad/opencascade.js/blob/ebd263f15337b440b391492af073662707e86482/DEPS.json) specifying OCCT `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, FreeType `de8b92dd7ec634e9e2b25ef534c54a3537555c11`, RapidJSON `24b5e7a8b27f42fa16b96fc70aade9106cf7102f`, Emscripten 5.0.1 and its Docker digest. [`src/patches/`](https://github.com/taucad/opencascade.js/tree/ebd263f15337b440b391492af073662707e86482/src/patches) holds OCCT patch tooling. These references are source inputs, **not yet a verified byte-for-byte match** against FabCAD's npm-distributed WASM.
- The upstream image's own build execution, applied patches, and exact source-to-binary match still need verification before describing the source offer as complete. **Do not assume that the image tag alone proves correspondence to the npm binary.** The taucad README notes short canary image retention; the named image may no longer be pullable, in which case a new reproducible build and compatibility proof are needed.

FabCAD loads `replicad-opencascadejs/wasm?url` from a dedicated CAD worker and passes its URL to the Replicad initializer through `locateFile`. This is a separate `.wasm` asset rather than a single monolithic JavaScript file.

## 2. Record the FabCAD-distributed WASM

```sh
npm ci
npm run build
npm run audit:occt
```

The audit checks the exact dependencies locked to `1.1.0`, locates the distributed WASM asset in `dist/`, checks its binary signature and prints its **SHA-256** and size. Keep this output in the PR/release records when performing the LGPL review. This does not establish that the LGPL requirements are satisfied.

## 3. Opt-in loading of a user-rebuilt single-threaded WASM

FabCAD retains its bundled original WASM by default. A separate build-time override exists to test a user-rebuilt compatible library without replacing or modifying FabCAD's own source.

**Requirements:** same interface/exports as the `replicad-opencascadejs@1.1.0` single-threaded module, compatible exception mode, and the same expected Emscripten runtime and generated JS glue. A different OCCT version or a multi-threaded build will not necessarily be compatible.

```sh
# 1. Produce the compatible WASM using the upstream source and build recipe.
#    The exact source/patches and reproducibility still require confirmation.
git clone https://github.com/sgenoud/replicad.git
cd replicad
git checkout v1.1.0
# Follow the upstream package's ytt + Docker build prerequisites and:
# pnpm install
# pnpm --dir packages/replicad-opencascadejs run generateConfig
# pnpm --dir packages/replicad-opencascadejs run buildSingle

# 2. Back in your FabCAD checkout: copy the resulting WASM (adjust path).
cp /path/to/replicad_single.wasm apps/fabcad/public/occt-override.wasm

# 3. Enable the locally supplied same-origin alternative:
VITE_FABCAD_OCCT_WASM_OVERRIDE=1 npm run build
VITE_FABCAD_OCCT_WASM_OVERRIDE=1 npm run audit:occt

# 4. Start the browser deployment, then test box/boolean/STEP/STL operations.
npm run preview
```

The flag is used **at build time** and deliberately does not accept arbitrary network URLs or link-supplied override parameters. The override file is gitignored so it cannot accidentally be committed. Builds fail immediately if the override flag is set and the file is absent. The build will copy the binary to `dist/occt-override.wasm`; the worker loads `<Vite BASE_URL>/occt-override.wasm`. Normal builds are unchanged.

**Compatibility test still outstanding:** execute the above workflow with an independently rebuilt WASM and record a real browser smoke test of at least extrusion, Boolean, STEP export, STL export and an ordinary model opening. Unit tests proving the URL routing are not proof that a modified library works.

## 3.1. Automated replacement integration smoke

GitHub Pages CI has a separate `occt-replacement-smoke` job on pull requests:

```sh
node scripts/test-occt-replacement.mjs
```

This makes a distinct, valid alternative WASM file by appending a **non-semantic WebAssembly custom section** to the exact installed `replicad-opencascadejs/wasm` binary. The changed SHA-256 proves the test did not reuse the identical original file.

The script uses that altered file to initialize OpenCascade.js and Replicad in Node, then verifies a box, a Boolean cut, STEP export, and STL export. It rebuilds FabCAD with `VITE_FABCAD_OCCT_WASM_OVERRIDE=1`, runs the OCCT distribution audit, verifies that `dist/occt-override.wasm` matches the supplied alternative byte for byte, and checks that the emitted worker references the replacement path. The test artifact is deleted afterward.

**Critical limitation:** Adding a custom section leaves OCCT functionality unchanged. This establishes a working alternate-file path, but neither independent C++ source recompilation nor genuine OCCT functionality changes. It does not test a deployed browser interacting with a custom OCCT build and is not proof of LGPL-2.1 compliance.

## 3.2. Source-level C++ wrapper modification and pinned WASM relink

A stronger validation than the custom-section smoke is now available via
`bash scripts/rebuild-occt-wrapper.sh`. The repository's Pages workflow includes
a **label-gated** pull-request job, `occt-source-rebuild`, which runs only
if the PR has the `occt-source-rebuild` label. It is not part of normal deployments.

The script:

1. Fetches Replicad's immutable source tag `v1.1.0` and checks the
   corresponding C++ build-config wrapper into a temporary directory.
2. Makes a real source-level change in
   `packages/replicad-opencascadejs/build-config/wrappers/shape-hasher.cpp`:
   the exported shape hasher uses `(nativeHash + 1)` instead of `nativeHash`
   before the modulus. This changes generated topology labels but leaves CAD
   geometry operations unchanged.
3. Pulls `ghcr.io/taucad/opencascade.js` by the **OCI digest** recorded in
   upstream Replicad PR #263, not a mutable tag.
4. Runs `link custom_build_single.yml` against the checked-in generated
   OCCT binding config and modified wrapper C++ source, producing a new
   `replicad_single.wasm`.
5. Passes that WASM into `OCCT_WASM_PATH=...`
   `node scripts/test-occt-replacement.mjs`; this loads it through npm's
   OpenCascade.js glue, exercises solids, Boolean, STEP and STL, then builds
   FabCAD using its explicit same-origin replacement path. CI records the
   source patch as an artifact when available.

### Verified CI result (2026-10-08)

[GitHub Actions #37777431664](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664) **completed successfully** on commit `c5f00abbfe9e01c92e3d0b9e816a8172e470821d`.

- Source patch: a change to Replicad's real `shape-hasher.cpp` C++ wrapper; the job uploaded its patch as [artifact #11550523221](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664/artifacts/11550523221) (GitHub retention is limited).
- OCI source image: the exact upstream digest was pulled; generated C++/WASM bindings compiled and linked.
- The generated modified WASM had a SHA-256 distinct from npm's original; `WebAssembly.validate()` passed.
- The modified WASM initialized through `replicad-opencascadejs@1.1.0` JS glue and completed box-volume, Boolean cut, STEP and STL test operations.
- The explicit alternate-WASM FabCAD Vite build and its output byte-for-byte hash check passed.
- The normal `build` and `occt-replacement-smoke` CI jobs also passed.
- **Not yet shown:** a before/after runtime assertion of the intended hash-label difference, automated browser interaction with the source-modified binary, or recompiling upstream OCCT sources. This confirms the **C++ wrapper recompilation / linkage / runtime compatibility path**, not full LGPL-2.1 compliance.

**This is not a full rebuild of OCCT C++ sources**: the pinned builder
contains separately compiled OCCT libraries. It tests changes to a C++
wrapper and a genuine WASM relink. An independent reconstruction of all
OCCT 8.0.1 libraries from the pinned OCCT commit and patches would require a
different, substantially more expensive upstream toolchain build.

The upstream canary image was documented as short-lived. If the pinned
OCI digest has been garbage-collected, the job will fail at `docker pull`.
That does not mean the software is non-compliant; it means the original image
must be rebuilt from source at `taucad/opencascade.js` commit
`ebd263f15337b440b391492af073662707e86482` before an independent
binary provenance/compatibility conclusion can be reached.

## 4. LGPL-2.1 redistribution tasks still open

- [x] Identify the upstream Replicad v1.1.0 build entry points, single-threaded OCI image and its recorded digest.
- [x] Document how FabCAD loads the separately distributed WASM, and provide an opt-in same-origin replacement path with automated URL-selection tests.
- [x] Run a CI integration smoke with a bitwise-altered WASM (non-semantic custom section), initialize CAD, execute Boolean and STEP/STL exports, and verify the override build output.
- [x] Recompile a source-modified Replicad C++ wrapper and re-link OCCT WASM from the pinned upstream OCI image; load it in Replicad, run Boolean and STEP/STL and build FabCAD with it ([successful CI](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664)).
- [x] Automate a hash/size check of the `dist/` WASM in CI.
- [ ] Verify the full corresponding source chain, including OCCT 8.0.1 commit, any C++ changes/patches, the pinned upstream toolchain, and the license of each relevant component.
- [ ] Obtain or rebuild from the *same sources/configuration* as the published `replicad-opencascadejs@1.1.0` artifacts; compare hashes when reproducibility is expected, and otherwise document functional provenance.
- [ ] Verify source-modified WASM use in a real **browser session** and whether all necessary materials for modified-library use/relinking are available to recipients as required by LGPL-2.1 §6. The Node/CAD + Vite integration smoke is already successful.
- [ ] Confirm applicable source-delivery, relinking, and reverse-engineering conditions, including exceptions, notices and accessibility of license texts. Get legal review for distribution compliance; do not assume the existence of this recipe is sufficient.
- [ ] Audit all additional executable third-party components and required notices in the released build.

**Important**: OCCT's LGPL exception is limited; it is not an overall waiver of LGPL source and redistribution obligations. The `replicad-opencascadejs` package and the OCCT source have distinct licensing/provenance questions. The official application remains under the terms stated in the repo-root `LICENSE`, while third-party rights are unaffected.
