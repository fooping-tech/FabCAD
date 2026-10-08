/** Browser-local recovery journal. Project data never leaves the device. */
const DB_NAME = "fabcad";
const STORE = "projects";
const KEY = "autosave";
const HISTORY_STORE = "autosave-history";
const KEEP = 5;
export const RESULT_STORE = "results";

export interface AutosaveEntry {
  token: string;
  json: string;
  checksum: string;
  savedAt: number;
}

export interface AutosaveLoad {
  json: string | null;
  /** The actual head token, including when the head is damaged. */
  token: string | null;
  recovered: boolean;
}

export class AutosaveConflictError extends Error {
  constructor() {
    super("Another FabCAD tab changed this browser's recovery data. Export your project before continuing.");
    this.name = "AutosaveConflictError";
  }
}

/** A lightweight corruption check, not a security signature. */
export function autosaveChecksum(json: string): string {
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function valid(entry: unknown): entry is AutosaveEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<AutosaveEntry>;
  if (typeof e.json !== "string" || typeof e.token !== "string" || typeof e.savedAt !== "number" ||
      e.checksum !== autosaveChecksum(e.json)) return false;
  try {
    const data: unknown = JSON.parse(e.json);
    return typeof data === "object" && data !== null;
  } catch {
    return false;
  }
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(RESULT_STORE)) db.createObjectStore(RESULT_STORE);
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
    // `onblocked` is not a failure: the open goes on once the other tab closes its connection
    // (every connection here is short-lived).
  });
}

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

export async function loadRecoverySnapshots(): Promise<AutosaveEntry[]> {
  const db = await openDb();
  try {
    const entries = await read(db.transaction(HISTORY_STORE, "readonly").objectStore(HISTORY_STORE).getAll()) as unknown[];
    return entries.filter(valid).sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

const headToken = (head: unknown): string | null =>
  head && typeof head === "object" && typeof (head as AutosaveEntry).token === "string"
    ? (head as AutosaveEntry).token
    : null;

/** The token of the autosave kept now, to take over from another tab (see `AutosaveConflictError`). */
export async function currentAutosaveToken(): Promise<string | null> {
  const db = await openDb();
  try {
    return headToken(await read(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)));
  } finally {
    db.close();
  }
}

export async function loadAutosave(): Promise<AutosaveLoad> {
  const db = await openDb();
  try {
    const head: unknown = await read(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
    if (typeof head === "string") return { json: head, token: null, recovered: false }; // v2 migration
    const token = headToken(head);
    if (valid(head)) return { json: head.json, token, recovered: false };
    const backups = await read(db.transaction(HISTORY_STORE, "readonly").objectStore(HISTORY_STORE).getAll()) as unknown[];
    const previous = backups.filter(valid).sort((a, b) => b.savedAt - a.savedAt)[0];
    return { json: previous?.json ?? null, token, recovered: !!previous };
  } finally {
    db.close();
  }
}

async function writeAutosave(json: string, expectedToken: string | null): Promise<string> {
  const db = await openDb();
  try {
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction([STORE, HISTORY_STORE], "readwrite");
      const projects = tx.objectStore(STORE);
      const history = tx.objectStore(HISTORY_STORE);
      const token = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      const entry: AutosaveEntry = { token, json, checksum: autosaveChecksum(json), savedAt: Date.now() };
      let failure: Error | null = null;
      tx.oncomplete = () => resolve(token);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error("Auto save transaction aborted"));
      tx.onerror = () => { /* onabort reports the failure */ };
      const get = projects.get(KEY);
      get.onsuccess = () => {
        if (headToken(get.result) !== expectedToken) {
          failure = new AutosaveConflictError();
          tx.abort();
          return;
        }
        projects.put(entry, KEY);
        history.put(entry, token);
        const all = history.getAll();
        all.onsuccess = () => {
          const snapshots = (all.result as AutosaveEntry[]).sort((a, b) => b.savedAt - a.savedAt);
          for (const old of snapshots.slice(KEEP)) history.delete(old.token);
        };
      };
    });
  } finally {
    db.close();
  }
}

function clearStore(name: string): Promise<void> {
  return openDb().then(async (db) => {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, "readwrite");
        tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error(`Could not clear ${name}`));
      });
    } finally {
      db.close();
    }
  });
}

const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "QuotaExceededError";

/**
 * When storage is full, the disposable geometry cache goes first, then the older recovery
 * snapshots: the newest version of the project is what must be kept.
 */
export async function storeAutosave(json: string, expectedToken: string | null): Promise<string> {
  try {
    return await writeAutosave(json, expectedToken);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  await clearStore(RESULT_STORE);
  try {
    return await writeAutosave(json, expectedToken);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }
  await clearStore(HISTORY_STORE);
  return writeAutosave(json, expectedToken);
}
