import type { CadDocument } from "@fabcad/cad-document";
import { hashString } from "@fabcad/features";
import { RESULT_STORE, openDb } from "./persistence";
import type { ModelState } from "./session";

/**
 * The computed model of a document, kept in IndexedDB so that opening the same document again
 * shows it at once: the meshes of the bodies with their names, the planes and the status of
 * every feature and sketch. The feature engine still recomputes the document in the background
 * (it needs the solids, not only their meshes); until it is done the model is shown as busy.
 *
 * One entry per document id, for the few documents opened last. An entry is used only for the
 * document it was computed from: `geometryKey` covers everything that shapes the model.
 */

export type CachedModel = Pick<ModelState, "bodies" | "planes" | "features" | "sketches">;

interface Entry {
  key: string;
  savedAt: number;
  model: CachedModel;
}

const KEEP = 4;

/** A hash of the parts of a document that the model depends on. */
export function geometryKey(doc: CadDocument): string {
  return hashString(
    JSON.stringify([doc.features, doc.timeline, doc.timelineCursor, doc.parameters, doc.assembly, doc.bodies]),
  );
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

/** The cached model of `doc`, or null when there is none for exactly this document. */
export async function loadCachedModel(doc: CadDocument): Promise<CachedModel | null> {
  try {
    const db = await openDb();
    try {
      const entry = (await request(db.transaction(RESULT_STORE, "readonly").objectStore(RESULT_STORE).get(doc.id))) as
        | Entry
        | undefined;
      return entry && entry.key === geometryKey(doc) ? entry.model : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Keep the model computed for `doc`, and drop the entries of documents opened long ago. */
export async function storeCachedModel(doc: CadDocument, model: CachedModel): Promise<void> {
  try {
    const db = await openDb();
    try {
      const store = db.transaction(RESULT_STORE, "readwrite").objectStore(RESULT_STORE);
      const entry: Entry = { key: geometryKey(doc), savedAt: Date.now(), model };
      await request(store.put(entry, doc.id));
      const keys = (await request(store.getAllKeys())) as IDBValidKey[];
      if (keys.length > KEEP) {
        const entries = await Promise.all(
          keys.map(async (k) => ({ k, savedAt: ((await request(store.get(k))) as Entry | undefined)?.savedAt ?? 0 })),
        );
        entries.sort((a, b) => a.savedAt - b.savedAt);
        for (const e of entries.slice(0, entries.length - KEEP)) await request(store.delete(e.k));
      }
    } finally {
      db.close();
    }
  } catch {
    // Private browsing or a full disk: the cache is best effort.
  }
}
