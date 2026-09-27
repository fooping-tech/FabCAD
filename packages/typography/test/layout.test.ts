import { type Bounds2, pointInPolygon } from "@fabcad/geometry";
import { beforeAll, describe, expect, test } from "vitest";
import { BUNDLED_FONTS, type TextLayout, type TextLayoutRequest, TypographyError } from "../src/index";
import { contoursFromCommands, placeContours } from "../src/outline";
import { type TestTypography, endOf, loopArea, loopPolygon, loopProblems, makeTypography, startOf } from "./helpers";

let t: TestTypography;

beforeAll(async () => {
  t = makeTypography();
  for (const f of BUNDLED_FONTS) await t.ensureFont(f.id);
});

const lay = (text: string, extra: Partial<TextLayoutRequest> = {}): TextLayout =>
  t.layout({ text, fontId: "zen", height: 10, ...extra });

const box = (layout: TextLayout): Bounds2 => {
  expect(layout.bounds).not.toBeNull();
  return layout.bounds!;
};
const width = (b: Bounds2): number => b.maxX - b.minX;
const height = (b: Bounds2): number => b.maxY - b.minY;

describe("horizontal text", () => {
  test('"FabCAD 123": one glyph per character, the space advances without loops', () => {
    const layout = lay("FabCAD 123");
    expect(layout.glyphs).toHaveLength(10);
    expect(layout.glyphs.map((g) => g.text).join("")).toBe("FabCAD 123");
    expect(layout.glyphs.map((g) => g.cluster)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(layout.lineCount).toBe(1);
    expect(layout.missing).toEqual([]);
    const space = layout.glyphs[6]!;
    expect(space.loops).toEqual([]);
    expect(space.advance).toBeGreaterThan(1);
    // F a b C A D 1 2 3: a, b, A, D have one counter each.
    expect(layout.loops).toHaveLength(9 + 4);
    expect(layout.loops).toEqual(layout.glyphs.flatMap((g) => g.loops));
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
    // Left / baseline: the pen starts at the origin and moves to the right.
    expect(layout.glyphs[0]!.origin).toEqual({ x: 0, y: 0 });
    layout.glyphs.forEach((g, i) => {
      expect(g.rotation).toBe(0);
      expect(g.origin.y).toBe(0);
      if (i > 0) expect(g.origin.x).toBeGreaterThan(layout.glyphs[i - 1]!.origin.x);
    });
    const b = box(layout);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minX).toBeLessThan(2);
    expect(b.minY).toBeGreaterThan(-1);
    expect(b.minY).toBeLessThanOrEqual(0);
    expect(b.maxY).toBeGreaterThan(6.5);
    expect(b.maxY).toBeLessThan(10);
  });

  test("the bounding box is tight around the curves", () => {
    const layout = lay("O");
    const b = box(layout);
    const pts = layout.loops.flatMap((l) => loopPolygon(l, 1e-4));
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(b.minX, 3);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(b.maxX, 3);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(b.minY, 3);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(b.maxY, 3);
  });

  test("height scales the outlines linearly", () => {
    const a = lay("FabCAD 123", { height: 10 });
    const b = lay("FabCAD 123", { height: 25 });
    const ba = box(a);
    const bb = box(b);
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) expect(bb[key]).toBeCloseTo(ba[key] * 2.5, 9);
    expect(b.glyphs[3]!.advance).toBeCloseTo(a.glyphs[3]!.advance * 2.5, 9);
    expect(b.loops.length).toBe(a.loops.length);
    // The em square is `height`: a full-width kanji advances by exactly the height.
    expect(lay("設", { height: 7 }).glyphs[0]!.advance).toBeCloseTo(7, 9);
  });

  test("spacing widens the text by (n - 1) × spacing and may be negative", () => {
    const base = width(box(lay("FabCAD 123")));
    expect(width(box(lay("FabCAD 123", { spacing: 1 })))).toBeCloseTo(base + 9, 9);
    expect(width(box(lay("FabCAD 123", { spacing: 2.5 })))).toBeCloseTo(base + 22.5, 9);
    expect(width(box(lay("FabCAD 123", { spacing: -0.5 })))).toBeCloseTo(base - 4.5, 9);
    // The advance of a glyph does not include the spacing.
    expect(lay("ab", { spacing: 3 }).glyphs[0]!.advance).toBe(lay("ab").glyphs[0]!.advance);
  });

  test("stretch scales X only", () => {
    const a = lay("FabCAD");
    const b = lay("FabCAD", { stretch: 150 });
    const c = lay("FabCAD", { stretch: 50 });
    expect(box(b).minX).toBeCloseTo(box(a).minX * 1.5, 9);
    expect(box(b).maxX).toBeCloseTo(box(a).maxX * 1.5, 9);
    expect(box(c).maxX).toBeCloseTo(box(a).maxX * 0.5, 9);
    expect(box(b).minY).toBe(box(a).minY);
    expect(box(b).maxY).toBe(box(a).maxY);
    expect(b.glyphs[2]!.advance).toBeCloseTo(a.glyphs[2]!.advance * 1.5, 9);
    expect(b.loops.flatMap(loopProblems)).toEqual([]);
    expect(lay("FabCAD", { stretch: 100 })).toEqual(a);
  });

  test("kerning comes from the shaper", () => {
    const plain = lay("AA").glyphs[0]!.advance;
    expect(lay("AV").glyphs[0]!.advance).toBeLessThan(plain);
  });

  test("changing the font changes the outlines", () => {
    const seen = new Set<string>();
    for (const f of BUNDLED_FONTS) {
      const layout = lay("Fab設計", { fontId: f.id });
      expect(layout.glyphs).toHaveLength(5);
      seen.add(JSON.stringify(layout.loops));
    }
    expect(seen.size).toBe(BUNDLED_FONTS.length);
  });

  test("layout is deterministic and does not depend on what was laid out before", () => {
    const a = lay(JAPANESE_SAMPLE, { spacing: 0.3, stretch: 90 });
    lay("別の文字列", { vertical: true });
    const b = lay(JAPANESE_SAMPLE, { spacing: 0.3, stretch: 90 });
    expect(b).toEqual(a);
    const other = makeTypography();
    return other.ensureFont("zen").then(() => {
      expect(other.layout({ text: JAPANESE_SAMPLE, fontId: "zen", height: 10, spacing: 0.3, stretch: 90 })).toEqual(a);
    });
  });

  test("empty and whitespace-only text", () => {
    expect(lay("")).toEqual({ glyphs: [], loops: [], bounds: null, missing: [], lineCount: 0 });
    const spaces = lay("  　");
    expect(spaces.loops).toEqual([]);
    expect(spaces.bounds).toBeNull();
    expect(spaces.missing).toEqual([]);
    expect(spaces.glyphs).toHaveLength(3);
    expect(spaces.glyphs.every((g) => g.advance > 0 && g.loops.length === 0)).toBe(true);
    const lines = lay("\n\n");
    expect(lines.lineCount).toBe(3);
    expect(lines.bounds).toBeNull();
    // Leading spaces move the following glyph.
    expect(lay("  a").glyphs[2]!.origin.x).toBeCloseTo(2 * lay(" ").glyphs[0]!.advance, 9);
  });

  test("characters without a glyph are reported and leave no outline", () => {
    const layout = lay("a😀b한😀");
    expect(layout.missing).toEqual(["😀", "한"]);
    expect(layout.glyphs.map((g) => g.text)).toEqual(["a", "😀", "b", "한", "😀"]);
    expect(layout.glyphs.map((g) => g.cluster)).toEqual([0, 1, 3, 4, 5]);
    expect(layout.glyphs[1]!.glyphId).toBe(0);
    expect(layout.glyphs[1]!.loops).toEqual([]);
    expect(layout.glyphs[1]!.advance).toBeGreaterThan(0);
    expect(layout.loops).toEqual([...layout.glyphs[0]!.loops, ...layout.glyphs[2]!.loops]);
    expect(lay("abc").missing).toEqual([]);
  });

  test("invalid numbers are rejected", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => lay("a", { height: bad })).toThrow(TypographyError);
    }
    expect(() => lay("a", { stretch: 0 })).toThrow(TypographyError);
    expect(() => lay("a", { spacing: NaN })).toThrow(TypographyError);
  });
});

