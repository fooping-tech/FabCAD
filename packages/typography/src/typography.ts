import { type Font, parse } from "opentype.js";
import { BUNDLED_FONTS, USER_FONT_PREFIX, bundledFont } from "./catalog";
import { FontError, FontMissingError } from "./errors";
import { type HarfBuzz, type HarfBuzzFont, type ShapedGlyph, createHarfBuzz } from "./harfbuzz";
import { type LayoutFont, layoutText } from "./layout";
import { type FontContour, contoursFromCommands } from "./outline";
import { errorMessage, hashBytes, toSfnt } from "./sfnt";
import type {
  FontInfo,
  TextLayout,
  TextLayoutRequest,
  Typography,
  TypographyCapabilities,
  TypographyOptions,
} from "./types";

interface LoadedFont {
  info: FontInfo;
  font: Font;
  emTop: number;
  /** Plain SFNT bytes, kept until the HarfBuzz font exists. */
  sfnt: ArrayBuffer | null;
  hb: HarfBuzzFont | null;
  outlines: Map<number, readonly FontContour[]>;
}

function parseFont(data: ArrayBuffer): { font: Font; sfnt: ArrayBuffer } {
  const sfnt = toSfnt(data);
  let font: Font;
  try {
    font = parse(sfnt);
  } catch (e) {
    throw new FontError(`The font could not be parsed (${errorMessage(e)}).`);
  }
  if (!(font.unitsPerEm > 0) || !(font.numGlyphs > 0)) {
    throw new FontError("The font could not be parsed (it has no glyphs).");
  }
  return { font, sfnt };
}

function hasVerticalAlternates(font: Font): boolean {
  const features = font.tables.gsub?.features ?? [];
  return features.some((f) => f.tag === "vert" || f.tag === "vrt2");
}

function familyName(font: Font, fallback: string): string {
  const names = font.names.fontFamily ?? font.names.fullName;
  if (!names) return fallback;
  const name = names["en"] ?? names["ja"] ?? Object.values(names).find((n) => typeof n === "string");
  return name && name.trim().length > 0 ? name.trim() : fallback;
}

/**
 * Top of the ideographic em box above the baseline, in font units. Vertical text hangs from this
 * line. OS/2 typo metrics describe the em box in CJK fonts (880 / -120); otherwise 0.88 em.
 */
function emBoxTop(font: Font): number {
  const os2 = font.tables.os2;
  const ascender = os2?.sTypoAscender;
  const descender = os2?.sTypoDescender;
  if (
    typeof ascender === "number" &&
    typeof descender === "number" &&
    ascender > 0 &&
    ascender - descender === font.unitsPerEm
  ) {
    return ascender;
  }
  return 0.88 * font.unitsPerEm;
}

/**
 * HarfBuzz hangs glyphs without a vertical origin (no VORG table) from the ascender of the font,
 * which in most fonts lies above the em box and would push the whole column down. Such glyphs
 * are hung from the top of the em box instead, so that a column starts exactly at its top.
 */
function normalizeVerticalOrigins(glyphs: ShapedGlyph[], font: Font, top: number): ShapedGlyph[] {
  for (const g of glyphs) if (-g.yOffset === font.ascender) g.yOffset = -top;
  return glyphs;
}

/** Shaping without HarfBuzz: one glyph per character, pair kerning, no vertical alternates. */
function fallbackShape(font: Font, text: string, vertical: boolean, top: number): ShapedGlyph[] {
  const out: ShapedGlyph[] = [];
  const upem = font.unitsPerEm;
  let index = 0;
  let previous = -1;
  for (const ch of text) {
    const glyphId = font.charToGlyphIndex(ch);
    const advanceWidth = font.glyphs.get(glyphId)?.advanceWidth ?? upem;
    if (vertical) {
      out.push({
        glyphId,
        cluster: index,
        xAdvance: 0,
        yAdvance: -upem,
        xOffset: -advanceWidth / 2,
        yOffset: -top,
      });
    } else {
      if (previous > 0 && glyphId > 0 && out.length > 0) {
        let kerning = 0;
        try {
          kerning = font.getKerningValue(previous, glyphId);
        } catch {
          kerning = 0;
        }
        if (Number.isFinite(kerning)) out[out.length - 1]!.xAdvance += kerning;
      }
      out.push({ glyphId, cluster: index, xAdvance: advanceWidth, yAdvance: 0, xOffset: 0, yOffset: 0 });
    }
    previous = glyphId;
    index += ch.length;
  }
  return out;
}

