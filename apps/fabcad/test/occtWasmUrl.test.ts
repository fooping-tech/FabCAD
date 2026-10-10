import { describe, expect, it } from "vitest";
import { resolveOcctWasmUrl } from "../src/worker/occtWasmUrl";

describe("OCCT WASM replacement URL", () => {
  it("uses the bundled asset unless explicitly opted in", () => {
    expect(resolveOcctWasmUrl("/FabCAD/assets/replicad_single-123.wasm", "/FabCAD/", false))
      .toBe("/FabCAD/assets/replicad_single-123.wasm");
  });

  it("respects the GitHub Pages base path", () => {
    expect(resolveOcctWasmUrl("/ignored.wasm", "/FabCAD/", true))
      .toBe("/FabCAD/occt-override.wasm");
  });

  it("supports custom root deployments", () => {
    expect(resolveOcctWasmUrl("/ignored.wasm", "/", true))
      .toBe("/occt-override.wasm");
  });

  it("does not require a trailing slash in the base path", () => {
    expect(resolveOcctWasmUrl("/ignored.wasm", "/FabCAD", true))
      .toBe("/FabCAD/occt-override.wasm");
  });
});