const JAPANESE_SAMPLE = "設計から、切れるデータまで。";

describe("loops as CAD profiles", () => {
  test("every loop of every bundled font is closed, in all modes", () => {
    const text = "FabCAD 123 gQ@&%\n" + JAPANESE_SAMPLE + "「口」ー";
    for (const f of BUNDLED_FONTS) {
      for (const extra of [{}, { vertical: true }, { stretch: 70, spacing: -0.2, height: 3.7 }]) {
        const layout = lay(text, { fontId: f.id, ...extra });
        expect(layout.loops.length, f.id).toBeGreaterThan(50);
        expect(layout.loops.flatMap(loopProblems), f.id).toEqual([]);
        for (const loop of layout.loops) {
          const first = startOf(loop[0]!);
          const last = endOf(loop[loop.length - 1]!);
          expect(last.x).toBe(first.x);
          expect(last.y).toBe(first.y);
          expect(Math.abs(loopArea(loop)), f.id).toBeGreaterThan(0);
        }
      }
    }
  });

  test("outer contours and holes have opposite orientation", () => {
    for (const f of BUNDLED_FONTS) {
      for (const ch of ["O", "口"]) {
        const loops = lay(ch, { fontId: f.id, height: 20 }).loops;
        expect(loops, `${f.id} ${ch}`).toHaveLength(2);
        const [a, b] = [loopArea(loops[0]!), loopArea(loops[1]!)];
        expect(a * b, `${f.id} ${ch}`).toBeLessThan(0);
        // The smaller loop lies inside the larger one.
        const [outer, hole] = Math.abs(a) > Math.abs(b) ? [loops[0]!, loops[1]!] : [loops[1]!, loops[0]!];
        const polygon = loopPolygon(outer);
        expect(loopPolygon(hole).every((p) => pointInPolygon(p, polygon))).toBe(true);
      }
    }
  });

  test("orientation is the one stored in the font and is the same for every glyph of a font", () => {
    for (const f of BUNDLED_FONTS) {
      const signs = [..."OD口回"].map((ch) => {
        const loops = lay(ch, { fontId: f.id }).loops;
        const outer = loops.reduce((m, l) => (Math.abs(loopArea(l)) > Math.abs(loopArea(m)) ? l : m));
        return Math.sign(loopArea(outer));
      });
      expect(new Set(signs).size, f.id).toBe(1);
    }
  });

  test("quadratic curves are raised to cubics exactly", () => {
    const [contour] = contoursFromCommands([
      { type: "M", x: 0, y: 0 },
      { type: "Q", x1: 300, y1: 600, x: 600, y: 0 },
      { type: "Z" },
    ]);
    const [loop] = placeContours([contour!], { scaleX: 1, scaleY: 1, cos: 1, sin: 0, origin: { x: 0, y: 0 } });
    expect(loop).toHaveLength(2);
    const curve = loop![0]!;
    expect(curve.type).toBe("bezier");
    if (curve.type !== "bezier") return;
    expect(curve.p1).toEqual({ x: 200, y: 400 });
    expect(curve.p2).toEqual({ x: 400, y: 400 });
    // Same point as the quadratic at t = 0.5: (300, 300).
    const mid = {
      x: (curve.p0.x + 3 * curve.p1.x + 3 * curve.p2.x + curve.p3.x) / 8,
      y: (curve.p0.y + 3 * curve.p1.y + 3 * curve.p2.y + curve.p3.y) / 8,
    };
    expect(mid).toEqual({ x: 300, y: 300 });
    expect(loop![1]).toEqual({ type: "line", a: { x: 600, y: 0 }, b: { x: 0, y: 0 } });
  });

  test("degenerate font data is cleaned up", () => {
    const contours = contoursFromCommands([
      // Open triangle with a repeated point: closed with a line, the repeat is dropped.
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 0 },
      { type: "L", x: 100, y: 0 },
      { type: "L", x: 100, y: 100 },
      // Square that returns to the start explicitly.
      { type: "M", x: 200, y: 0 },
      { type: "L", x: 300, y: 0 },
      { type: "L", x: 300, y: 100 },
      { type: "L", x: 200, y: 100 },
      { type: "L", x: 200, y: 0 },
      { type: "Z" },
      // Nearly closed: snapped onto the start.
      { type: "M", x: 400, y: 0 },
      { type: "L", x: 500, y: 0 },
      { type: "L", x: 500, y: 100 },
      { type: "L", x: 400.0000004, y: 0.0000003 },
      { type: "Z" },
      // No area: a single point and a line there and back.
      { type: "M", x: 600, y: 0 },
      { type: "Z" },
      { type: "M", x: 700, y: 0 },
      { type: "L", x: 800, y: 0 },
      { type: "Z" },
    ]);
    expect(contours.map((c) => c.segments.length)).toEqual([3, 4, 3]);
    const loops = placeContours(contours, { scaleX: 0.013, scaleY: 0.013, cos: Math.cos(0.7), sin: Math.sin(0.7), origin: { x: 3.3, y: -1.1 } });
    expect(loops.flatMap(loopProblems)).toEqual([]);
    expect(loops.map((l) => l.length)).toEqual([3, 4, 3]);
  });
});