export function createTypography(options: TypographyOptions): Typography {
  const fonts = new Map<string, LoadedFont>();
  const pending = new Map<string, Promise<void>>();
  let harfbuzz: HarfBuzz | null = null;
  let shapingError: string | null = null;
  let harfbuzzReady: Promise<void> | null = null;

  const capabilities: TypographyCapabilities = {
    get shaping(): boolean {
      return harfbuzz !== null;
    },
    get shapingError(): string | null {
      return shapingError;
    },
  };

  const ready = (): Promise<void> => {
    if (harfbuzzReady) return harfbuzzReady;
    const load = options.loadHarfBuzzWasm;
    if (!load) return (harfbuzzReady = Promise.resolve());
    harfbuzzReady = (async (): Promise<void> => {
      try {
        harfbuzz = await createHarfBuzz(await load());
        shapingError = null;
      } catch (e) {
        shapingError = errorMessage(e);
      }
    })();
    return harfbuzzReady;
  };

  const shaper = (entry: LoadedFont): HarfBuzzFont | null => {
    if (entry.hb) return entry.hb;
    if (!harfbuzz || !entry.sfnt) return null;
    try {
      entry.hb = harfbuzz.createFont(entry.sfnt);
    } catch {
      return null;
    } finally {
      // Either HarfBuzz owns a copy now, or it cannot use these bytes.
      entry.sfnt = null;
    }
    return entry.hb;
  };

  const layoutFont = (entry: LoadedFont): LayoutFont => ({
    unitsPerEm: entry.font.unitsPerEm,
    ascender: entry.font.ascender,
    descender: entry.font.descender,
    shape: (line, vertical) => {
      const hb = shaper(entry);
      if (!hb) return fallbackShape(entry.font, line, vertical, entry.emTop);
      const shaped = hb.shape(line, vertical);
      return vertical ? normalizeVerticalOrigins(shaped, entry.font, entry.emTop) : shaped;
    },
    hasGlyph: (char) => entry.font.charToGlyphIndex(char) > 0,
    contours: (glyphId) => {
      const cached = entry.outlines.get(glyphId);
      if (cached) return cached;
      let contours: FontContour[] = [];
      if (glyphId >= 0 && glyphId < entry.font.numGlyphs) {
        try {
          contours = contoursFromCommands(entry.font.glyphs.get(glyphId)?.path.commands ?? []);
        } catch {
          contours = [];
        }
      }
      entry.outlines.set(glyphId, contours);
      return contours;
    },
  });

  const store = (info: FontInfo, font: Font, sfnt: ArrayBuffer): void => {
    fonts.get(info.id)?.hb?.destroy();
    fonts.set(info.id, {
      info,
      font,
      emTop: emBoxTop(font),
      sfnt: options.loadHarfBuzzWasm ? sfnt : null,
      hb: null,
      outlines: new Map(),
    });
  };

  const loadBundled = async (info: FontInfo): Promise<void> => {
    const file = info.file;
    if (!file) throw new FontMissingError(info.id);
    let data: ArrayBuffer;
    try {
      data = await options.loadFontFile(file);
    } catch (e) {
      throw new FontError(`The font "${info.family}" could not be loaded (${errorMessage(e)}).`);
    }
    const { font, sfnt } = parseFont(data);
    store(info, font, sfnt);
  };

  return {
    capabilities,
    ready,

    listFonts(): FontInfo[] {
      const user = [...fonts.values()].filter((f) => !f.info.bundled).map((f) => ({ ...f.info }));
      return [...BUNDLED_FONTS.map((f) => ({ ...f })), ...user];
    },

    registerUserFont(name: string, data: ArrayBuffer): FontInfo {
      const { font, sfnt } = parseFont(data);
      const label = name.trim();
      const info: FontInfo = {
        id: USER_FONT_PREFIX + hashBytes(data),
        family: familyName(font, label.replace(/\.(ttf|otf|woff)$/i, "") || "User font"),
        bundled: false,
        vertical: hasVerticalAlternates(font),
        name: label,
      };
      store(info, font, sfnt);
      return { ...info };
    },

    removeUserFont(id: string): void {
      const entry = fonts.get(id);
      if (!entry || entry.info.bundled) return;
      entry.hb?.destroy();
      fonts.delete(id);
    },

    isLoaded(fontId: string): boolean {
      return fonts.has(fontId);
    },

    async ensureFont(fontId: string): Promise<void> {
      await ready();
      if (fonts.has(fontId)) return;
      const running = pending.get(fontId);
      if (running) return running;
      const info = bundledFont(fontId);
      if (!info) throw new FontMissingError(fontId);
      const task = loadBundled(info).finally(() => pending.delete(fontId));
      pending.set(fontId, task);
      return task;
    },

    layout(request: TextLayoutRequest): TextLayout {
      const entry = fonts.get(request.fontId);
      if (!entry) throw new FontMissingError(request.fontId);
      return layoutText(layoutFont(entry), request);
    },
  };
}
