import { describe, expect, it } from "vitest";
import { evaluateAs } from "@fabcad/cad-document";
import { createCircle, createLine, createSketch, editSketch, type Sketch } from "@fabcad/sketch";
import { pickInto, startTransform, transformResult } from "../src/sketch/transformDialog";

const defaults = { patternCount: 3, patternCountY: 1, patternSpacing: 20, scaleFactor: 2, mirrorSymmetry: true };
const evaluate = (e: string, kind: "length" | "angle" | "none") => evaluateAs(e, kind);
const curves = (s: Sketch, type: string) => Object.values(s.entities).filter((e) => e.type === type);

function setup() {
  let circle = "";
  let axis = "";
  const sketch = editSketch(createSketch("s", "Sketch", { type: "origin", plane: "XY" }), (b) => {
    circle = createCircle(b, { x: 20, y: 0 }, 3).entities[0]!;
    axis = createLine(b, { x: -5, y: -10 }, { x: -5, y: 10 }).entities[0]!;
  });
  return { sketch, circle, axis };
}

describe("sketch transform commands", () => {
  it("asks for what is missing, starting from the selection", () => {
    const { circle } = setup();
    expect(startTransform("circular-pattern", "s", [], defaults).picking).toBe("objects");
    expect(startTransform("circular-pattern", "s", [circle], defaults).picking).toBe("center");
    expect(startTransform("rectangular-pattern", "s", [circle], defaults).picking).toBeNull();
  });

  it("circular pattern: objects, center, count and angle, previewed before OK", () => {
    const { sketch, circle } = setup();
    let t = startTransform("circular-pattern", "s", [], defaults);
    expect(transformResult(sketch, t, evaluate)).toEqual({ ok: false, problem: "Select the objects" });
    t = pickInto(t, { entity: circle, entityType: "circle" });
    expect(t.objects).toEqual([circle]);
    expect(transformResult(sketch, t, evaluate)).toEqual({ ok: false, problem: "Pick the center point" });
    t = { ...t, picking: "center" };
    t = pickInto(t, { point: { position: { x: 0, y: 0 } } });
    expect(t.picking).toBeNull();
    t = { ...t, values: { ...t.values, count: "6" } };
    const r = transformResult(sketch, t, evaluate);
    expect(r.ok && curves(r.sketch, "circle")).toHaveLength(6);
    t = { ...t, values: { ...t.values, count: "1.5" } };
    expect(transformResult(sketch, t, evaluate)).toMatchObject({ ok: false, problem: expect.stringContaining("whole number") });
  });

  it("mirror takes a line, move and copy take From and To", () => {
    const { sketch, circle, axis } = setup();
    let m = startTransform("mirror", "s", [circle], defaults);
    expect(m.picking).toBe("axis");
    m = pickInto(m, { entity: circle, entityType: "circle" });
    expect(m.axis).toBeNull();
    m = pickInto(m, { entity: axis, entityType: "line" });
    const mirrored = transformResult(sketch, m, evaluate);
    expect(mirrored.ok && curves(mirrored.sketch, "circle")).toHaveLength(2);

    let c = startTransform("copy", "s", [circle], defaults);
    c = pickInto(c, { point: { position: { x: 20, y: 0 } } });
    c = pickInto(c, { point: { position: { x: 20, y: 15 } } });
    expect(c.values).toMatchObject({ dx: "0", dy: "15" });
    const copied = transformResult(sketch, c, evaluate);
    expect(copied.ok && curves(copied.sketch, "circle")).toHaveLength(2);
    const moved = transformResult(sketch, { ...c, tool: "move" }, evaluate);
    expect(moved.ok && curves(moved.sketch, "circle")).toHaveLength(1);
  });

  it("rectangular pattern in rows and columns", () => {
    const { sketch, circle } = setup();
    const t = startTransform("rectangular-pattern", "s", [circle], defaults);
    const r = transformResult(sketch, { ...t, values: { ...t.values, countX: "3", countY: "2" } }, evaluate);
    expect(r.ok && curves(r.sketch, "circle")).toHaveLength(6);
  });
});
