import { describe, expect, it } from "vitest";
import type { Curve2 } from "@fabcad/geometry";
import { renderCurvesDxf } from "../src/curves";

/** Group code / value pairs of every entity, by entity type. */
function entities(dxf: string): { type: string; values: Record<number, string[]> }[] {
  const lines = dxf.trim().split("\n");
  const start = lines.findIndex((l, i) => l === "ENTITIES" && lines[i - 1] === "2");
  const out: { type: string; values: Record<number, string[]> }[] = [];
  for (let i = start + 1; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = lines[i + 1]!;
    if (code === 0) {
      if (value === "ENDSEC") break;
      out.push({ type: value, values: {} });
    } else {
      const e = out[out.length - 1]!;
      (e.values[code] ??= []).push(value);
    }
  }
  return out;
}

const n = (e: { values: Record<number, string[]> }, code: number): number => Number(e.values[code]![0]);

describe("renderCurvesDxf", () => {
  it("writes lines, circles and arcs as exact entities in millimetres", () => {
    const curves: Curve2[] = [
      { type: "line", a: { x: 0, y: 0 }, b: { x: 100, y: 80 } },
      { type: "arc", center: { x: 30, y: 30 }, radius: 10, startAngle: 0, sweep: 2 * Math.PI },
      { type: "arc", center: { x: 5, y: 5 }, radius: 8, startAngle: 0, sweep: Math.PI / 2 },
      // Clockwise from 90° to 0°: the same quarter, written counter-clockwise.
      { type: "arc", center: { x: 5, y: 5 }, radius: 8, startAngle: Math.PI / 2, sweep: -Math.PI / 2 },
    ];
    const dxf = renderCurvesDxf(curves.map((c) => ({ curves: [c] })));
    expect(dxf).toContain("$INSUNITS\n70\n4\n");
    expect(dxf.endsWith("0\nEOF\n")).toBe(true);
    const list = entities(dxf);
    expect(list.map((e) => e.type)).toEqual(["LINE", "CIRCLE", "ARC", "ARC"]);
    const [line, circle, a1, a2] = list as [(typeof list)[0], (typeof list)[0], (typeof list)[0], (typeof list)[0]];
    // Y is not flipped: DXF is Y-up like the sketch.
    expect([n(line, 10), n(line, 20), n(line, 11), n(line, 21)]).toEqual([0, 0, 100, 80]);
    expect([n(circle, 10), n(circle, 20), n(circle, 40)]).toEqual([30, 30, 10]);
    for (const a of [a1, a2]) expect([n(a, 40), n(a, 50), n(a, 51)]).toEqual([8, 0, 90]);
    expect(list.every((e) => e.values[8]![0] === "CUT")).toBe(true);
  });

  it("approximates ellipses and splines by polylines within the tolerance", () => {
    const ellipse: Curve2 = {
      type: "ellipseArc",
      center: { x: 0, y: 0 },
      rx: 20,
      ry: 10,
      rotation: 0,
      startParam: 0,
      sweep: 2 * Math.PI,
    };
    const list = entities(renderCurvesDxf([{ curves: [ellipse] }], { tolerance: 0.01 }));
    expect(list[0]!.type).toBe("POLYLINE");
    expect(list[0]!.values[70]![0]).toBe("1");
    const vertices = list.filter((e) => e.type === "VERTEX");
    expect(vertices.length).toBeGreaterThan(40);
    for (const v of vertices) {
      const x = n(v, 10);
      const y = n(v, 20);
      expect((x * x) / 400 + (y * y) / 100).toBeCloseTo(1, 3);
    }
    // A spline made of two Béziers is one open polyline.
    const spline: Curve2[] = [
      { type: "bezier", p0: { x: 0, y: 0 }, p1: { x: 5, y: 10 }, p2: { x: 10, y: 10 }, p3: { x: 15, y: 0 } },
      { type: "bezier", p0: { x: 15, y: 0 }, p1: { x: 20, y: -10 }, p2: { x: 25, y: -10 }, p3: { x: 30, y: 0 } },
    ];
    const s = entities(renderCurvesDxf([{ curves: spline }]));
    expect(s.filter((e) => e.type === "POLYLINE")).toHaveLength(1);
    expect(s[0]!.values[70]![0]).toBe("0");
    expect(entities(renderCurvesDxf([]))).toEqual([]);
  });
});
