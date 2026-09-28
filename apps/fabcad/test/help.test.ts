import { FEATURE_LABELS } from "@fabcad/cad-document";
import { SKETCH_MODIFY_TOOLS } from "@fabcad/sketch";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP, hasHelp, helpFor, helpJaFor } from "../src/help/content";
import { HELP_JA } from "../src/help/content.ja";
import { CONSTRAINT_TOOLS } from "../src/sketch/constraintTools";
import { CREATE_TOOLS } from "../src/sketch/createTools";

const source = (path: string): string =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

/** Help ids used by the ribbon and the menus, as written in their source. */
function usedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/help="([^"]+)"/g)) ids.add(m[1]!);
  for (const m of text.matchAll(/help: \{ id: "([^"]+)"/g)) ids.add(m[1]!);
  return [...ids];
}

describe("in-app help", () => {
  it("has an entry for every Create tool of the sketch", () => {
    for (const t of CREATE_TOOLS) expect(hasHelp(`sketch.${t.id}`), t.id).toBe(true);
  });

  it("has an entry for every Modify tool of the sketch", () => {
    for (const t of SKETCH_MODIFY_TOOLS) expect(hasHelp(`sketch.modify.${t.id}`), t.id).toBe(true);
  });

  it("has an entry for every constraint", () => {
    for (const c of CONSTRAINT_TOOLS) expect(hasHelp(`constraint.${c.type}`), c.type).toBe(true);
  });

  it("has an entry for every feature that has a command", () => {
    // Feature types and the dialogs that make them; sketches and imports have commands of
    // their own.
    const dialogOf: Record<string, string> = {
      sketch: "pick-sketch-plane",
      boolean: "combine",
      import: "import-step",
    };
    for (const type of Object.keys(FEATURE_LABELS)) {
      const id = `solid.${dialogOf[type] ?? type}`;
      expect(hasHelp(id), id).toBe(true);
    }
  });

  it("has an entry for every help id the ribbon names", () => {
    const ids = usedIds(source("panels/Ribbon.tsx"));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(hasHelp(id), id).toBe(true);
  });

  it("says something in every entry", () => {
    for (const [id, entry] of Object.entries(HELP)) {
      expect(entry.title.trim(), id).not.toBe("");
      expect(entry.summary.trim().length, id).toBeGreaterThan(15);
      expect(entry.summary.length, `${id}: the summary is for the small menu`).toBeLessThan(140);
      expect(entry.what.length, id).toBeGreaterThan(0);
      for (const list of [entry.what, entry.when, entry.requires, entry.limitations, entry.examples]) {
        for (const text of list ?? []) expect(text.trim(), id).not.toBe("");
      }
      for (const p of entry.parameters ?? []) {
        expect(p.name.trim(), id).not.toBe("");
        expect(p.text.trim(), id).not.toBe("");
      }
    }
  });

  it("falls back to what is known about a tool without an entry", () => {
    const entry = helpFor("sketch.not-written-yet", {
      title: "New Tool",
      summary: "Does something new",
    });
    expect(entry.title).toBe("New Tool");
    expect(entry.summary).toBe("Does something new");
    expect(entry.what.join(" ")).toMatch(/not been written/);
    expect(helpFor("nothing-known").title).toBe("nothing-known");
  });

  it("has Japanese text for every entry, of the same shape as the English", () => {
    expect(Object.keys(HELP_JA).sort()).toEqual(Object.keys(HELP).sort());
    const japanese = /[\u3040-\u30ff\u4e00-\u9fff]/;
    for (const [id, en] of Object.entries(HELP)) {
      const ja = helpJaFor(id)!;
      // Names are written as they are on screen.
      expect(ja.title, id).toBe(en.title);
      expect(ja.shortcut, id).toBe(en.shortcut);
      expect(ja.summary, id).toMatch(japanese);
      expect(ja.summary.length, `${id}: the summary is for the small menu`).toBeLessThan(80);
      for (const field of ["what", "when", "requires", "limitations", "examples"] as const) {
        expect(ja[field]?.length, `${id}.${field}`).toBe(en[field]?.length);
        for (const text of ja[field] ?? []) expect(text, `${id}.${field}`).toMatch(japanese);
      }
      expect(ja.parameters?.map((p) => p.name), `${id}.parameters`).toEqual(
        en.parameters?.map((p) => p.name),
      );
      for (const p of ja.parameters ?? []) expect(p.text, `${id}.${p.name}`).toMatch(japanese);
    }
  });
});
