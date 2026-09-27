import { describe, expect, it } from "vitest";
import { windowBounds, windowMode, windowSelect } from "../src/window";

const items = [
  { id: "inside", points: [{ x: 2, y: 2 }, { x: 8, y: 2 }] },
  { id: "crossing", points: [{ x: 5, y: 5 }, { x: 20, y: 5 }] },
  { id: "through", points: [{ x: -5, y: 3 }, { x: 25, y: 4 }] },
  { id: "outside", points: [{ x: 20, y: 20 }, { x: 30, y: 20 }] },
  { id: "point-in", points: [{ x: 1, y: 1 }] },
  { id: "point-out", points: [{ x: 11, y: 1 }] },
];

describe("window selection", () => {
  it("left to right is a window, right to left is crossing", () => {
    expect(windowMode({ x: 0, y: 0 }, { x: 10, y: 5 })).toBe("window");
    expect(windowMode({ x: 10, y: 0 }, { x: 0, y: 5 })).toBe("crossing");
  });

  it("window selects only what is completely inside", () => {
    const rect = windowBounds({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(windowSelect(items, rect, "window")).toEqual(["inside", "point-in"]);
  });

  it("crossing selects everything the rectangle touches", () => {
    const rect = windowBounds({ x: 10, y: 10 }, { x: 0, y: 0 });
    expect(windowSelect(items, rect, "crossing")).toEqual([
      "inside",
      "crossing",
      "through",
      "point-in",
    ]);
  });

  it("a curve that surrounds the rectangle without touching it is not selected", () => {
    const ring = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      ring.push({ x: 5 + 20 * Math.cos(a), y: 5 + 20 * Math.sin(a) });
    }
    const rect = windowBounds({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(windowSelect([{ id: "ring", points: ring }], rect, "crossing")).toEqual([]);
    expect(windowSelect([{ id: "ring", points: ring }], rect, "window")).toEqual([]);
  });
});
