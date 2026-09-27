import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { parse } from "opentype.js";
import { describe, expect, test } from "vitest";
import {
  BUNDLED_FONTS,
  DEFAULT_FONT_ID,
  FontError,
  FontMissingError,
  TypographyError,
  bundledFont,
  createTypography,
  isUserFontId,
} from "../src/index";
import { inflateZlib } from "../src/inflate";
import { FONT_DIR, loopProblems, makeTypography, readFontFile } from "./helpers";

const JAPANESE = "設計から、切れるデータまで。";

/** Pack an SFNT font as WOFF 1 (zlib-compressed tables). */
function toWoff(sfnt: ArrayBuffer): ArrayBuffer {
  const input = new DataView(sfnt);
  const count = input.getUint16(4);
  const tables = [];
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = input.getUint32(at + 8);
    const length = input.getUint32(at + 12);
    const raw = new Uint8Array(sfnt, offset, length);
    const packed = deflateSync(raw, { level: 6 });
    const data = packed.byteLength < length ? new Uint8Array(packed) : raw;
    tables.push({ tag: input.getUint32(at), checksum: input.getUint32(at + 4), length, data });
  }
  let size = 44 + 20 * count;
  for (const t of tables) size += Math.ceil(t.data.byteLength / 4) * 4;
  const out = new ArrayBuffer(size);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, input.getUint32(0));
  view.setUint32(8, size);
  view.setUint16(12, count);
  let total = 12 + 16 * count;
  for (const t of tables) total += Math.ceil(t.length / 4) * 4;
  view.setUint32(16, total);
  let offset = 44 + 20 * count;
  tables.forEach((t, i) => {
    const at = 44 + i * 20;
    view.setUint32(at, t.tag);
    view.setUint32(at + 4, offset);
    view.setUint32(at + 8, t.data.byteLength);
    view.setUint32(at + 12, t.length);
    view.setUint32(at + 16, t.checksum);
    bytes.set(t.data, offset);
    offset += Math.ceil(t.data.byteLength / 4) * 4;
  });
  return out;
}

describe("bundled font catalog", () => {
  test("lists the eight fonts with license data; the default is Zen Kaku Gothic New", () => {
    expect(BUNDLED_FONTS).toHaveLength(8);
    expect(new Set(BUNDLED_FONTS.map((f) => f.id)).size).toBe(8);
    expect(bundledFont(DEFAULT_FONT_ID)?.family).toBe("Zen Kaku Gothic New");
    for (const f of BUNDLED_FONTS) {
      expect(f.bundled).toBe(true);
      expect(f.license).toBe("OFL-1.1");
      expect(isUserFontId(f.id)).toBe(false);
      expect(existsSync(FONT_DIR + f.file!), f.file).toBe(true);
      const license = readFileSync(FONT_DIR + f.licenseFile!, "utf8");
      expect(license).toContain("SIL Open Font License, Version 1.1");
      // The copyright line of the catalog is the first line of the license file.
      expect(license.split("\n")[0]!.trim()).toBe(f.copyright);
    }
  });

  test("the font files match the catalog: family name, vertical alternates, scripts", () => {
    for (const f of BUNDLED_FONTS) {
      const font = parse(readFontFile(f.file!));
      expect(font.names.fontFamily?.["en"], f.id).toBe(f.family);
      const tags = (font.tables.gsub?.features ?? []).map((x) => x.tag);
      expect(tags.includes("vert") || tags.includes("vrt2"), f.id).toBe(f.vertical);
      for (const ch of "Aa1あア設") expect(font.charToGlyphIndex(ch), `${f.id} ${ch}`).toBeGreaterThan(0);
    }
  });

  test("THIRD_PARTY_FONTS.md names every bundled file", () => {
    const doc = readFileSync(new URL("../../../THIRD_PARTY_FONTS.md", import.meta.url), "utf8");
    for (const f of BUNDLED_FONTS) {
      expect(doc).toContain(f.family);
      expect(doc).toContain(f.file!);
      expect(doc).toContain(f.licenseFile!);
      expect(doc).toContain(f.copyright!);
    }
  });
});

