/** Auto save in IndexedDB (projects with imported STEP data can exceed localStorage limits). */
const DB_NAME = "fabcad";
const STORE = "projects";
const KEY = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
  });
}

export async function storeAutosave(json: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(json, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Auto save failed"));
    });
    db.close();
  } catch {
    // Private browsing or a full disk: auto save is best effort.
  }
}

export async function loadAutosave(): Promise<string | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Auto save read failed"));
    });
    db.close();
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
