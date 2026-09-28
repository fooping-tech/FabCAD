import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makePlane } from "@fabcad/geometry";
import { type Scope, evaluateParameters, parameterScope } from "@fabcad/cad-document";
import {
  SketchBuilder,
  type Sketch,
  type SketchTextProps,
  addText,
  createSketch,
  detectProfiles,
  explodeText,
  hitTestText,
  profileRefOf,
  removeTexts,
  resolveProfileRefs,
  textBounds,
  updateText,
} from "@fabcad/sketch";
import { type Typography, createTypography } from "@fabcad/typography";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveSketchTexts } from "../src/text/derive";

const require = createRequire(import.meta.url);
const FONTS = fileURLToPath(new URL("../public/fonts/", import.meta.url));
const bytes = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
};

let typography: Typography;
const noScope: Scope = () => undefined;

const props = (text: string, patch: Partial<SketchTextProps> = {}): SketchTextProps => ({
  text,
  fontId: "zen",
  fontName: "Zen Kaku Gothic New",
  height: "10",
  letterSpacing: "0",
  lineSpacing: "1.2",
  rotation: "0",
  horizontalAlign: "left",
  verticalAlign: "baseline",
  direction: "horizontal",
  ...patch,
});

const base = (): Sketch => createSketch("s", "Sketch", { type: "origin", plane: "XY" });

function make(text: string, patch: Partial<SketchTextProps> = {}, scope: Scope = noScope) {
  const added = addText(base(), { x: 5, y: 7 }, props(text, patch));
  const derived = deriveSketchTexts(added.sketch, scope, typography);
  return { ...derived, id: added.id };
}

beforeAll(async () => {
  typography = createTypography({
    loadFontFile: async (file) => bytes(FONTS + file),
    loadHarfBuzzWasm: async () => bytes(require.resolve("harfbuzzjs/dist/harfbuzz.wasm")),
  });
  await typography.ensureFont("zen");
  await typography.ensureFont("shippori");
});

