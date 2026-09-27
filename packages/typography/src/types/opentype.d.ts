/**
 * Minimal local typings for the part of opentype.js 1.3.4 that @fabcad/typography uses.
 * (Kept local so the package does not depend on @types/opentype.js being installed.)
 */
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "Q" | "C" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    /** Outline in font units, Y up. Parsed lazily by opentype.js. */
    path: Path;
  }

  export interface GlyphSet {
    length: number;
    get(index: number): Glyph | undefined;
  }

  export interface LocalizedName {
    [language: string]: string | undefined;
  }

  export interface FeatureRecord {
    tag: string;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    numGlyphs: number;
    glyphs: GlyphSet;
    names: { fontFamily?: LocalizedName; fullName?: LocalizedName };
    tables: {
      gsub?: { features?: FeatureRecord[] };
      os2?: { sTypoAscender?: number; sTypoDescender?: number };
    };
    charToGlyphIndex(char: string): number;
    getKerningValue(left: number, right: number): number;
  }

  export function parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font;
}
