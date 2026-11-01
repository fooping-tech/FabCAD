import { describe, expect, it } from "vitest";
import { dotSeparation, eyesFor, heightsOf, randomDots } from "../src/viewport/randomDot";

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
    expect(eyesFor(50)).toBe(24);
    expect(eyesFor(3000)).toBe(120);
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

  it("uses the same dots for the same view", () => {
    const heights = new Float32Array(WIDTH * 2).fill(0.5);
    const n = noise(WIDTH * 2);
    expect(randomDots(heights, WIDTH, EYES, n)).toEqual(randomDots(heights, WIDTH, EYES, n));
  });
});