describe("sketch text", () => {
  it("keeps the text and derives outlines", () => {
    const { sketch, id, problems } = make("FabCAD");
    expect(problems).toEqual([]);
    const text = sketch.texts![id]!;
    expect(text.text).toBe("FabCAD");
    expect(text.outline!.loops.length).toBeGreaterThan(6);
    // No curve entities were made: the text is not converted.
    expect(Object.values(sketch.entities).map((e) => e.type)).toEqual(["point"]);
  });

  it("derives nothing twice", () => {
    const { sketch } = make("FabCAD");
    expect(deriveSketchTexts(sketch, noScope, typography).sketch).toBe(sketch);
  });

  it("makes regions with holes for letters with counters", () => {
    const { sketch, id } = make("A8");
    const regions = detectProfiles(sketch);
    expect(regions.length).toBe(2);
    expect(regions.every((r) => r.textId === id)).toBe(true);
    const [a, eight] = regions;
    expect(a!.profile.holes.length).toBe(1);
    expect(eight!.profile.holes.length).toBe(2);
    for (const r of regions) expect(r.area).toBeGreaterThan(1);
  });

  it("Japanese text: horizontal and vertical", () => {
    const h = make("日本語の文字");
    const v = make("日本語の文字", { direction: "vertical" });
    const bh = textBounds(h.sketch, h.sketch.texts![h.id]!)!;
    const bv = textBounds(v.sketch, v.sketch.texts![v.id]!)!;
    expect(bh.maxX - bh.minX).toBeGreaterThan(50);
    expect(bh.maxY - bh.minY).toBeLessThan(12);
    expect(bv.maxY - bv.minY).toBeGreaterThan(50);
    expect(bv.maxX - bv.minX).toBeLessThan(12);
    expect(detectProfiles(h.sketch).length).toBeGreaterThan(6);
  });

  it("follows its origin point and its angle without a new layout", () => {
    const { sketch, id } = make("Fab");
    const text = sketch.texts![id]!;
    const before = textBounds(sketch, text)!;
    const b = new SketchBuilder(sketch);
    b.movePoint(text.origin, { x: 105, y: 7 });
    const moved = b.build();
    const after = textBounds(moved, moved.texts![id]!)!;
    expect(after.minX - before.minX).toBeCloseTo(100);
    expect(deriveSketchTexts(moved, noScope, typography).sketch).toBe(moved);

    const turned = deriveSketchTexts(updateText(sketch, id, { rotation: "90" }), noScope, typography).sketch;
    expect(turned.texts![id]!.outline!.loops).toBe(text.outline!.loops);
    const tb = textBounds(turned, turned.texts![id]!)!;
    expect(tb.maxY - tb.minY).toBeCloseTo(before.maxX - before.minX, 6);
  });

  it("height is an expression of parameters", () => {
    const scope = (value: string): Scope =>
      parameterScope(
        evaluateParameters([{ id: "p", name: "size", expression: value, unit: "mm", comment: "" }]),
      );
    const small = make("H", { height: "size" }, scope("10"));
    const large = deriveSketchTexts(small.sketch, scope("20"), typography).sketch;
    const a = textBounds(small.sketch, small.sketch.texts![small.id]!)!;
    const b = textBounds(large, large.texts![small.id]!)!;
    expect((b.maxY - b.minY) / (a.maxY - a.minY)).toBeCloseTo(2, 5);
  });

  it("reports a bad expression and keeps the last outline", () => {
    const { sketch, id } = make("H");
    const broken = deriveSketchTexts(updateText(sketch, id, { height: "nope * 2" }), noScope, typography);
    expect(broken.problems[0]?.kind).toBe("expression");
    expect(broken.problems[0]?.message).toContain("Height");
    expect(broken.sketch.texts![id]!.outline).toBe(sketch.texts![id]!.outline);
  });

  it("reports a missing font and keeps the last outline", () => {
    const { sketch, id } = make("H");
    const other = updateText(sketch, id, { fontId: "user:0123456789abcdef", fontName: "My Font", text: "X" });
    const result = deriveSketchTexts(other, noScope, typography);
    expect(result.problems[0]?.kind).toBe("font-missing");
    expect(result.problems[0]?.message).toContain('"My Font"');
    expect(result.sketch.texts![id]!.outline).toBe(sketch.texts![id]!.outline);
    expect(detectProfiles(result.sketch).length).toBe(1);
  });

  it("a loaded project whose font is not there says so and keeps its outlines", () => {
    const { sketch, id } = make("H");
    const text = sketch.texts![id]!;
    // As saved with a font of the user: the outline is current, the font is unknown here.
    const saved: Sketch = {
      ...sketch,
      texts: { [id]: { ...text, fontId: "user:feedfacefeedface", fontName: "Club Font" } },
    };
    const key = deriveSketchTexts(saved, noScope, typography);
    expect(key.problems.map((p) => p.kind)).toEqual(["font-missing"]);
    expect(key.problems[0]!.message).toBe(
      'The font "Club Font" is not available. Load the font file to edit this text; until then it keeps its last outline.',
    );
    expect(key.sketch.texts![id]!.outline!.loops).toBe(text.outline!.loops);
  });

  it("changing the font changes the outline", () => {
    const { sketch, id } = make("永");
    const next = deriveSketchTexts(
      updateText(sketch, id, { fontId: "shippori", fontName: "Shippori Mincho" }),
      noScope,
      typography,
    ).sketch;
    expect(next.texts![id]!.outline!.key).not.toBe(sketch.texts![id]!.outline!.key);
    expect(next.texts![id]!.outline!.loops).not.toEqual(sketch.texts![id]!.outline!.loops);
  });

  it("text on a line, an arc and a circle", () => {
    const b = new SketchBuilder(base());
    const line = b.line({ x: 0, y: 0 }, { x: 0, y: 100 });
    const arc = b.arc({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 });
    const circle = b.circle({ x: 200, y: 0 }, 40);
    for (const [entityId, check] of [
      [line, (bb: { minX: number; maxX: number; minY: number; maxY: number }) => bb.maxY - bb.minY > bb.maxX - bb.minX],
      [arc, (bb: { minX: number; maxX: number; minY: number; maxY: number }) => bb.minX > 0 && bb.minY > -1],
      [circle, (bb: { minX: number; maxX: number; minY: number; maxY: number }) => bb.minX > 150],
    ] as const) {
      const added = addText(b.build(), { x: 0, y: 0 }, props("FabCAD path", {
        path: { entityId, offset: "1", start: "2", flip: false, align: "left" },
      }));
      const { sketch, problems } = deriveSketchTexts(added.sketch, noScope, typography);
      expect(problems).toEqual([]);
      const text = sketch.texts![added.id]!;
      expect(text.outline!.space).toBe("sketch");
      expect(check(textBounds(sketch, text)!)).toBe(true);
      expect(detectProfiles(sketch).filter((r) => r.textId === added.id).length).toBeGreaterThan(8);
    }
  });

  it("text on a path follows the path", () => {
    const b = new SketchBuilder(base());
    const line = b.line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const added = addText(b.build(), { x: 0, y: 0 }, props("Fab", {
      path: { entityId: line, offset: "0", start: "0", flip: false, align: "left" },
    }));
    const first = deriveSketchTexts(added.sketch, noScope, typography).sketch;
    const e = first.entities[line]!;
    if (e.type !== "line") throw new Error("line expected");
    const edit = new SketchBuilder(first);
    edit.movePoint(e.p1, { x: 0, y: 30 });
    edit.movePoint(e.p2, { x: 100, y: 30 });
    const second = deriveSketchTexts(edit.build(), noScope, typography).sketch;
    const a = textBounds(first, first.texts![added.id]!)!;
    const c = textBounds(second, second.texts![added.id]!)!;
    expect(c.minY - a.minY).toBeCloseTo(30, 5);
    // Deleting the path keeps the text.
    const gone = new SketchBuilder(second);
    gone.remove([line]);
    expect(gone.build().texts![added.id]!.path).toBeUndefined();
  });

  it("a text reference stands for the whole text, also after the text changed", () => {
    const { sketch, id } = make("AB");
    const regions = detectProfiles(sketch);
    const ref = profileRefOf(regions[0]!);
    expect(ref.textId).toBe(id);
    expect(resolveProfileRefs(regions, ref).length).toBe(2);
    const edited = deriveSketchTexts(updateText(sketch, id, { text: "ABCD" }), noScope, typography).sketch;
    expect(resolveProfileRefs(detectProfiles(edited), ref).length).toBe(4);
  });

  it("explode replaces the text by curves with the same regions", () => {
    const { sketch, id } = make("A8日");
    const before = detectProfiles(sketch);
    const exploded = explodeText(sketch, id)!;
    expect(exploded.sketch.texts![id]).toBeUndefined();
    expect(exploded.created.length).toBeGreaterThan(10);
    const after = detectProfiles(exploded.sketch);
    expect(after.every((r) => r.textId === undefined)).toBe(true);
    const total = (rs: { area: number }[]): number => rs.reduce((s, r) => s + r.area, 0);
    // The counters (1 + 2 + 2) are regions of their own once the text is plain curves.
    expect(after.length).toBe(before.length + 5);
    const ink = after.filter((r) => r.profile.holes.length > 0);
    expect(ink.length).toBe(before.length);
    expect(total(ink)).toBeCloseTo(total(before), 3);
  });

  it("picks a text by its box and removes it with its origin", () => {
    const { sketch, id } = make("Fab");
    expect(hitTestText(sketch, { x: 12, y: 10 }, 0.5)?.id).toBe(id);
    expect(hitTestText(sketch, { x: 200, y: 10 }, 0.5)).toBeNull();
    const removed = removeTexts(sketch, [id]);
    expect(Object.keys(removed.texts ?? {})).toEqual([]);
    expect(Object.keys(removed.entities)).toEqual([]);
  });

  it("survives saving and loading", () => {
    const { sketch, id } = make("保存");
    const loaded = JSON.parse(JSON.stringify(sketch)) as Sketch;
    expect(loaded.texts![id]!.text).toBe("保存");
    expect(deriveSketchTexts(loaded, noScope, typography).sketch).toBe(loaded);
    expect(detectProfiles(loaded).length).toBe(detectProfiles(sketch).length);
  });
});

