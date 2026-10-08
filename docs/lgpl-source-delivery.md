# LGPL-2.1: OCCT WebAssembly source-distribution plan

Reviewed: 2026-10-09. **Not a certification of compliance.** This is a technical and legal handoff for [PR #49](https://github.com/fooping-tech/FabCAD/pull/49).

## Relevant legal text

- [LGPL-2.1 Section 6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html) permits linking other works under different terms subject to conditions, including permitting end users to modify the work for their own use and reverse-engineer for debugging such modifications.
- The combined executable distributor must supply the license text and prominent notice, and satisfy one of the Section 6(a)–(e) alternatives where applicable.
- Section **6(a)** concerns complete machine-readable corresponding source for the LGPL library, including modifications, and relinkable material for the application where applicable. Section **6(d)** applies when executable distribution is by download: equivalent access to the 6(a) materials from that same download location.
- Section **6(b)** describes a **suitable shared library mechanism**. **Do not assume** that merely loading a separate `.wasm` file from the server proves this option applies: the OCCT native C++ objects are linked *inside* that WASM binary, which is delivered with FabCAD rather than being an independent shared library preinstalled on the user's device. The legal applicability of each 6(a)–(e) option requires review.
- The [Open CASCADE Exception](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt) addresses OCCT header incorporation in a work that uses the library. **It does not create a general exemption from all LGPL obligations**.

## Precisely tracked source inputs

| Component | Pinned source | Role |
|---|---|---|
| Replicad OCCT bindings | [Replicad `v1.1.0`](https://github.com/sgenoud/replicad/tree/v1.1.0/packages/replicad-opencascadejs) | `build-config`, `build-source`, `wrappers/`, generated JS glue |
| OCCT | [`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`](https://github.com/Open-Cascade-SAS/OCCT/commit/b8f597c677811d1f9f4d8a97f5ae2825c0353a42) | C++ BRep kernel, version `V8_0_1` |
| OpenCascade.js | [`ebd263f15337b440b391492af073662707e86482`](https://github.com/taucad/opencascade.js/commit/ebd263f15337b440b391492af073662707e86482) | Docker recipe, OCCT build patches, [locked dependencies](https://github.com/taucad/opencascade.js/blob/ebd263f15337b440b391492af073662707e86482/DEPS.json) |
| FreeType | [`de8b92dd7ec634e9e2b25ef534c54a3537555c11`](https://github.com/freetype/freetype/commit/de8b92dd7ec634e9e2b25ef534c54a3537555c11) | Locked native build input; scope of use requires binary audit |
| RapidJSON | [`24b5e7a8b27f42fa16b96fc70aade9106cf7102f`](https://github.com/Tencent/rapidjson/commit/24b5e7a8b27f42fa16b96fc70aade9106cf7102f) | Locked native build input; scope of use requires binary audit |
| Emscripten | [`emscripten/emsdk:5.0.1`](https://hub.docker.com/r/emscripten/emsdk) | Compiler image pinned in OpenCascade.js `DEPS.json` |

The original builder OCI digest is `sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c`. [Full provenance / actual relink test](occt-wasm-lgpl.md) is tracked separately. Binary output from `npm run build` publishes `occt-wasm-provenance.json` with a hash of the *actual* served binary.

## Corresponding-source distribution mechanism (implemented as a candidate, not legally approved)

For every FabCAD release that publicly serves an OCCT WASM:

1. Record the full SHA-256 of the exact distributed `replicad-opencascadejs@1.1.0` WASM, and the hash of the generated JS glue. Match the released npm artifact against the pinned upstream build recipe where possible, retaining the exact configuration and changes.
2. Produce and **retain a machine-readable source archive** with the OCCT version and the *specific patches actually applied*, OpenCascade.js build scripts, Replicad's generated bindings/custom wrapper C++ and the licenses and notices. Identify exactly what was modified upstream vs unchanged.
3. Provide all required compilation/linking materials and a tested procedure sufficient for a recipient to rebuild and, where required, relink an interface-compatible OCCT WASM. Check the material actually used by the build, not only the list of upstream repository URLs.
4. Stage a downloadable source candidate **in the same GitHub Pages deployment** as the OCCT WASM: [candidate source bundle](https://fooping-tech.github.io/FabCAD/lgpl/occt-corresponding-source-candidate.tar.gz) and [SHA-256 manifest](https://fooping-tech.github.io/FabCAD/lgpl/occt-source-manifest.json). GitHub Actions artifacts expiring after 14 days are only test evidence; they are not the published download mechanism. Production packaging happens after `audit:occt` and deployment fails if candidate generation/validation fails. The links become live only **after this PR is merged and the Pages deployment succeeds**. If relying on LGPL §6(d), counsel must determine whether this packaging actually supplies all §6(a) materials with equivalent access.
5. Verify in actual Chromium that a WASM rebuilt with a real C++ change loads through FabCAD's generated CAD worker; retain the build command, source patch, browser console, HTTP status and test results.
6. Have counsel review whether §6(a)+(d) is the appropriate compliance route and whether the intended FabCAD Source Available terms permit the rights required by §6. **The separate same-origin WASM override is a useful engineering mechanism, not itself proof of a suitable LGPL §6(b) linking mechanism.**

### Implementation status

- [x] Upstream versions, source commits, patches location and builder image identified
- [x] 2026-10-08 CI [#37777431664](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664): C++ wrapper source modified; OCCT WASM relinked; Node CAD smoke and FabCAD build passed
- [x] Runtime dependency notices (npm, fonts, FreeType FTL, RapidJSON license) included in distribution
- [x] Exact served WASM hash recorded in `dist/occt-wasm-provenance.json`
- [x] Source-modified C++ wrapper WASM tested in Chromium: [CI #37782658677](https://github.com/fooping-tech/FabCAD/actions/runs/37782658677) loaded the real re-linked binary and performed an empty-document worker recompute. This is browser loader/worker proof; the geometry/STEP/STL operations were verified independently in Node.
- [x] Candidate source archive generated in [CI #37783285458](https://github.com/fooping-tech/FabCAD/actions/runs/37783285458), with pinned repositories and source/build references. This **does not establish exact correspondence with the distributed npm WASM or complete relink material**.
- [x] Automated Pages candidate source staging added to the deployment build, with release-WASM provenance embedded into the archive and a downloadable SHA-256 manifest. A release is only actually accessible **after merge and successful main deployment**.
- [ ] Independently validate complete applied OCCT patches, matching source-to-binary provenance, and whether the packaged objects, bindings, toolchain recipes, and source are sufficient to rebuild/relink under the applicable LGPL option.
- [ ] Verify the actual publicly deployed archive URL and its SHA-256 manifest after merge; protect stable access/retention for versions no longer current.
- [ ] Detailed legal determination of applicable LGPL §§4–6 and custom license permissions.

**Release gate**: Keep PR #49 in Draft pending source-to-binary/relink-material validation and legal sign-off. CI green and a same-origin candidate archive are not an LGPL compliance verdict.
