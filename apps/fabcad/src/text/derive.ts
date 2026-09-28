import { type Scope, evaluateAs } from "@fabcad/cad-document";
import { type Curve2, type Vec2, curveLength } from "@fabcad/geometry";
import {
  type Sketch,
  type SketchText,
  type SketchTextOutline,
  entityToCurves,
  getPoint,
  isCurve,
} from "@fabcad/sketch";
import type { TextLayoutRequest, Typography } from "@fabcad/typography";

/**
 * SketchText → glyph outlines. The outlines are derived data kept in the text (see
 * `SketchTextOutline`); this is the only place that makes them, and the only place where the
 * CAD document and the typography package meet. It runs on the main thread, where the fonts
 * are.
 */

export interface TextValues {
  height: number;
  letterSpacing: number;
  lineSpacing: number;
  /** Radians. */
  rotation: number;
  pathOffset: number;
  pathStart: number;
}

export interface TextProblem {
  textId: string;
  kind: "expression" | "font-missing" | "font-loading" | "layout" | "path";
  message: string;
}

const FIELD_LABELS = {
  height: "Height",
  letterSpacing: "Letter spacing",
  lineSpacing: "Line spacing",
  rotation: "Angle",
  offset: "Path offset",
  start: "Path start",
} as const;

/** Evaluate the expressions of a text. Throws an Error that names the field. */
export function evaluateText(text: SketchText, scope: Scope): TextValues {
  const field = (
    name: keyof typeof FIELD_LABELS,
    expression: string,
    kind: "length" | "angle" | "none",
  ): number => {
    try {
      return evaluateAs(expression, kind, scope);
    } catch (err) {
      throw new Error(`${FIELD_LABELS[name]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const height = field("height", text.height, "length");
  if (!(height > 0)) throw new Error("Height: Must be greater than zero");
  const lineSpacing = field("lineSpacing", text.lineSpacing, "none");
  if (!(lineSpacing > 0)) throw new Error("Line spacing: Must be greater than zero");
  return {
    height,
    letterSpacing: field("letterSpacing", text.letterSpacing, "length"),
    lineSpacing,
    rotation: (field("rotation", text.rotation, "angle") * Math.PI) / 180,
    pathOffset: text.path ? field("offset", text.path.offset, "length") : 0,
    pathStart: text.path ? field("start", text.path.start, "length") : 0,
  };
}

const round = (v: number, digits = 6): number => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
const roundPoint = (p: Vec2): Vec2 => ({ x: round(p.x), y: round(p.y) });

function roundCurve(c: Curve2): Curve2 {
  switch (c.type) {
    case "line":
      return { type: "line", a: roundPoint(c.a), b: roundPoint(c.b) };
    case "bezier":
      return {
        type: "bezier",
        p0: roundPoint(c.p0),
        p1: roundPoint(c.p1),
        p2: roundPoint(c.p2),
        p3: roundPoint(c.p3),
      };
    default:
      return c;
  }
}

/**
 * Rounding must not open the loops: the end of each curve is made the start of the next one.
 */
function closeLoop(loop: Curve2[]): Curve2[] {
  const out = loop.map(roundCurve);
  for (const [i, c] of out.entries()) {
    const next = out[(i + 1) % out.length]!;
    const start = next.type === "line" ? next.a : next.type === "bezier" ? next.p0 : null;
    if (!start) continue;
    if (c.type === "line") c.b = start;
    else if (c.type === "bezier") c.p3 = start;
  }
  return out;
}

function pathCurves(sketch: Sketch, text: SketchText): Curve2[] | null {
  if (!text.path) return null;
  const e = sketch.entities[text.path.entityId];
  if (!e || !isCurve(e)) return null;
  const curves = entityToCurves(sketch, e);
  return curves.length > 0 && curves.reduce((sum, c) => sum + curveLength(c), 0) > 1e-9
    ? curves
    : null;
}

export function textKey(text: SketchText, values: TextValues, path: Curve2[] | null): string {
  return JSON.stringify([
    text.text,
    text.fontId,
    text.direction,
    text.horizontalAlign,
    text.verticalAlign,
    round(values.height, 9),
    round(values.letterSpacing, 9),
    round(values.lineSpacing, 9),
    path ? [path, text.path?.flip, text.path?.align, round(values.pathOffset, 9), round(values.pathStart, 9)] : 0,
  ]);
}

export interface DerivedTexts {
  sketch: Sketch;
  problems: TextProblem[];
  /** Fonts that are known but not loaded yet; derive again once they are. */
  pendingFonts: string[];
}

export const missingFontMessage = (text: SketchText): string =>
  `The font "${text.fontName}" is not available. Load the font file to edit this text; until then it keeps its last outline.`;

/**
 * Renew the outlines of the texts of a sketch where their inputs changed. Returns the very
 * same sketch when nothing changed. Never throws: what cannot be derived keeps its last
 * outline and is reported as a problem.
 */
export function deriveSketchTexts(sketch: Sketch, scope: Scope, typography: Typography): DerivedTexts {
  const problems: TextProblem[] = [];
  const pending = new Set<string>();
  if (!sketch.texts) return { sketch, problems, pendingFonts: [] };
  let texts = sketch.texts;
  const known = new Set(typography.listFonts().map((f) => f.id));

  for (const text of Object.values(sketch.texts)) {
    let values: TextValues;
    try {
      values = evaluateText(text, scope);
    } catch (err) {
      problems.push({
        textId: text.id,
        kind: "expression",
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const path = pathCurves(sketch, text);
    if (text.path && !path) {
      problems.push({ textId: text.id, kind: "path", message: "The path of the text has no length." });
    }
    const key = textKey(text, values, path);
    const current = text.outline;
    // Said even while the outline is current: the text cannot be edited without its font.
    if (!known.has(text.fontId)) {
      problems.push({ textId: text.id, kind: "font-missing", message: missingFontMessage(text) });
    }
    if (current?.key === key) {
      // Turning a text needs no new layout.
      if (current.space === "local" && Math.abs(current.rotation - values.rotation) > 1e-12) {
        if (texts === sketch.texts) texts = { ...sketch.texts };
        texts[text.id] = { ...text, outline: { ...current, rotation: values.rotation } };
      }
      continue;
    }
    if (!known.has(text.fontId)) continue;
    if (!typography.isLoaded(text.fontId)) {
      pending.add(text.fontId);
      problems.push({
        textId: text.id,
        kind: "font-loading",
        message: `Loading the font "${text.fontName}"…`,
      });
      continue;
    }
    const request: TextLayoutRequest = {
      text: text.text,
      fontId: text.fontId,
      height: values.height,
      spacing: values.letterSpacing,
      lineSpacing: values.lineSpacing,
      horizontalAlign: text.horizontalAlign,
      verticalAlign: text.verticalAlign,
      vertical: text.direction === "vertical",
    };
    if (path && text.path) {
      request.path = {
        curves: path,
        offset: values.pathOffset,
        start: values.pathStart,
        flip: text.path.flip,
        align: text.path.align,
      };
    }
    try {
      const layout = typography.layout(request);
      const outline: SketchTextOutline = {
        key,
        loops: layout.loops.map(closeLoop),
        space: request.path ? "sketch" : "local",
        rotation: request.path ? 0 : values.rotation,
        bounds: layout.bounds
          ? {
              minX: round(layout.bounds.minX),
              minY: round(layout.bounds.minY),
              maxX: round(layout.bounds.maxX),
              maxY: round(layout.bounds.maxY),
            }
          : null,
        missing: layout.missing,
      };
      if (texts === sketch.texts) texts = { ...sketch.texts };
      texts[text.id] = { ...text, outline };
      if (layout.missing.length > 0) {
        problems.push({
          textId: text.id,
          kind: "layout",
          message: `"${text.fontName}" has no glyph for: ${layout.missing.join(" ")}`,
        });
      }
    } catch (err) {
      problems.push({
        textId: text.id,
        kind: "layout",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    sketch: texts === sketch.texts ? sketch : { ...sketch, texts },
    problems,
    pendingFonts: [...pending],
  };
}

/** Position of the text origin, for callers that place something next to the text. */
export const textOrigin = (sketch: Sketch, text: SketchText): Vec2 => getPoint(sketch, text.origin);
