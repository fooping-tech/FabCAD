import { describe, expect, it } from "vitest";
import { CONSENT_KEY, TERMS_VERSION, hasCurrentConsent, saveConsent } from "../src/legal/consent";

function storage(initial: string | null = null) {
  const records = new Map<string, string>();
  if (initial !== null) records.set(CONSENT_KEY, initial);
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
  };
}

describe("local agreement", () => {
  it("requires first agreement and persists its version and date", () => {
    const local = storage();
    expect(hasCurrentConsent(local)).toBe(false);
    expect(saveConsent(local, new Date("2026-10-08T10:00:00Z"))).toBe(true);
    expect(JSON.parse(local.getItem(CONSENT_KEY)!)).toEqual({ version: TERMS_VERSION, acceptedAt: "2026-10-08T10:00:00.000Z" });
    expect(hasCurrentConsent(local)).toBe(true);
    expect(hasCurrentConsent(local, "next-version")).toBe(false);
  });

  it.each(["{", "null", "true", '"yes"', '{"version":"2026-10-08"}', '{"version":"2026-10-08","acceptedAt":"invalid"}'])("rejects malformed agreement %s", (value) => {
    expect(hasCurrentConsent(storage(value))).toBe(false);
  });

  it("handles blocked browser storage", () => {
    const blocked = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); } };
    expect(hasCurrentConsent(blocked)).toBe(false);
    expect(saveConsent(blocked)).toBe(false);
  });
});
