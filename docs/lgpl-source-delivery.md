# LGPL-2.1: OCCT WebAssembly source-distribution plan

Reviewed: 2026-10-08. **Not a certification of compliance.** This is a technical and legal handoff for [PR #49](https://github.com/fooping-tech/FabCAD/pull/49).

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

## A defensible release-package plan (not yet implemented)

For every FabCAD release that publicly serves an OCCT WASM:

1. Record the full SHA-256 of the exact distributed `replicad-opencascadejs@1.1.0` WASM, and the hash of the generated JS glue. Match the released npm artifact against the pinned upstream build recipe where possible, retaining the exact configuration and changes.
2. Produce and **retain a machine-readable source archive** with the OCCT version and the *specific patches actually applied*, OpenCascade.js build scripts, Replicad's generated bindings/custom wrapper C++ and the licenses and notices. Identify exactly what was modified upstream vs unchanged.
3. Provide all required compilation/linking materials and a tested procedure sufficient for a recipient to rebuild and, where required, relink an interface-compatible OCCT WASM. Check the material actually used by the build, not only the list of upstream repository URLs.
4. Provide an accessible, stable download for the corresponding materials along with the distributed WASM. If relying on LGPL §6(d), make these available with *equivalent access from the designated download location*; a GitHub Actions artifact expiring after 14 days is not sufficient as the sole long-term source-offer channel.
5. Verify in actual Chromium that a WASM rebuilt with a real C++ change loads through FabCAD's generated CAD worker; retain the build command, source patch, browser console, HTTP status and test results.
6. Have counsel review whether §6(a)+(d) is the appropriate compliance route and whether the intended FabCAD Source Available terms permit the rights required by §6. **The separate same-origin WASM override is a useful engineering mechanism, not itself proof of a suitable LGPL §6(b) linking mechanism.**

### Implementation status

- [x] Upstream versions, source commits, patches location and builder image identified
- [x] 2026-10-08 CI [#37777431664](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664): C++ wrapper source modified; OCCT WASM relinked; Node CAD smoke and FabCAD build passed
- [x] Runtime dependency notices (npm, fonts, FreeType FTL, RapidJSON license) included in distribution
- [x] Exact served WASM hash recorded in `dist/occt-wasm-provenance.json`
- [ ] Chromium test for *source-modified* WASM, not only a synthetically altered file
- [ ] Complete, tested corresponding source and rebuild bundle, including all OCCT source changes
- [ ] Permanent equivalent source download mechanism for the publicly distributed WASM
- [ ] Detailed legal determination of applicable LGPL §§4–6 and custom license permissions

**Release gate**: Keep PR #49 in Draft until the outstanding distribution issues are addressed; a green CI pipeline alone is not a legal compliance determination.
