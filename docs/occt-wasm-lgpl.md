# Open CASCADE / WebAssembly LGPL provenance and replacement

Status: **Work in progress. Not a legal compliance certification.**
Reviewed: 2026-10-08.

FabCAD uses `replicad@1.1.0` (MIT for the Replicad JavaScript code) and `replicad-opencascadejs@1.1.0` (LGPL-2.1-only metadata), with Open CASCADE Technology (OCCT) under LGPL-2.1 and the OCCT-specific exception. The original FabCAD license does not change those rights.

## 1. Exact upstream lineage known so far

- [Upstream Replicad release tag `v1.1.0`](https://github.com/sgenoud/replicad/tree/v1.1.0).
- [Migration PR #263](https://github.com/sgenoud/replicad/pull/263): explicitly says it migrated to **OCCT 8.0.1** and regenerated the single-threaded and multi-threaded WebAssembly modules with pinned build images.
- [Upstream `replicad-opencascadejs` package and build commands](https://github.com/sgenoud/replicad/blob/v1.1.0/packages/replicad-opencascadejs/package.json): `npm run generateConfig` (`ytt`), `npm run buildSingle`, `npm run buildMulti`.
- [Single-threaded ytt build configuration](https://github.com/sgenoud/replicad/tree/v1.1.0/packages/replicad-opencascadejs/build-source), plus checked-in [generated build configuration and C++ wrappers](https://github.com/sgenoud/replicad/tree/v1.1.0/packages/replicad-opencascadejs/build-config).
- The upstream build command uses `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`. PR #263 records OCI digest `sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c`; the multi-threaded digest is `sha256:5cb67064edc903ae50c254e32417da9662fa88ec2e734386c28a3806949862ce`.
- The upstream image's own base OCCT source, Emscripten, patches and exact version-to-binary match still need verification before describing the source offer as complete. **Do not assume that the image tag alone proves correspondence to the npm binary.**

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

## 4. LGPL-2.1 redistribution tasks still open

- [x] Identify the upstream Replicad v1.1.0 build entry points, single-threaded OCI image and its recorded digest.
- [x] Document how FabCAD loads the separately distributed WASM, and provide an opt-in same-origin replacement path with automated URL-selection tests.
- [x] Automate a hash/size check of the `dist/` WASM in CI.
- [ ] Verify the full corresponding source chain, including OCCT 8.0.1 commit, any C++ changes/patches, the pinned upstream toolchain, and the license of each relevant component.
- [ ] Obtain or rebuild from the *same sources/configuration* as the published `replicad-opencascadejs@1.1.0` artifacts; compare hashes when reproducibility is expected, and otherwise document functional provenance.
- [ ] Verify with a **genuinely modified/rebuilt** WASM that users can replace it in a deployed FabCAD client, and whether all necessary materials for modified-library use/relinking are available to recipients as required by LGPL-2.1 §6.
- [ ] Confirm applicable source-delivery, relinking, and reverse-engineering conditions, including exceptions, notices and accessibility of license texts. Get legal review for distribution compliance; do not assume the existence of this recipe is sufficient.
- [ ] Audit all additional executable third-party components and required notices in the released build.

**Important**: OCCT's LGPL exception is limited; it is not an overall waiver of LGPL source and redistribution obligations. The `replicad-opencascadejs` package and the OCCT source have distinct licensing/provenance questions. The official application remains under the terms stated in the repo-root `LICENSE`, while third-party rights are unaffected.