describe("loading", () => {
  test("every bundled font loads and turns Japanese text into closed loops", async () => {
    const t = makeTypography();
    expect(t.capabilities.shaping).toBe(false);
    const heights: number[] = [];
    for (const f of BUNDLED_FONTS) {
      expect(t.isLoaded(f.id)).toBe(false);
      await t.ensureFont(f.id);
      expect(t.isLoaded(f.id)).toBe(true);
      const layout = t.layout({ text: JAPANESE, fontId: f.id, height: 20 });
      expect(layout.missing, f.id).toEqual([]);
      expect(layout.glyphs, f.id).toHaveLength([...JAPANESE].length);
      expect(layout.loops.length, f.id).toBeGreaterThanOrEqual(25);
      expect(layout.loops.flatMap(loopProblems), f.id).toEqual([]);
      const b = layout.bounds!;
      // 14 full-width characters of 20 mm, inside the em box above and below the baseline.
      expect(b.minX).toBeGreaterThanOrEqual(-1);
      expect(b.maxX).toBeLessThanOrEqual(14 * 20 + 1);
      expect(b.maxX - b.minX).toBeGreaterThan(14 * 20 * 0.9);
      expect(b.minY).toBeGreaterThan(-0.3 * 20);
      expect(b.maxY).toBeLessThan(1.0 * 20);
      heights.push(b.maxY - b.minY);
    }
    expect(t.capabilities.shaping).toBe(true);
    expect(t.capabilities.shapingError).toBeNull();
    expect(Math.max(...heights) / Math.min(...heights)).toBeLessThan(1.6);
  });

  test("a font is fetched once, concurrent calls share the request", async () => {
    const t = makeTypography();
    await Promise.all([t.ensureFont("zen"), t.ensureFont("zen"), t.ensureFont("zen")]);
    await t.ensureFont("zen");
    expect(t.requests).toEqual(["ZenKakuGothicNew-Regular.ttf"]);
  });

  test("a failed download is reported as FontError and can be retried", async () => {
    let fail = true;
    const t = createTypography({
      loadFontFile: async (file) => {
        if (fail) throw new Error("HTTP 503");
        return readFontFile(file);
      },
    });
    const error = await t.ensureFont("zen").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FontError);
    expect(error).not.toBeInstanceOf(FontMissingError);
    expect((error as Error).message).toMatch(/Zen Kaku Gothic New.*HTTP 503/);
    expect(t.isLoaded("zen")).toBe(false);
    fail = false;
    await t.ensureFont("zen");
    expect(t.isLoaded("zen")).toBe(true);
  });

  test("FontMissingError for unknown ids, unregistered user fonts and layout before ensureFont", async () => {
    const t = makeTypography();
    for (const id of ["nope", "user:0123456789abcdef", ""]) {
      const error = await t.ensureFont(id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FontMissingError);
      expect(error).toBeInstanceOf(FontError);
      expect(error).toBeInstanceOf(TypographyError);
      expect((error as FontMissingError).fontId).toBe(id);
      expect(() => t.layout({ text: "a", fontId: id, height: 10 })).toThrow(FontMissingError);
    }
    // Bundled but not loaded yet.
    expect(() => t.layout({ text: "a", fontId: "zen", height: 10 })).toThrow(FontMissingError);
    await t.ensureFont("zen");
    expect(t.layout({ text: "a", fontId: "zen", height: 10 }).glyphs).toHaveLength(1);
    expect(t.requests).toEqual(["ZenKakuGothicNew-Regular.ttf"]);
  });

  test("instances are independent", async () => {
    const a = makeTypography();
    const b = makeTypography();
    await a.ensureFont("zen");
    expect(a.isLoaded("zen")).toBe(true);
    expect(b.isLoaded("zen")).toBe(false);
    a.registerUserFont("x.ttf", readFontFile("DotGothic16-Regular.ttf"));
    expect(a.listFonts()).toHaveLength(9);
    expect(b.listFonts()).toHaveLength(8);
  });

  test("without HarfBuzz the opentype.js fallback lays out text", async () => {
    const plain = makeTypography({ harfbuzz: false });
    const shaped = makeTypography();
    await plain.ensureFont("zen");
    await shaped.ensureFont("zen");
    expect(plain.capabilities.shaping).toBe(false);
    const request = { text: "FabCAD 123", fontId: "zen", height: 10 };
    const a = plain.layout(request);
    const b = shaped.layout(request);
    expect(a.glyphs.map((g) => g.glyphId)).toEqual(b.glyphs.map((g) => g.glyphId));
    expect(a.loops.flatMap(loopProblems)).toEqual([]);
    expect(a.bounds!.maxX).toBeCloseTo(b.bounds!.maxX, 0);
    // Vertical text still runs downwards, but without the alternates.
    const v = plain.layout({ text: "あー", fontId: "zen", height: 10, vertical: true });
    const h = plain.layout({ text: "あー", fontId: "zen", height: 10 });
    expect(v.glyphs[1]!.origin.y).toBeLessThan(v.glyphs[0]!.origin.y);
    expect(v.glyphs[1]!.glyphId).toBe(h.glyphs[1]!.glyphId);
  });

  test("a broken HarfBuzz binary falls back and reports the reason", async () => {
    const t = createTypography({
      loadFontFile: async (file) => readFontFile(file),
      loadHarfBuzzWasm: async () => new ArrayBuffer(16),
    });
    await t.ensureFont("zen");
    expect(t.capabilities.shaping).toBe(false);
    expect(t.capabilities.shapingError).toBeTruthy();
    expect(t.layout({ text: "abc", fontId: "zen", height: 10 }).glyphs).toHaveLength(3);
  });
});

