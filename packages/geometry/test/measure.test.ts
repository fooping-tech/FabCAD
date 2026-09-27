import { describe, expect, it } from "vitest";
import { type MeasureItem, formatMeasure, measureBetween, measureItem } from "../src/measure";

const get = (values: { id: string; value: number }[], id: string): number | undefined =>
  values.find((v) => v.id === id)?.value;
const p = (x: number, y: number, z: number): MeasureItem => ({ kind: "point", at: { x, y, z } });
const seg = (a: [number, number, number], b: [number, number, number]): MeasureItem => ({
  kind: "segment",
  from: { x: a[0], y: a[1], z: a[2] },
  to: { x: b[0], y: b[1], z: b[2] },
});
const plane = (z: number, normal = { x: 0, y: 0, z: 1 }): MeasureItem => ({
  kind: "plane",
  point: { x: 0, y: 0, z },
  normal,
  area: 100,
  perimeter: 40,
  points: [
    { x: 0, y: 0, z },
    { x: 10, y: 0, z },
    { x: 10, y: 10, z },
    { x: 0, y: 10, z },
    { x: 0, y: 0, z },
  ],
});

describe("measure", () => {
  it("point to point", () => {
    const r = measureBetween(p(0, 0, 0), p(3, 4, 12));
    expect(get(r.values, "distance")).toBeCloseTo(13);
    expect(get(r.values, "dx")).toBe(3);
    expect(get(r.values, "dz")).toBe(12);
  });

  it("point to line", () => {
    const r = measureBetween(p(5, 7, 0), seg([0, 0, 0], [10, 0, 0]));
    expect(get(r.values, "distance")).toBeCloseTo(7);
    expect(r.line?.to).toEqual({ x: 5, y: 0, z: 0 });
  });

  it("parallel lines give the perpendicular distance", () => {
    const r = measureBetween(seg([0, 0, 0], [10, 0, 0]), seg([50, 6, 0], [60, 6, 0]));
    expect(get(r.values, "distance")).toBeCloseTo(6);
    expect(get(r.values, "angle")).toBeCloseTo(0);
  });

  it("angle between lines", () => {
    const r = measureBetween(seg([0, 0, 0], [10, 0, 0]), seg([0, 0, 0], [5, 5, 0]));
    expect(get(r.values, "angle")).toBeCloseTo(45);
    expect(get(r.values, "distance")).toBeCloseTo(0);
  });

  it("length, radius, diameter, area", () => {
    expect(get(measureItem(seg([0, 0, 0], [3, 4, 0])), "length")).toBeCloseTo(5);
    const circle: MeasureItem = {
      kind: "circle",
      center: { x: 0, y: 0, z: 0 },
      radius: 5,
      length: 10 * Math.PI,
      closed: true,
      points: [],
    };
    const values = measureItem(circle);
    expect(get(values, "radius")).toBe(5);
    expect(get(values, "diameter")).toBe(10);
    expect(get(values, "area")).toBeCloseTo(25 * Math.PI);
    expect(get(measureItem(plane(0)), "area")).toBe(100);
  });

  it("parallel faces give the distance, inclined faces the angle", () => {
    const r = measureBetween(plane(0, { x: 0, y: 0, z: -1 }), plane(18));
    expect(get(r.values, "distance")).toBeCloseTo(18);
    expect(get(r.values, "angle")).toBeCloseTo(0);
    const side: MeasureItem = {
      kind: "plane",
      point: { x: 10, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      area: 1,
      points: [
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
    };
    expect(get(measureBetween(plane(0), side).values, "angle")).toBeCloseTo(90);
  });

  it("point to face", () => {
    expect(get(measureBetween(p(3, 3, 7), plane(2)).values, "distance")).toBeCloseTo(5);
  });

  it("formats values for copying", () => {
    expect(formatMeasure({ id: "a", label: "A", value: 1500, unit: "mm" })).toBe("1500 mm");
    expect(formatMeasure({ id: "a", label: "A", value: 12.3456789, unit: "mm" })).toBe("12.346 mm");
    expect(formatMeasure({ id: "a", label: "A", value: 45, unit: "°" })).toBe("45 °");
  });
});
