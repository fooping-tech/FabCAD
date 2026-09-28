import { applySketchEdit, command } from "@fabcad/cad-document";
import type { Vec2 } from "@fabcad/geometry";
import {
  type EntityId,
  type Sketch,
  type SketchText,
  type SketchTextProps,
  addText,
  explodeText,
  removeTexts,
  updateText,
} from "@fabcad/sketch";
import { appState, toast } from "../app/appState";
import { currentScope, documentStore, editSketchSolved } from "../app/session";
import { type TextProblem, deriveSketchTexts } from "./derive";
import { defaultFont, fontName, loadFont, refreshTexts, typography } from "./typography";

/**
 * Commands of the Text tool. A text is written inside a transaction of the document store:
 * every change of the dialog is applied to the real sketch (so the viewport shows the real
 * outlines), and OK turns the whole edit into one undo step.
 */

let lastProps: Partial<SketchTextProps> = {};

const sketchOf = (sketchId: string): Sketch | null => {
  const f = documentStore.document.features[sketchId];
  return f?.type === "sketch" ? f.sketch : null;
};

export const textOf = (sketchId: string, textId: string): SketchText | null =>
  sketchOf(sketchId)?.texts?.[textId] ?? null;

const derived = (sketch: Sketch): Sketch =>
  deriveSketchTexts(sketch, currentScope(), typography).sketch;

/** Problems of one text as it is in the document right now. */
export function textProblems(sketchId: string, textId: string): TextProblem[] {
  const sketch = sketchOf(sketchId);
  if (!sketch) return [];
  return deriveSketchTexts(sketch, currentScope(), typography).problems.filter(
    (p) => p.textId === textId,
  );
}

function open(sketchId: string, textId: string, fresh: boolean): void {
  appState.set({
    dialog: { type: "text", sketchId, textId, fresh, picking: null },
    tool: "select",
    selection: [{ kind: "text", sketchId, textId }],
    hover: null,
    contextMenu: null,
    hint: "",
  });
}

/** Text tool: a click places a new text and opens the dialog. */
export function beginText(sketchId: string, at: Vec2 | EntityId): void {
  const sketch = sketchOf(sketchId);
  if (!sketch) return;
  const font = typography.listFonts().find((f) => f.id === lastProps.fontId) ?? defaultFont();
  const props: SketchTextProps = {
    text: "Text",
    height: "10 mm",
    letterSpacing: "0 mm",
    lineSpacing: "1.2",
    rotation: "0 deg",
    horizontalAlign: "left",
    verticalAlign: "baseline",
    direction: "horizontal",
    ...lastProps,
    fontId: font.id,
    fontName: font.family,
  };
  delete props.path;
  let id = "";
  documentStore.begin("Text");
  documentStore.update((doc) =>
    applySketchEdit(doc, sketchId, (s) => {
      const added = addText(s, at, props);
      id = added.id;
      return derived(added.sketch);
    }),
  );
  if (!id) {
    documentStore.cancel();
    return;
  }
  appState.set({ lastCommand: { kind: "tool", id: "text", label: "Text" } });
  open(sketchId, id, true);
  if (!typography.isLoaded(font.id)) void loadFont(font.id).then(() => rederive(sketchId));
}

export function editText(sketchId: string, textId: string): void {
  const text = textOf(sketchId, textId);
  if (!text) return;
  if (appState.get().activeSketchId !== sketchId) return;
  documentStore.begin("Edit Text");
  open(sketchId, textId, false);
  if (!typography.isLoaded(text.fontId)) void loadFont(text.fontId).then(() => rederive(sketchId));
}

function rederive(sketchId: string): void {
  if (appState.get().dialog?.type !== "text" || !documentStore.inTransaction) return;
  documentStore.update((doc) => applySketchEdit(doc, sketchId, derived));
}

const currentDialog = () => {
  const d = appState.get().dialog;
  return d?.type === "text" ? d : null;
};

/** Change the text being written. */
export function patchText(patch: Partial<SketchTextProps>): void {
  const dialog = currentDialog();
  if (!dialog || !documentStore.inTransaction) return;
  documentStore.update((doc) =>
    applySketchEdit(doc, dialog.sketchId, (s) => derived(updateText(s, dialog.textId, patch))),
  );
  const fontId = patch.fontId;
  if (fontId && !typography.isLoaded(fontId)) {
    void loadFont(fontId).then(() => rederive(dialog.sketchId));
  }
}

export function setTextFont(fontId: string): void {
  patchText({ fontId, fontName: fontName(fontId) });
}

export function pickTextPath(entityId: EntityId): void {
  const dialog = currentDialog();
  if (!dialog) return;
  const text = textOf(dialog.sketchId, dialog.textId);
  if (!text) return;
  patchText({
    path: {
      offset: "0 mm",
      start: "0 mm",
      flip: false,
      align: text.horizontalAlign,
      ...(text.path ?? {}),
      entityId,
    },
  });
  appState.set({ dialog: { ...dialog, picking: null }, hint: "" });
}

/** Why the text cannot be finished yet, or null. */
export function textDialogProblem(sketchId: string, textId: string): string | null {
  const text = textOf(sketchId, textId);
  if (!text) return "The text no longer exists.";
  if (text.text.trim() === "") return "Enter a text.";
  const problem = textProblems(sketchId, textId).find((p) => p.kind !== "layout" || !text.outline);
  if (problem) return problem.message;
  if (!text.outline || text.outline.loops.length === 0) return "The text has no outline.";
  return null;
}

export function commitText(): boolean {
  const dialog = currentDialog();
  if (!dialog) return false;
  const problem = textDialogProblem(dialog.sketchId, dialog.textId);
  if (problem) {
    toast(problem, "warning");
    return false;
  }
  const text = textOf(dialog.sketchId, dialog.textId);
  if (text) {
    const { text: _text, path: _path, fontName: _name, ...style } = text;
    const { id: _id, type: _type, origin: _origin, outline: _outline, ...rest } = style;
    lastProps = rest;
  }
  documentStore.commit();
  appState.set({ dialog: null, hint: "", selection: [] });
  refreshTexts();
  return true;
}

export function cancelText(): void {
  if (!currentDialog()) return;
  documentStore.cancel();
  appState.set({ dialog: null, hint: "", selection: [], hover: null });
}

/** Explode Text: the text becomes plain sketch curves. One undo step brings the text back. */
export function explodeTexts(sketchId: string, textIds: string[]): boolean {
  let created: EntityId[] = [];
  const ok = editSketchSolved(sketchId, "Explode Text", (sketch) => {
    let next = sketch;
    for (const id of textIds) {
      const result = explodeText(next, id);
      if (!result) continue;
      next = result.sketch;
      created = created.concat(result.created);
    }
    return next;
  });
  if (!ok) {
    toast("The text has no outline to explode.", "warning");
    return false;
  }
  appState.set({
    selection: created.map((entityId) => ({ kind: "entity", sketchId, entityId })),
    hover: null,
  });
  return true;
}

export function deleteTexts(sketchId: string, textIds: string[]): boolean {
  return documentStore.execute(
    command("Delete", (doc) => applySketchEdit(doc, sketchId, (s) => removeTexts(s, textIds))),
  );
}
