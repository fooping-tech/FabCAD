import { describe, expect, it } from "vitest";
import { boundsOfPoints, signedArea } from "@fabcad/geometry";
import { type FlatPath, compensateKerf } from "../src";
import { rect } from "./fixtures";

const size = (p: FlatPath) => {
  const b = boundsOfPoints(p.points);
  return { w: b.maxX - b.minX, h: b.maxY - b.minY, b };
};

describe("kerf compensation", () => {
  const kerf = 0.2;
  const paths: FlatPath[] = [
    { type: "cut", role: "outline", points: rect(100, 50), closed: true },
    { type: "cut", role: "hole", points: rect(20, 10, 10, 10).reverse(), closed: true },
    { type: "cut", role: "slot", points: rect(16.5, 5.5, 50, 20), closed: true },
    { type: "fold", role: "fold", points: [{ x: 0, y: 25 }, { x: 100, y: 25 }], closed: false },
    { type: "engrave", role: "label", points: rect(5, 5, 80, 5), closed: true },
    { type: "cut", role: "outline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false },
    { type: "cut", role: "glue-tab", points: rect(30, 8, 0, 60), closed: true },
  ];
  const out = compensateKerf(paths, kerf);

  it("grows outlines by kerf / 2 on each side", () => {
    expect(size(out[0]!).w).toBeCloseTo(100 + kerf, 9);
    expect(size(out[0]!).h).toBeCloseTo(50 + kerf, 9);
    expect(size(out[0]!).b.minX).toBeCloseTo(-kerf / 2, 9);
    expect(size(out[6]!).w).toBeCloseTo(30 + kerf, 9);
  });

  it("shrinks holes and slots", () => {
    expect(size(out[1]!).w).toBeCloseTo(20 - kerf, 9);
    expect(size(out[1]!).h).toBeCloseTo(10 - kerf, 9);
    expect(size(out[2]!).w).toBeCloseTo(16.5 - kerf, 9);
    expect(size(out[2]!).h).toBeCloseTo(5.5 - kerf, 9);
  });

  it("handles either winding and keeps it", () => {
    const cw = compensateKerf(
      [{ type: "cut", role: "outline", points: rect(100, 50).reverse(), closed: true }],
      kerf,
    )[0]!;
    expect(size(cw).w).toBeCloseTo(100 + kerf, 9);
    expect(signedArea(cw.points)).toBeLessThan(0);
    expect(signedArea(out[1]!.points)).toBeLessThan(0);
    expect(signedArea(out[0]!.points)).toBeGreaterThan(0);
  });

  it("leaves open, fold and engrave paths alone and does not mutate the input", () => {
    expect(out[3]).toEqual(paths[3]);
    expect(out[4]).toEqual(paths[4]);
    expect(out[5]).toEqual(paths[5]);
    expect(size(paths[0]!).w).toBe(100);
    expect(compensateKerf(paths, 0)).toEqual(paths);
  });

  it("offsets concave outlines (L shape) correctly", () => {
    const l = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    const grown = compensateKerf([{ type: "cut", role: "outline", points: l, closed: true }], kerf)[0]!;
    expect(grown.points).toHaveLength(6);
    // inner corner moves by (kerf/2, kerf/2)
    expect(grown.points[3]!.x).toBeCloseTo(10 + kerf / 2, 9);
    expect(grown.points[3]!.y).toBeCloseTo(10 + kerf / 2, 9);
  });

  it("keeps slots narrower than the kerf unchanged", () => {
    const tiny = compensateKerf(
      [{ type: "cut", role: "slot", points: rect(0.1, 5), closed: true }],
      kerf,
    )[0]!;
    expect(tiny.points).toEqual(rect(0.1, 5));
  });
});
