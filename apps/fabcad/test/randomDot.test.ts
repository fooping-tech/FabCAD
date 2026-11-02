import { describe, expect, it } from "vitest";
import { dotSeparation, eyesFor, heightsOf, outlineDots, randomDots } from "../src/viewport/randomDot";

const WIDTH = 240;
const EYES = 40;
const noise = (n: number): Uint8Array => {
  // A fixed generator, so that the test does not depend on luck.
  let s = 12345;
  return Uint8Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >> 16) & 1;
  });
};

/** The share of dots of `dots` equal to the dot `s` to their right, over [from, to). */
const repeats = (dots: Uint8Array, s: number, from: number, to: number): number => {
  let same = 0;
  for (let x = from; x < to; x++) if (dots[x] === dots[x + s]) same++;
  return same / (to - from);
};

describe("random-dot stereogram", () => {
  it("makes the separation smaller for what is nearer", () => {
    expect(dotSeparation(1, EYES)).toBeLessThan(dotSeparation(0, EYES));
    expect(dotSeparation(0, EYES)).toBe(EYES / 2);
  });

  it("scales the eyes with the image, within limits", () => {
    expect(eyesFor(600)).toBe(100);
    expect(eyesFor(50)).toBe(48);
    expect(eyesFor(3000)).toBe(240);
  });

  it("maps the nearest point to 1 and leaves the background at 0, below the model", () => {
    const h = heightsOf(Float32Array.from([Infinity, 100, 150, 200]));
    expect(h[0]).toBe(0);
    expect(h[1]).toBe(1);
    expect(h[3]).toBeGreaterThan(0);
    expect(h[2]!).toBeGreaterThan(h[3]!);
  });

  it("repeats at the separation of the height, so the depth can be read back", () => {
    const heights = new Float32Array(WIDTH);
    heights.fill(1, 100, 180);
    const dots = randomDots(heights, WIDTH, EYES, noise(WIDTH));
    const far = dotSeparation(0, EYES);
    const near = dotSeparation(1, EYES);
    expect(repeats(dots, far, 0, 70)).toBe(1);
    expect(repeats(dots, near, 110, 165)).toBeGreaterThan(0.95);
    expect(repeats(dots, far, 110, 165)).toBeLessThan(0.8);
  });

  it("shows a depth between two whole separations in the grey of the dots", () => {
    const heights = new Float32Array(WIDTH);
    const fine = 4;
    // Over the range of EYES the whole separation stays the same, the fine one does not.
    const pattern = (h: number): Uint8Array => randomDots(heights.fill(h), WIDTH, EYES, noise(WIDTH), fine);
    const near = [0, 0.05, 0.1, 0.15, 0.2].map((h) => dotSeparation(h, EYES));
    expect(new Set(near).size).toBeLessThan(3);
    expect(new Set([0, 0.05, 0.1, 0.15, 0.2].map((h) => dotSeparation(h, EYES * fine))).size).toBeGreaterThan(2);
    expect(pattern(0.15)).not.toEqual(pattern(0.2));
    expect(pattern(0.15).some((v) => v > 0 && v < fine)).toBe(true);
  });

  it("marks both dots of the pair of a silhouette, and nothing on a flat slope", () => {
    const rows = 9;
    const heights = new Float32Array(WIDTH * rows);
    const flat = new Float32Array(WIDTH * rows);
    for (let y = 0; y < rows; y++) {
      heights.fill(1, y * WIDTH + 100, y * WIDTH + 180);
      for (let x = 0; x < WIDTH; x++) flat[y * WIDTH + x] = 0.4 + (0.3 * x) / WIDTH;
    }
    expect(outlineDots(flat, WIDTH, EYES, 1).every((v) => v === 0)).toBe(true);
    const marked = outlineDots(heights, WIDTH, EYES, 1);
    const row = 4 * WIDTH;
    const s = dotSeparation(1, EYES);
    const left = 100 - (s >> 1);
    expect(marked[row + left]).toBe(1);
    expect(marked[row + left + s]).toBe(1);
    expect(marked[row + 140]).toBe(0);
  });

  it("uses the same dots for the same view", () => {
    const heights = new Float32Array(WIDTH * 2).fill(0.5);
    const n = noise(WIDTH * 2);
    expect(randomDots(heights, WIDTH, EYES, n)).toEqual(randomDots(heights, WIDTH, EYES, n));
  });
});
