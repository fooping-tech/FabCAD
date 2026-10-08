/** Bump only when changes require renewed agreement. Editorial changes need no bump. */
export const TERMS_VERSION = "2026-10-08";
export const CONSENT_KEY = "fabcad.terms-consent";

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export function hasCurrentConsent(storage: ConsentStorage, version = TERMS_VERSION): boolean {
  try {
    const value: unknown = JSON.parse(storage.getItem(CONSENT_KEY) ?? "null");
    if (!value || typeof value !== "object") return false;
    const record = value as { version?: unknown; acceptedAt?: unknown };
    return record.version === version && typeof record.acceptedAt === "string" &&
      Number.isFinite(Date.parse(record.acceptedAt));
  } catch {
    return false;
  }
}

/** Storage may be blocked. Consent still applies to this visit, and is asked again next time. */
export function saveConsent(storage: ConsentStorage, now = new Date()): boolean {
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify({ version: TERMS_VERSION, acceptedAt: now.toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function readBrowserConsent(): boolean {
  try { return hasCurrentConsent(window.localStorage); } catch { return false; }
}

export function saveBrowserConsent(): boolean {
  try { return saveConsent(window.localStorage); } catch { return false; }
}
