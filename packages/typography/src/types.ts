import type { Bounds2, Curve2, Vec2 } from "@fabcad/geometry";

export type FontCategory = "gothic" | "mincho" | "rounded" | "display" | "handwriting" | "pixel";

export interface FontInfo {
  /** Stable id stored in documents. Bundled: short name (e.g. "zen"). User fonts: "user:<hash of the bytes>". */
  id: string;
  /** Family name for display. */
  family: string;
  bundled: boolean;
  /** True when the font has OpenType vertical alternates (GSUB `vert` or `vrt2`). */
  vertical: boolean;
  /** Bundled fonts: file name below the app's `fonts/` directory. */
  file?: string;
  /** SPDX license id (bundled fonts only). */
  license?: string;
  /** Bundled fonts: file name of the license text below `fonts/`. */
  licenseFile?: string;
  copyright?: string;
  /** Where the bundled file was obtained from. */
  source?: string;
  category?: FontCategory;
  /** Script hints for the UI (bundled fonts only). */
  scripts?: string[];
  /** User fonts: the name given to `registerUserFont()` (usually the file name). */
  name?: string;
}

export interface TypographyOptions {
  /** Loads the bytes of a bundled font file, e.g. fetch(base + "fonts/" + file) in the app, fs in tests. */
  loadFontFile(file: string): Promise<ArrayBuffer>;
  /**
   * Loads the HarfBuzz wasm binary (`harfbuzzjs/dist/harfbuzz.wasm`). Optional: without it shaping
   * falls back to opentype.js (pair kerning only, no vertical alternates) and
   * `capabilities.shaping` stays false.
   */
  loadHarfBuzzWasm?(): Promise<ArrayBuffer>;
}

export interface TypographyCapabilities {
  /** True once HarfBuzz is initialised (after `ready()` / the first `ensureFont()`). */
  readonly shaping: boolean;
  /** Why HarfBuzz could not be initialised, or null. */
  readonly shapingError: string | null;
}

export interface Typography {
  /** Bundled fonts followed by the registered user fonts. */
  listFonts(): FontInfo[];
  /**
   * Parse and register a user font (TTF / OTF / WOFF). Returns its info; throws FontError with a
   * clear message if it cannot be parsed. The bytes stay in memory only. Registering the same
   * bytes again returns the same id.
   */
  registerUserFont(name: string, data: ArrayBuffer): FontInfo;
  removeUserFont(id: string): void;
  isLoaded(fontId: string): boolean;
  /**
   * Load (and cache) a font so that layout() can be called synchronously afterwards. Also waits
   * for HarfBuzz. Rejects with FontMissingError for unknown ids and with FontError when the file
   * cannot be loaded or parsed (a later call retries).
   */
  ensureFont(fontId: string): Promise<void>;
  /** Resolves when HarfBuzz initialisation has finished (successfully or not). Never rejects. */
  ready(): Promise<void>;
  /** Synchronous layout. Throws FontMissingError if the font is not loaded. */
  layout(request: TextLayoutRequest): TextLayout;
  readonly capabilities: TypographyCapabilities;
}

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom" | "baseline";

export interface TextLayoutRequest {
  /** May contain "\n" (or "\r\n") for multiple lines. */
  text: string;
  fontId: string;
  /** Font size in mm: the em square of the font is scaled to this height. */
  height: number;
  /** Extra letter spacing in mm (may be negative), added after every character cluster. */
  spacing?: number;
  /** Horizontal stretch factor in percent (100 = none). */
  stretch?: number;
  /** Line pitch as a factor of `height` (default 1.2). */
  lineSpacing?: number;
  horizontalAlign?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  /** Japanese vertical writing: top-to-bottom, columns right-to-left, vert/vrt2 alternates. Ignored with `path`. */
  vertical?: boolean;
  /** Text on a path: glyphs are placed along the path, each rotated to the tangent. */
  path?: TextPath;
}

export interface TextPath {
  /** Connected chain of curves from @fabcad/geometry, in travel order. */
  curves: Curve2[];
  /** Distance of the baseline from the path, positive to the left of the travel direction (mm). */
  offset?: number;
  /** Shift along the path as a length in mm, measured from the position given by `align`. */
  start?: number;
  /** Reverse the travel direction; the text also changes to the other side of the path. */
  flip?: boolean;
  /** Alignment along the path (default: the request's `horizontalAlign`, else "left"). */
  align?: HorizontalAlign;
}

export interface GlyphPlacement {
  /** UTF-16 offset of the first source character of the cluster in `request.text`. */
  cluster: number;
  /** Source text of the cluster. */
  text: string;
  glyphId: number;
  /** Closed loops in layout coordinates (mm, X right, Y up), orientation as in the font. */
  loops: Curve2[][];
  /** Where the origin of the glyph outline is placed. */
  origin: Vec2;
  /** Rotation about `origin` in radians, counter-clockwise. */
  rotation: number;
  /** Advance of the glyph along the writing direction in mm (with stretch, without `spacing`). */
  advance: number;
}

export interface TextLayout {
  glyphs: GlyphPlacement[];
  /** All loops of all glyphs. */
  loops: Curve2[][];
  /** Bounding box of the outlines; null for empty / whitespace-only text. */
  bounds: Bounds2 | null;
  /** Characters the font has no glyph for, in order of first appearance. They advance but have no outline. */
  missing: string[];
  lineCount: number;
}
