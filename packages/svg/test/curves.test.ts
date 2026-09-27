import { describe, expect, it } from "vitest";
import type { Curve2 } from "@fabcad/geometry";
import { renderCurvesSvg } from "../src/curves";

const line = (ax: number, ay: number, bx: number, by: number): Curve2 => ({
  type: "line",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

describe("renderCurvesSvg", () => {
  it("writes millimetres, sized to the geometry, with Y flipped", () => {
    const svg = renderCurvesSvg(
      [{ curves: [line(0, 0, 100, 0), line(100, 0, 100, 80), line(100, 80, 0, 80), line(0, 80, 0, 0)] }],
      { margin: 0 },
    );
    expect(svg).toContain('width="100mm" height="80mm" viewBox="0 0 100 80"');
    expect(svg).toContain('<g id="cut"');
    // The sketch origin (bottom left) ends up at the bottom of the image.
    expect(svg).toContain('d="M0 80 L100 80 L100 0 L0 0 L0 80 Z"');
  });

  it("keeps arcs and circles exact", () => {
    const circle: Curve2 = {
      type: "arc",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngle: 0,
      sweep: 2 * Math.PI,
    };
    const svg = renderCurvesSvg([{ curves: [circle], id: "c1" }], { margin: 1 });
    expect(svg).toContain('width="22mm" height="22mm"');
    expect(svg).toContain('data-entity="c1"');
    expect(svg).toContain("M21 11 A10 10 0 0 0 1 11 A10 10 0 0 0 21 11 Z");

    // Quarter arc, counter-clockwise from (10, 0) to (0, 10): clockwise on the flipped image.
    const quarter: Curve2 = { ...circle, sweep: Math.PI / 2 };
    const q = renderCurvesSvg([{ curves: [quarter] }], { margin: 0 });
    expect(q).toContain("M10 10 A10 10 0 0 0 0 0");
    const back: Curve2 = { ...circle, startAngle: Math.PI / 2, sweep: -Math.PI / 2 };
    expect(renderCurvesSvg([{ curves: [back] }], { margin: 0 })).toContain("M0 0 A10 10 0 0 1 10 10");
  });

  it("writes Béziers and separate paths per entity", () => {
    const bezier: Curve2 = {
      type: "bezier",
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 },
      p3: { x: 10, y: 0 },
    };
    const svg = renderCurvesSvg([{ curves: [bezier] }, { curves: [line(20, 0, 30, 0)] }], {
      margin: 0,
      stroke: "#000",
    });
    expect((svg.match(/<path/g) ?? []).length).toBe(2);
    expect(svg).toContain("C0 ");
    expect(svg).toContain('stroke="#000"');
    expect(renderCurvesSvg([])).toContain("<svg");
  });
});