describe("alignment", () => {
  test("left / center / right shift the text by its advance width", () => {
    const left = lay("FabCAD 123", { horizontalAlign: "left" });
    const center = lay("FabCAD 123", { horizontalAlign: "center" });
    const right = lay("FabCAD 123", { horizontalAlign: "right" });
    const last = left.glyphs[9]!;
    const advanceWidth = last.origin.x + last.advance;
    expect(box(center).minX).toBeCloseTo(box(left).minX - advanceWidth / 2, 9);
    expect(box(right).minX).toBeCloseTo(box(left).minX - advanceWidth, 9);
    expect(width(box(center))).toBeCloseTo(width(box(left)), 9);
    expect(box(left).minX).toBeGreaterThanOrEqual(0);
    expect(box(right).maxX).toBeLessThanOrEqual(0);
    expect(box(center).minX + box(center).maxX).toBeCloseTo(0, 0);
    expect(box(center).minY).toBe(box(left).minY);
    expect(right.glyphs[9]!.origin.x + right.glyphs[9]!.advance).toBeCloseTo(0, 9);
    // Trailing letter spacing is not part of the width.
    const spaced = lay("FabCAD 123", { horizontalAlign: "right", spacing: 2 });
    expect(spaced.glyphs[9]!.origin.x + spaced.glyphs[9]!.advance).toBeCloseTo(0, 9);
  });

  test("top / middle / bottom / baseline use the ascender and descender of the font", () => {
    // Zen Kaku Gothic New: ascender 1160, descender -288 per 1000 units.
    const ascent = 11.6;
    const descent = -2.88;
    const baseline = lay("Hxg", { verticalAlign: "baseline" });
    const top = lay("Hxg", { verticalAlign: "top" });
    const middle = lay("Hxg", { verticalAlign: "middle" });
    const bottom = lay("Hxg", { verticalAlign: "bottom" });
    expect(lay("Hxg")).toEqual(baseline);
    expect(baseline.glyphs[0]!.origin.y).toBe(0);
    expect(top.glyphs[0]!.origin.y).toBeCloseTo(-ascent, 9);
    expect(bottom.glyphs[0]!.origin.y).toBeCloseTo(-descent, 9);
    expect(middle.glyphs[0]!.origin.y).toBeCloseTo(-(ascent + descent) / 2, 9);
    expect(box(top).maxY).toBeLessThan(0);
    expect(box(bottom).minY).toBeGreaterThan(0);
    expect(box(middle).minY).toBeLessThan(0);
    expect(box(middle).maxY).toBeGreaterThan(0);
    expect(height(box(top))).toBeCloseTo(height(box(baseline)), 9);
    expect(box(top).minX).toBe(box(baseline).minX);
  });
});

