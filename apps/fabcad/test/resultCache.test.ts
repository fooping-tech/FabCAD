import { addSketch, createDocument, renameDocument, setExtension } from "@fabcad/cad-document";
import { describe, expect, it } from "vitest";
import { geometryKey } from "../src/app/resultCache";

describe("the key of a cached model", () => {
  const doc = createDocument("Part");
  const sketched = addSketch({ type: "origin", plane: "XY" }).apply(doc);

  it("is the same for the same model and changes with what shapes it", () => {
    expect(geometryKey(doc)).toBe(geometryKey(JSON.parse(JSON.stringify(doc))));
    expect(geometryKey(sketched)).not.toBe(geometryKey(doc));
    expect(geometryKey({ ...sketched, timelineCursor: 0 })).not.toBe(geometryKey(sketched));
  });

  it("does not change with the name or the settings of other workspaces", () => {
    expect(geometryKey(renameDocument("Other").apply(sketched))).toBe(geometryKey(sketched));
    expect(geometryKey(setExtension("fabrication.laser", { material: "x" }).apply(sketched))).toBe(geometryKey(sketched));
  });
});
