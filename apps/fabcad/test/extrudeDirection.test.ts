import { ORIGIN_PLANES, makePlane } from "@fabcad/geometry";
import { describe, expect, it } from "vitest";
import { directionForOperation, reachFromPlane } from "../src/app/extrudeDirection";

const top = makePlane({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
const plate = { min: { x: 0, y: 0, z: 0 }, max: { x: 60, y: 30, z: 3 } };

describe("default direction of an extrusion", () => {
  it("measures how far bodies reach to either side", () => {
    expect(reachFromPlane(top, [plate])).toEqual({ positive: 0, negative: 3 });
  });

  it("Cut on a face goes into the body", () => {
    expect(directionForOperation("positive", "join", "cut", top, [plate])).toBe("negative");
  });

  it("back to Join goes away from the body again", () => {
    expect(directionForOperation("negative", "cut", "join", top, [plate])).toBe("positive");
  });

  it("follows the body when it lies on the positive side", () => {
    const bottom = ORIGIN_PLANES.XY;
    expect(directionForOperation("negative", "new", "cut", bottom, [plate])).toBe("positive");
    expect(directionForOperation("positive", "new", "cut", bottom, [plate])).toBeNull();
  });

  it("leaves symmetric extrusions, bodies on both sides and Cut to Intersect alone", () => {
    expect(directionForOperation("symmetric", "join", "cut", top, [plate])).toBeNull();
    const middle = makePlane({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
    expect(directionForOperation("positive", "join", "cut", middle, [plate])).toBeNull();
    expect(directionForOperation("positive", "cut", "intersect", top, [plate])).toBeNull();
    expect(directionForOperation("positive", "join", "cut", top, [])).toBeNull();
  });
});
