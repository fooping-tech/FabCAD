import type { Vec2 } from "@fabcad/geometry";
import { SketchBuilder, editSketch } from "../src/edit";
import { type Sketch, createSketch } from "../src/model";

export const emptySketch = (): Sketch =>
  createSketch("sk1", "Sketch 1", { type: "origin", plane: "XY" });

/** Run `fn` on a builder over an empty (or given) sketch and return both sketch and result. */
export function build<T>(
  fn: (b: SketchBuilder) => T,
  base: Sketch = emptySketch(),
): { sketch: Sketch; out: T } {
  let out: T | undefined;
  const sketch = editSketch(base, (b) => {
    out = fn(b);
  });
  return { sketch, out: out as T };
}

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const countTypes = (sketch: Sketch): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of Object.values(sketch.entities)) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
};

export const constraintTypes = (sketch: Sketch, ids?: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const c of Object.values(sketch.constraints)) {
    if (ids && !ids.includes(c.id)) continue;
    out[c.type] = (out[c.type] ?? 0) + 1;
  }
  return out;
};
