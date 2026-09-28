import type { CadDocument } from "@fabcad/cad-document";
import {
  DEFAULT_FONT_ID,
  type FontInfo,
  type Typography,
  createTypography,
} from "@fabcad/typography";
import hbWasmUrl from "harfbuzzjs/dist/harfbuzz.wasm?url";
import { toast } from "../app/appState";
import { currentScope, documentStore, pickFile } from "../app/session";
import { TinyStore } from "../app/tinyStore";
import { type TextProblem, deriveSketchTexts } from "./derive";

/**
 * Fonts of the session. Bundled fonts are fetched when a text first uses them; fonts loaded
 * by the user stay in the memory of this page. They are never uploaded and never written into
 * the project: the project stores the id and the name of the font, and the outlines of what
 * was written with it.
 */

export const typography: Typography = createTypography({
  loadFontFile: async (file) => {
    const r = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
    if (!r.ok) throw new Error(`The font file ${file} could not be loaded (HTTP ${r.status}).`);
    return r.arrayBuffer();
  },
  loadHarfBuzzWasm: async () => {
    const r = await fetch(hbWasmUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  },
});

export interface TextState {
  fonts: FontInfo[];
  /** Fonts being loaded. */
  loading: string[];
  /** Problems of the texts, by sketch id. */
  problems: Record<string, TextProblem[]>;
}

export const textState = new TinyStore<TextState>({
  fonts: typography.listFonts(),
  loading: [],
  problems: {},
});

export const defaultFont = (): FontInfo =>
  typography.listFonts().find((f) => f.id === DEFAULT_FONT_ID) ?? typography.listFonts()[0]!;

export const fontName = (id: string): string =>
  typography.listFonts().find((f) => f.id === id)?.family ?? id;

const failed = new Set<string>();

/** Load a font; texts that wait for it are derived when it is there. */
export async function loadFont(fontId: string): Promise<boolean> {
  if (typography.isLoaded(fontId)) return true;
  textState.set((s) => (s.loading.includes(fontId) ? s : { loading: [...s.loading, fontId] }));
  try {
    await typography.ensureFont(fontId);
    failed.delete(fontId);
    return true;
  } catch (err) {
    if (!failed.has(fontId)) {
      toast(err instanceof Error ? err.message : String(err), "error", 7000);
    }
    failed.add(fontId);
    return false;
  } finally {
    textState.set((s) => ({ loading: s.loading.filter((f) => f !== fontId) }));
    refreshTexts();
  }
}

/** Let the user pick a font file. It is read in the browser and goes nowhere else. */
export async function pickUserFont(): Promise<FontInfo | null> {
  const file = await pickFile(".ttf,.otf,.woff,font/ttf,font/otf,font/woff");
  if (!file) return null;
  try {
    const info = typography.registerUserFont(file.name, await file.arrayBuffer());
    await typography.ensureFont(info.id);
    textState.set({ fonts: typography.listFonts() });
    refreshTexts();
    toast(`Loaded the font "${info.family}". It stays on this computer.`);
    return info;
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error", 7000);
    return null;
  }
}

function sameProblems(a: Record<string, TextProblem[]>, b: Record<string, TextProblem[]>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Derive the outlines of the texts of a document. Returns the same document when nothing changed. */
export function deriveDocumentTexts(doc: CadDocument): {
  doc: CadDocument;
  problems: Record<string, TextProblem[]>;
  pendingFonts: string[];
} {
  const scope = currentScope(doc);
  const problems: Record<string, TextProblem[]> = {};
  const pending = new Set<string>();
  let features = doc.features;
  for (const f of Object.values(doc.features)) {
    if (f.type !== "sketch" || !f.sketch.texts) continue;
    const result = deriveSketchTexts(f.sketch, scope, typography);
    if (result.problems.length > 0) problems[f.id] = result.problems;
    for (const font of result.pendingFonts) pending.add(font);
    if (result.sketch === f.sketch) continue;
    if (features === doc.features) features = { ...doc.features };
    features[f.id] = { ...f, sketch: result.sketch };
  }
  return {
    doc: features === doc.features ? doc : { ...doc, features },
    problems,
    pendingFonts: [...pending],
  };
}

let refreshing = false;
let reported = new Set<string>();

/**
 * Bring the outlines of all texts up to date. Derived data is not a user edit: the document
 * is amended, the history is not touched.
 */
export function refreshTexts(): void {
  if (refreshing || documentStore.inTransaction) return;
  refreshing = true;
  try {
    const result = deriveDocumentTexts(documentStore.document);
    if (result.doc !== documentStore.document) documentStore.amend(() => result.doc);
    if (!sameProblems(textState.get().problems, result.problems)) {
      textState.set({ problems: result.problems });
    }
    // A missing font is said once per font, not on every change of the document.
    const missing = new Set<string>();
    for (const list of Object.values(result.problems)) {
      for (const p of list) {
        if (p.kind !== "font-missing") continue;
        missing.add(p.message);
        if (!reported.has(p.message)) toast(p.message, "warning", 9000);
      }
    }
    reported = missing;
    for (const font of result.pendingFonts) {
      if (!failed.has(font) && !textState.get().loading.includes(font)) void loadFont(font);
    }
  } finally {
    refreshing = false;
  }
}

let installed = false;

export function startTextMaintenance(): void {
  if (installed) return;
  installed = true;
  documentStore.subscribe(() => refreshTexts());
  refreshTexts();
}
