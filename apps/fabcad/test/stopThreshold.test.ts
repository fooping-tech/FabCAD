import { describe, expect, it } from "vitest";
import { stopAfterSeconds } from "../src/app/stopThreshold";

describe("when Stop is offered", () => {
  it("waits 8 s for a model whose computations are short or unknown", () => {
    expect(stopAfterSeconds(0)).toBe(8);
    expect(stopAfterSeconds(3_000)).toBe(8);
  });

  it("waits twice the longest computation of a large model", () => {
    expect(stopAfterSeconds(5_000)).toBe(10);
    expect(stopAfterSeconds(15_200)).toBe(31);
  });
});
