import type { Vec2 } from "@fabcad/geometry";

/**
 * Typed points for the Create tools of the sketch, so that exact shapes can be drawn from the
 * keyboard (and by agents that cannot click to a hundredth of a millimetre). Pure functions.
 *
 * - `x, y`        the point at x, y of the sketch
 * - `@dx, dy`     relative to the previous point of the shape (the origin for the first)
 * - `length<angle`  polar, from the origin; `@length<angle` from the previous point
 *
 * Each number is an expression: `width / 2, 10` works with a parameter `width`.
 */

export type PointEntryResult = { ok: true; point: Vec2 } | { ok: false; error: string };

/** Split at the commas that are not inside brackets (`max(a, b), 3` is two parts). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

export function parsePointEntry(
  text: string,
  previous: Vec2 | null,
  evaluate: (expression: string, kind: "length" | "angle") => number,
): PointEntryResult {
  let src = text.trim();
  if (src === "") return { ok: false, error: "Type x, y, @dx, dy or @length<angle." };
  const relative = src.startsWith("@");
  if (relative) src = src.slice(1).trim();
  const base = relative && previous ? previous : { x: 0, y: 0 };
  const value = (expression: string, kind: "length" | "angle", name: string): number => {
    if (expression === "") throw new Error(`${name} is missing.`);
    const v = evaluate(expression, kind);
    if (!Number.isFinite(v)) throw new Error(`${name} is not a number.`);
    return v;
  };
  try {
    const polar = splitTopLevel(src, "<");
    if (polar.length === 2) {
      const length = value(polar[0]!, "length", "The length");
      const angle = (value(polar[1]!, "angle", "The angle") * Math.PI) / 180;
      return {
        ok: true,
        point: { x: base.x + length * Math.cos(angle), y: base.y + length * Math.sin(angle) },
      };
    }
    const parts = splitTopLevel(src, ",");
    if (parts.length !== 2 || polar.length > 2) {
      return { ok: false, error: "Type two values separated by a comma: x, y." };
    }
    const x = value(parts[0]!, "length", "X");
    const y = value(parts[1]!, "length", "Y");
    return { ok: true, point: { x: base.x + x, y: base.y + y } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Whether a key starts a typed point while a Create tool runs. */
export function startsPointEntry(key: string): boolean {
  return /^[0-9.\-@(]$/.test(key);
}
