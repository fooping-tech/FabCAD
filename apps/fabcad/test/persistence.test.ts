import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutosaveConflictError,
  autosaveChecksum,
  currentAutosaveToken,
  loadAutosave,
  loadRecoverySnapshots,
  openDb,
  storeAutosave,
} from "../src/app/persistence";
import { DocumentStore, addParameter, createDocument } from "@fabcad/cad-document";

const project = (name: string): string => JSON.stringify({ format: "fabcad", document: { name } });

/** Writes the kept autosave as it is, to damage it or to write the format of version 2. */
async function putHead(value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(value, "autosave");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // Saves in a row get times in order, as they would in use.
  let now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now++);
});

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

describe("autosave journal", () => {
  it("reads back what was saved, with the token to save over it", async () => {
    const token = await storeAutosave(project("A"), null);
    expect(await loadAutosave()).toEqual({ json: project("A"), token, recovered: false });
    expect(await currentAutosaveToken()).toBe(token);
  });

  it("keeps the last 5 versions, newest first", async () => {
    let token: string | null = null;
    for (let i = 1; i <= 7; i++) token = await storeAutosave(project(`v${i}`), token);
    const names = (await loadRecoverySnapshots()).map((e) => (JSON.parse(e.json) as { document: { name: string } }).document.name);
    expect(names).toEqual(["v7", "v6", "v5", "v4", "v3"]);
  });

  it("refuses to save over a newer autosave of another tab", async () => {
    const first = await storeAutosave(project("A"), null);
    await storeAutosave(project("other tab"), first);
    await expect(storeAutosave(project("this tab"), first)).rejects.toBeInstanceOf(AutosaveConflictError);
    expect((await loadAutosave()).json).toBe(project("other tab"));
    // Keeping this tab: it saves over the token it reads now.
    await storeAutosave(project("this tab"), await currentAutosaveToken());
    expect((await loadAutosave()).json).toBe(project("this tab"));
  });

  it("falls back to the newest intact version when the latest is damaged", async () => {
    let token = await storeAutosave(project("A"), null);
    token = await storeAutosave(project("B"), token);
    await putHead({ token: "damaged", json: project("C"), checksum: "0", savedAt: Date.now() });
    const loaded = await loadAutosave();
    expect(loaded).toEqual({ json: project("B"), token: "damaged", recovered: true });
    // The damaged one is replaced by the next save.
    await storeAutosave(project("D"), loaded.token);
    expect((await loadAutosave()).json).toBe(project("D"));
  });

  it("reads and replaces an autosave of the previous format", async () => {
    await putHead(project("old"));
    const loaded = await loadAutosave();
    expect(loaded).toEqual({ json: project("old"), token: null, recovered: false });
    await storeAutosave(project("new"), loaded.token);
    expect((await loadAutosave()).json).toBe(project("new"));
  });
});
