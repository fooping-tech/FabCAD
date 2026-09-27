import type { Curve2, Vec2 } from "@fabcad/geometry";
import { TypographyError } from "./errors";
import type { ShapedGlyph } from "./harfbuzz";
import { type FontContour, boundsOfLoops, placeContours } from "./outline";
import { createPathMap } from "./pathMap";
import type { GlyphPlacement, HorizontalAlign, TextLayout, TextLayoutRequest } from "./types";

/** What the layout needs from a loaded font. All metrics in font units, Y up. */
export interface LayoutFont {
  unitsPerEm: number;
  ascender: number;
  /** Negative below the baseline. */
  descender: number;
  shape(line: string, vertical: boolean): ShapedGlyph[];
  /** Whether the font maps the character to a glyph. */
  hasGlyph(char: string): boolean;
  /** Closed contours of a glyph; empty for blank glyphs. */
  contours(glyphId: number): readonly FontContour[];
}

export const DEFAULT_LINE_SPACING = 1.2;

interface Line {
  /** UTF-16 offset of the line in the source text. */
  offset: number;
  text: string;
}

/** A glyph in flow coordinates, before alignment. */
interface FlowGlyph {
  cluster: number;
  text: string;
  glyphId: number;
  /** Pen position along the writing direction (mm, ≥ 0). */
  pen: number;
  /** Own advance along the writing direction (mm). */
  advance: number;
  /** Offset of the outline origin from the pen (mm, layout axes). */
  dx: number;
  dy: number;
  contours: readonly FontContour[];
}

interface FlowLine {
  glyphs: FlowGlyph[];
  /** Length of the line along the writing direction, without trailing letter spacing. */
  extent: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charCodeAt(i) !== 10) continue;
    let end = i;
    if (end > from && text.charCodeAt(end - 1) === 13) end--;
    lines.push({ offset: from, text: text.slice(from, end) });
    from = i + 1;
  }
  return lines;
}

const isBlank = (s: string): boolean => /^[\s\p{Cf}\p{Cc}]*$/u.test(s);

function finite(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypographyError(`${name} must be a finite number.`);
  return value;
}

function alignShift(align: HorizontalAlign, extent: number): number {
  return align === "center" ? -extent / 2 : align === "right" ? -extent : 0;
}

