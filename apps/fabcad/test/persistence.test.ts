import { describe, expect, it } from "vitest";
import { autosaveChecksum } from "../src/app/persistence";
import { DocumentStore, addParameter, createDocument } from "@fabcad/cad-document";

describe("browser recovery integrity", () => {
  it("changes checksum when serialized project changes", () => {
    const a = '{"document":{"name":"A"}}';
    const b = '{"document":{"name":"B"}}';
    expect(autosaveChecksum(a)).toBe(autosaveChecksum(a));
    expect(autosaveChecksum(a)).not.toBe(autosaveChecksum(b));
  });

  it("does not consider recovered data to be a manually exported project", () => {
    const original = new DocumentStore(createDocument("Original"));
    original.execute(addParameter({ name: "width", expression: "10", unit: "mm" }));
    const restored = new DocumentStore(createDocument());
    restored.load(original.document);
    expect(restored.dirty).toBe(false);
    restored.markUnsaved();
    expect(restored.dirty).toBe(true);
    restored.markSaved();
    expect(restored.dirty).toBe(false);
  });
});