describe("user fonts", () => {
  test("register from TTF bytes, lay out, remove", async () => {
    const t = makeTypography();
    await t.ready();
    const bytes = readFontFile("ShipporiMincho-Regular.ttf");
    const info = t.registerUserFont("MyMincho.ttf", bytes);
    expect(info.id).toMatch(/^user:[0-9a-f]{16}$/);
    expect(isUserFontId(info.id)).toBe(true);
    expect(info.bundled).toBe(false);
    expect(info.family).toBe("Shippori Mincho");
    expect(info.name).toBe("MyMincho.ttf");
    expect(info.vertical).toBe(true);
    expect(info.license).toBeUndefined();
    expect(t.isLoaded(info.id)).toBe(true);
    await t.ensureFont(info.id);
    expect(t.listFonts().map((f) => f.id)).toEqual([...BUNDLED_FONTS.map((f) => f.id), info.id]);
    expect(t.requests).toEqual([]);

    // Same bytes → same id and the same outlines as the bundled font.
    expect(t.registerUserFont("again.ttf", bytes).id).toBe(info.id);
    expect(t.listFonts()).toHaveLength(9);
    await t.ensureFont("shippori");
    const user = t.layout({ text: JAPANESE, fontId: info.id, height: 12, vertical: true });
    const bundled = t.layout({ text: JAPANESE, fontId: "shippori", height: 12, vertical: true });
    expect(user.loops).toEqual(bundled.loops);
    expect(user.loops.length).toBeGreaterThan(20);

    t.removeUserFont(info.id);
    expect(t.isLoaded(info.id)).toBe(false);
    expect(t.listFonts()).toHaveLength(8);
    expect(() => t.layout({ text: "a", fontId: info.id, height: 10 })).toThrow(FontMissingError);
    await expect(t.ensureFont(info.id)).rejects.toBeInstanceOf(FontMissingError);
    // Bundled fonts cannot be removed through removeUserFont.
    t.removeUserFont("shippori");
    expect(t.isLoaded("shippori")).toBe(true);
  });

  test("a font registered before HarfBuzz is ready is shaped once it is", async () => {
    const t = makeTypography();
    const info = t.registerUserFont("zen.ttf", readFontFile("ZenKakuGothicNew-Regular.ttf"));
    const before = t.layout({ text: "ー", fontId: info.id, height: 10, vertical: true });
    await t.ready();
    const after = t.layout({ text: "ー", fontId: info.id, height: 10, vertical: true });
    expect(t.capabilities.shaping).toBe(true);
    expect(after.glyphs[0]!.glyphId).not.toBe(before.glyphs[0]!.glyphId);
  });

  test("WOFF keeps every table, including the vertical alternates", async () => {
    const t = makeTypography();
    await t.ready();
    const ttf = readFontFile("DotGothic16-Regular.ttf");
    const woff = toWoff(ttf);
    expect(woff.byteLength).toBeLessThan(ttf.byteLength);
    const a = t.registerUserFont("dot.woff", woff);
    const b = t.registerUserFont("dot.ttf", ttf);
    expect(a.id).not.toBe(b.id);
    expect(a.vertical).toBe(true);
    for (const vertical of [false, true]) {
      const request = { text: "「レーザー、Cut。」", height: 8, vertical };
      const fromWoff = t.layout({ ...request, fontId: a.id });
      expect(fromWoff.loops.length).toBeGreaterThan(8);
      expect(fromWoff).toEqual(t.layout({ ...request, fontId: b.id }));
    }
  });

  test("garbage, truncated and unsupported files throw FontError with a clear message", () => {
    const t = makeTypography();
    const garbage = new Uint8Array(4096).map((_, i) => (i * 37 + 11) & 0xff).buffer;
    expect(() => t.registerUserFont("garbage.ttf", garbage)).toThrow(FontError);
    expect(() => t.registerUserFont("garbage.ttf", garbage)).toThrow(/not a TTF, OTF or WOFF font/);
    expect(() => t.registerUserFont("empty.ttf", new ArrayBuffer(0))).toThrow(FontError);
    const ttf = readFontFile("DotGothic16-Regular.ttf");
    expect(() => t.registerUserFont("cut.ttf", ttf.slice(0, 3000))).toThrow(FontError);
    const woff2 = new Uint8Array(64);
    woff2.set([0x77, 0x4f, 0x46, 0x32]);
    expect(() => t.registerUserFont("a.woff2", woff2.buffer)).toThrow(/WOFF2/);
    const woff = toWoff(ttf);
    expect(() => t.registerUserFont("cut.woff", woff.slice(0, woff.byteLength / 2))).toThrow(FontError);
    const damaged = new Uint8Array(woff.slice(0));
    damaged.fill(0xff, damaged.length - 5000);
    expect(() => t.registerUserFont("damaged.woff", damaged.buffer)).toThrow(FontError);
    expect(t.listFonts()).toHaveLength(8);
  });
});

describe("inflate", () => {
  test("decodes stored, fixed and dynamic blocks like zlib", () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      new Uint8Array(70000).map((_, i) => (i * i) % 251),
      new Uint8Array(200000).map((_, i) => (i % 7 === 0 ? i & 0xff : 65)),
      new TextEncoder().encode("FabCAD ".repeat(5000)),
    ];
    for (const sample of samples) {
      for (const level of [0, 1, 6, 9]) {
        const packed = new Uint8Array(deflateSync(sample, { level }));
        expect(inflateZlib(packed, sample.length)).toEqual(sample);
      }
    }
    const packed = new Uint8Array(deflateSync(samples[2]!));
    expect(() => inflateZlib(packed, samples[2]!.length - 1)).toThrow();
    expect(() => inflateZlib(packed.subarray(0, 100), samples[2]!.length)).toThrow();
  });
});