export function layoutText(font: LayoutFont, request: TextLayoutRequest): TextLayout {
  const height = request.height;
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypographyError("The text height must be a positive number.");
  }
  const stretch = finite(request.stretch, 100, "stretch") / 100;
  if (stretch <= 0) throw new TypographyError("stretch must be greater than 0.");
  const spacing = finite(request.spacing, 0, "spacing");
  const lineSpacing = finite(request.lineSpacing, DEFAULT_LINE_SPACING, "lineSpacing");
  const horizontalAlign = request.horizontalAlign ?? "left";
  const verticalAlign = request.verticalAlign ?? "baseline";
  const path = request.path;
  const vertical = request.vertical === true && !path;

  const text = request.text;
  if (text.length === 0) return { glyphs: [], loops: [], bounds: null, missing: [], lineCount: 0 };

  const upem = font.unitsPerEm > 0 ? font.unitsPerEm : 1000;
  const scale = height / upem;
  const scaleX = scale * stretch;
  const validMetrics = font.ascender > 0 && font.descender <= 0;
  const ascent = (validMetrics ? font.ascender : 0.88 * upem) * scale;
  const descent = (validMetrics ? font.descender : -0.12 * upem) * scale;

  const missing: string[] = [];
  const lines = splitLines(text);

  // 1. Shape every line and run the pen along the writing direction.
  const flow: FlowLine[] = lines.map((line) => {
    const shaped = font.shape(line.text, vertical);
    const starts = [...new Set(shaped.map((g) => g.cluster))].sort((a, b) => a - b);
    const glyphs: FlowGlyph[] = [];
    let pen = 0;
    let extent = 0;
    shaped.forEach((g, i) => {
      const next = starts[starts.indexOf(g.cluster) + 1] ?? line.text.length;
      const clusterText = line.text.slice(g.cluster, next);
      let contours: readonly FontContour[] = [];
      if (g.glyphId === 0) {
        // .notdef: report the characters; its box is not a usable outline.
        const chars = [...clusterText].filter((ch) => !isBlank(ch));
        const unmapped = chars.filter((ch) => !font.hasGlyph(ch));
        for (const ch of unmapped.length > 0 ? unmapped : chars) {
          if (!missing.includes(ch)) missing.push(ch);
        }
      } else {
        contours = font.contours(g.glyphId);
      }
      const advance = vertical ? -g.yAdvance * scale : g.xAdvance * scaleX;
      glyphs.push({
        cluster: line.offset + g.cluster,
        text: clusterText,
        glyphId: g.glyphId,
        pen,
        advance,
        dx: g.xOffset * scaleX,
        dy: g.yOffset * scale,
        contours,
      });
      pen += advance;
      extent = pen;
      // Letter spacing follows the last glyph of every cluster.
      if (shaped[i + 1]?.cluster !== g.cluster) pen += spacing;
    });
    return { glyphs, extent };
  });

  // 2. Place the glyphs.
  const glyphs: GlyphPlacement[] = [];
  const loops: Curve2[][] = [];
  const place = (g: FlowGlyph, origin: Vec2, rotation: number): void => {
    const glyphLoops = placeContours(g.contours, {
      scaleX,
      scaleY: scale,
      cos: rotation === 0 ? 1 : Math.cos(rotation),
      sin: rotation === 0 ? 0 : Math.sin(rotation),
      origin,
    });
    glyphs.push({
      cluster: g.cluster,
      text: g.text,
      glyphId: g.glyphId,
      loops: glyphLoops,
      origin,
      rotation,
      advance: g.advance,
    });
    for (const loop of glyphLoops) loops.push(loop);
  };

  const pitch = lineSpacing * height;

  if (vertical) {
    // Columns run right to left; every column is centred on its own vertical line.
    const columnPitch = pitch * stretch;
    const half = (height * stretch) / 2;
    const span = (flow.length - 1) * columnPitch;
    const shiftX =
      horizontalAlign === "left" ? span + half : horizontalAlign === "center" ? span / 2 : -half;
    flow.forEach((column, i) => {
      const centre = shiftX - i * columnPitch;
      const top =
        verticalAlign === "middle" ? column.extent / 2 : verticalAlign === "bottom" ? column.extent : 0;
      for (const g of column.glyphs) place(g, { x: centre + g.dx, y: top - g.pen + g.dy }, 0);
    });
  } else {
    // Block from the ascender line of the first line to the descender line of the last one.
    const blockTop = ascent;
    const blockBottom = -(flow.length - 1) * pitch + descent;
    const shiftY =
      verticalAlign === "top"
        ? -blockTop
        : verticalAlign === "bottom"
          ? -blockBottom
          : verticalAlign === "middle"
            ? -(blockTop + blockBottom) / 2
            : 0;

    if (path) {
      const map = createPathMap(path.curves, path.flip === true);
      if (!map) throw new TypographyError("The text path has no length.");
      const offset = finite(path.offset, 0, "path.offset");
      const start = finite(path.start, 0, "path.start");
      const align = path.align ?? horizontalAlign;
      flow.forEach((line, i) => {
        const lineStart =
          start +
          (align === "center"
            ? (map.length - line.extent) / 2
            : align === "right"
              ? map.length - line.extent
              : 0);
        const normalOffset = offset + shiftY - i * pitch;
        for (const g of line.glyphs) {
          // The middle of the glyph's advance sits on the path; the glyph is rotated about it.
          const frame = map.frameAt(lineStart + g.pen + g.advance / 2);
          const t = frame.tangent;
          const along = g.dx - g.advance / 2;
          const across = normalOffset + g.dy;
          place(
            g,
            {
              x: frame.point.x + t.x * along - t.y * across,
              y: frame.point.y + t.y * along + t.x * across,
            },
            Math.atan2(t.y, t.x),
          );
        }
      });
    } else {
      flow.forEach((line, i) => {
        const x0 = alignShift(horizontalAlign, line.extent);
        const baseline = shiftY - i * pitch;
        for (const g of line.glyphs) place(g, { x: x0 + g.pen + g.dx, y: baseline + g.dy }, 0);
      });
    }
  }

  return { glyphs, loops, bounds: boundsOfLoops(loops), missing, lineCount: lines.length };
}