describe("multiple lines", () => {
  test("lines go downwards by lineSpacing × height", () => {
    const layout = lay("Fab\nCAD\n123");
    expect(layout.lineCount).toBe(3);
    expect(layout.glyphs).toHaveLength(9);
    expect(layout.glyphs.map((g) => g.cluster)).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
    expect(layout.glyphs.map((g) => g.origin.y)).toEqual([0, 0, 0, -12, -12, -12, -24, -24, -24]);
    expect(layout.glyphs.filter((g) => g.origin.x === 0)).toHaveLength(3);
    const wide = lay("Fab\nCAD\n123", { lineSpacing: 2, height: 5 });
    expect(wide.glyphs.map((g) => g.origin.y)).toEqual([0, 0, 0, -10, -10, -10, -20, -20, -20]);
    expect(height(box(layout))).toBeGreaterThan(24 + 6);
    // Windows line ends and an empty line in between.
    const crlf = lay("Fab\r\n\r\n123");
    expect(crlf.lineCount).toBe(3);
    expect(crlf.glyphs.map((g) => g.text).join("")).toBe("Fab123");
    expect(crlf.glyphs.map((g) => g.cluster)).toEqual([0, 1, 2, 7, 8, 9]);
    expect(crlf.glyphs[3]!.origin).toEqual({ x: 0, y: -24 });
  });

  test("every line is aligned on its own; the block is aligned vertically", () => {
    const text = "FabCAD\n12";
    const center = lay(text, { horizontalAlign: "center" });
    const right = lay(text, { horizontalAlign: "right" });
    for (const line of [center.glyphs.slice(0, 6), center.glyphs.slice(6)]) {
      const first = line[0]!;
      const last = line[line.length - 1]!;
      expect(first.origin.x + last.origin.x + last.advance).toBeCloseTo(0, 9);
    }
    expect(right.glyphs[5]!.origin.x + right.glyphs[5]!.advance).toBeCloseTo(0, 9);
    expect(right.glyphs[7]!.origin.x + right.glyphs[7]!.advance).toBeCloseTo(0, 9);

    const top = lay(text, { verticalAlign: "top" });
    const middle = lay(text, { verticalAlign: "middle" });
    const bottom = lay(text, { verticalAlign: "bottom" });
    expect(top.glyphs[0]!.origin.y).toBeCloseTo(-11.6, 9);
    expect(top.glyphs[6]!.origin.y).toBeCloseTo(-11.6 - 12, 9);
    expect(bottom.glyphs[6]!.origin.y).toBeCloseTo(2.88, 9);
    expect(bottom.glyphs[0]!.origin.y).toBeCloseTo(2.88 + 12, 9);
    expect(middle.glyphs[0]!.origin.y).toBeCloseTo((top.glyphs[0]!.origin.y + bottom.glyphs[0]!.origin.y) / 2, 9);
    expect(box(top).maxY).toBeLessThan(0);
    expect(box(bottom).minY).toBeGreaterThan(0);
  });
});