describe("text and parameters", () => {
  it("is part of the dependency graph and follows a renamed parameter", async () => {
    const cad = await import("@fabcad/cad-document");
    const store = new cad.DocumentStore(cad.createDocument("Text"));
    store.execute(cad.addParameter({ name: "size", expression: "10", unit: "mm", comment: "" }));
    const sketch: { id?: string } = {};
    store.execute(cad.addSketch({ type: "origin", plane: "XY" }, sketch));
    let textId = "";
    store.execute(
      cad.command("text", (doc) =>
        cad.applySketchEdit(doc, sketch.id!, (s) => {
          const added = addText(s, { x: 0, y: 0 }, props("H", { height: "size * 2" }));
          textId = added.id;
          return added.sketch;
        }),
      ),
    );
    const graph = cad.buildDependencyGraph(store.document);
    expect([...(graph.dependents.get(cad.paramNode("size")) ?? [])].join()).toContain(sketch.id!);
    const id = store.document.parameters[0]!.id;
    store.execute(cad.renameParameter(id, "letter"));
    const f = store.document.features[sketch.id!] as { sketch: Sketch };
    expect(f.sketch.texts![textId]!.height).toBe("letter * 2");
  });
});

describe("text in features", () => {
  it("extrudes a text, cuts it into a plate and follows when the text changes", async () => {
    const { nodeKernel } = await import("../../../packages/brep/test/nodeKernel");
    const { FeatureEngine } = await import("@fabcad/features");
    const { DocumentStore, addExtrude, addSketch, applySketchEdit, createDocument, command } =
      await import("@fabcad/cad-document");
    const { createDefaultSolver } = await import("@fabcad/sketch-solver");
    const kernel = await nodeKernel();
    const engine = new FeatureEngine(kernel, createDefaultSolver());
    const store = new DocumentStore(createDocument("Text"));

    const plate: { id?: string } = {};
    store.execute(addSketch({ type: "origin", plane: "XY" }, plate));
    store.execute(
      command("rect", (doc) =>
        applySketchEdit(doc, plate.id!, (s) => {
          const b = new SketchBuilder(s);
          const p = [b.point(-5, -5), b.point(60, -5), b.point(60, 20), b.point(-5, 20)];
          for (let i = 0; i < 4; i++) b.line(p[i]!, p[(i + 1) % 4]!);
          return b.build();
        }),
      ),
    );
    const plateSketch = (store.document.features[plate.id!] as { sketch: Sketch }).sketch;
    const body: { id?: string; bodyId?: string } = {};
    store.execute(
      addExtrude(
        {
          sketchId: plate.id!,
          profiles: [profileRefOf(detectProfiles(plateSketch)[0]!)],
          distance: "3",
          direction: "positive",
          operation: "new",
          targetBodyIds: [],
        },
        body,
      ),
    );

    const label: { id?: string } = {};
    store.execute(addSketch({ type: "custom", plane: makePlane({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }) }, label));
    let textId = "";
    store.execute(
      command("text", (doc) =>
        applySketchEdit(doc, label.id!, (s) => {
          const added = addText(s, { x: 0, y: 0 }, props("AB8"));
          textId = added.id;
          return deriveSketchTexts(added.sketch, noScope, typography).sketch;
        }),
      ),
    );
    const sketchOf = (): Sketch => (store.document.features[label.id!] as { sketch: Sketch }).sketch;
    const ink = (): number => detectProfiles(sketchOf()).reduce((sum, r) => sum + r.area, 0);
    const ref = profileRefOf(detectProfiles(sketchOf())[0]!);
    expect(ref.textId).toBe(textId);

    // Emboss: a new body from the whole text.
    const emboss: { id?: string; bodyId?: string } = {};
    store.execute(
      addExtrude(
        { sketchId: label.id!, profiles: [ref], distance: "2", direction: "positive", operation: "new", targetBodyIds: [] },
        emboss,
      ),
    );
    let result = await engine.recompute(store.document);
    const volumeOf = (id: string): number => result.bodies.find((b) => b.id === id)!.geometry!.volume;
    expect(result.features[emboss.id!]?.message).toBeUndefined();
    expect(result.features[emboss.id!]).toMatchObject({ state: "ok" });
    expect(volumeOf(emboss.bodyId!)).toBeCloseTo(ink() * 2, 1);
    const names = result.bodies.find((b) => b.id === emboss.bodyId)!.names!;
    expect(names.faces.some((f) => f.entity === textId && f.role === "side")).toBe(true);

    // Engrave: cut the text 1 mm into the plate.
    const engrave: { id?: string } = {};
    store.execute(
      addExtrude(
        { sketchId: label.id!, profiles: [ref], distance: "1", direction: "negative", operation: "cut", targetBodyIds: [body.bodyId!] },
        engrave,
      ),
    );
    result = await engine.recompute(store.document);
    expect(result.features[engrave.id!]).toMatchObject({ state: "ok" });
    const full = 65 * 25 * 3;
    expect(volumeOf(body.bodyId!)).toBeCloseTo(full - ink(), 1);

    // The text changes: both features follow, nothing else was touched.
    const before = ink();
    store.execute(
      command("edit", (doc) =>
        applySketchEdit(doc, label.id!, (s) =>
          deriveSketchTexts(updateText(s, textId, { text: "AB80" }), noScope, typography).sketch,
        ),
      ),
    );
    expect(ink()).toBeGreaterThan(before);
    result = await engine.recompute(store.document);
    expect(result.features[emboss.id!]?.message).toBeUndefined();
    expect(result.features[emboss.id!]).toMatchObject({ state: "ok" });
    expect(volumeOf(emboss.bodyId!)).toBeCloseTo(ink() * 2, 1);
    expect(volumeOf(body.bodyId!)).toBeCloseTo(full - ink(), 1);

    // Undo brings the old text and the old solids back.
    store.undo();
    result = await engine.recompute(store.document);
    expect(volumeOf(emboss.bodyId!)).toBeCloseTo(before * 2, 1);
  }, 60000);
});