describe("vertical Japanese", () => {
  test("glyphs advance downwards in one upright column", () => {
    for (const f of BUNDLED_FONTS) {
      const layout = lay("日本語の設計", { fontId: f.id, vertical: true });
      expect(layout.glyphs).toHaveLength(6);
      expect(layout.lineCount).toBe(1);
      layout.glyphs.forEach((g, i) => {
        expect(g.rotation).toBe(0);
        expect(g.advance, f.id).toBeCloseTo(10, 9);
        if (i > 0) expect(g.origin.y, f.id).toBeCloseTo(layout.glyphs[i - 1]!.origin.y - 10, 9);
        // Full-width glyph centred on the column axis x = 5.
        expect(g.origin.x, f.id).toBeCloseTo(0, 9);
      });
      const b = box(layout);
      expect(b.minX).toBeGreaterThanOrEqual(-0.5);
      expect(b.maxX).toBeLessThanOrEqual(10.5);
      expect((b.minX + b.maxX) / 2).toBeCloseTo(5, 0);
      // The column hangs from y = 0: six em boxes of 10 mm.
      expect(layout.glyphs[0]!.origin.y, f.id).toBeCloseTo(-8.8, 9);
      expect(b.maxY).toBeLessThanOrEqual(0);
      expect(b.maxY).toBeGreaterThan(-2);
      expect(b.minY).toBeGreaterThanOrEqual(-60);
      expect(b.minY).toBeLessThan(-58);
      expect(height(b)).toBeGreaterThan(50);
      expect(layout.loops.flatMap(loopProblems)).toEqual([]);
      // Kanji use the same glyphs as in horizontal text (kana may have vertical forms).
      const horizontal = lay("日本語の設計", { fontId: f.id }).glyphs.map((g) => g.glyphId);
      const ids = layout.glyphs.map((g) => g.glyphId);
      for (const i of [0, 1, 2, 4, 5]) expect(ids[i], f.id).toBe(horizontal[i]);
    }
  });

  test("vert / vrt2 alternates: ー 、 。 「 」 use different glyphs in every bundled font", () => {
    for (const f of BUNDLED_FONTS) {
      expect(f.vertical).toBe(true);
      for (const ch of "ー、。「」") {
        const h = lay(ch, { fontId: f.id });
        const v = lay(ch, { fontId: f.id, vertical: true });
        expect(v.glyphs[0]!.glyphId, `${f.id} ${ch}`).not.toBe(h.glyphs[0]!.glyphId);
        expect(v.missing).toEqual([]);
        expect(v.loops.length).toBeGreaterThan(0);
      }
      // The long vowel mark is a horizontal bar in horizontal text and a vertical one in a column.
      const h = box(lay("ー", { fontId: f.id }));
      const v = box(lay("ー", { fontId: f.id, vertical: true }));
      expect(width(h), f.id).toBeGreaterThan(height(h) * 2);
      expect(height(v), f.id).toBeGreaterThan(width(v) * 2);
      // 、 sits in the lower left of its cell horizontally and in the upper right vertically.
      const comma = box(lay("、", { fontId: f.id, vertical: true }));
      expect((comma.minX + comma.maxX) / 2, f.id).toBeGreaterThan(5);
      expect((comma.minY + comma.maxY) / 2, f.id).toBeGreaterThan(-5);
    }
  });

  test("letter spacing, stretch and alignment in a column", () => {
    const base = lay("日本語", { vertical: true });
    const spaced = lay("日本語", { vertical: true, spacing: 2 });
    spaced.glyphs.forEach((g, i) => expect(g.origin.y).toBeCloseTo(base.glyphs[0]!.origin.y - 12 * i, 9));
    expect(spaced.glyphs[0]!.advance).toBe(10);

    const stretched = lay("日本語", { vertical: true, stretch: 50 });
    expect(width(box(stretched))).toBeCloseTo(width(box(base)) / 2, 9);
    expect(height(box(stretched))).toBeCloseTo(height(box(base)), 9);
    expect(box(stretched).minX).toBeGreaterThanOrEqual(0);
    expect(box(stretched).maxX).toBeLessThanOrEqual(5);

    // Column length 30: top starts at 0, middle is centred, bottom ends at 0.
    const middle = lay("日本語", { vertical: true, verticalAlign: "middle" });
    const bottom = lay("日本語", { vertical: true, verticalAlign: "bottom" });
    expect(lay("日本語", { vertical: true, verticalAlign: "top" })).toEqual(base);
    expect(middle.glyphs[0]!.origin.y).toBeCloseTo(base.glyphs[0]!.origin.y + 15, 9);
    expect(bottom.glyphs[0]!.origin.y).toBeCloseTo(base.glyphs[0]!.origin.y + 30, 9);
    expect(box(bottom).minY).toBeGreaterThanOrEqual(0);

    const center = lay("日本語", { vertical: true, horizontalAlign: "center" });
    const right = lay("日本語", { vertical: true, horizontalAlign: "right" });
    expect(center.glyphs[0]!.origin.x).toBeCloseTo(-5, 9);
    expect(right.glyphs[0]!.origin.x).toBeCloseTo(-10, 9);
    expect(box(right).maxX).toBeLessThanOrEqual(0);
  });

  test("columns run from right to left", () => {
    const layout = lay("日本\n語", { vertical: true });
    expect(layout.lineCount).toBe(2);
    expect(layout.glyphs.map((g) => g.cluster)).toEqual([0, 1, 3]);
    const [a, b, c] = layout.glyphs;
    // Left aligned block: the second column starts at x = 0, the first is one pitch (12) to the right.
    expect(c!.origin.x).toBeCloseTo(0, 9);
    expect(a!.origin.x).toBeCloseTo(12, 9);
    expect(b!.origin.x).toBeCloseTo(12, 9);
    expect(c!.origin.y).toBeCloseTo(a!.origin.y, 9);
    expect(b!.origin.y).toBeCloseTo(a!.origin.y - 10, 9);
    const right = lay("日本\n語", { vertical: true, horizontalAlign: "right" });
    expect(right.glyphs[0]!.origin.x).toBeCloseTo(-10, 9);
    expect(right.glyphs[2]!.origin.x).toBeCloseTo(-22, 9);
    expect(width(box(layout))).toBeGreaterThan(20);
  });

  test("Latin letters stay upright and are centred in the column", () => {
    const layout = lay("A設", { vertical: true });
    const [a, kanji] = layout.glyphs;
    const ba = box(lay("A", { vertical: true }));
    expect((ba.minX + ba.maxX) / 2).toBeCloseTo(5, 0);
    expect(kanji!.origin.y).toBeLessThan(a!.origin.y);
    expect(a!.rotation).toBe(0);
  });
});
