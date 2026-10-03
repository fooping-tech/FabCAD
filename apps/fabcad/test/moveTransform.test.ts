import { describe, expect, it } from "vitest";
import { freeMoveSteps } from "@fabcad/features";
import type { Vec3 } from "@fabcad/geometry";
import {
  type Mat4,
  IDENTITY,
  anglesOf,
  applyMatrix,
  invertRigid,
  multiply,
  rotationMatrix,
  stepsMatrix,
  turnAngles,
  worldAxis,
} from "../src/app/moveTransform";

const O = { x: 0, y: 0, z: 0 };
const rotation = (angles: Vec3): Mat4 => stepsMatrix(freeMoveSteps(O, O, angles));
const expectMatrix = (a: Mat4, b: Mat4): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
const expectPoint = (a: Vec3, b: Vec3): void => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

describe("move matrices", () => {
  it("turns counter-clockwise about an axis through a point", () => {
    const m = rotationMatrix({ x: 5, y: 10, z: 0 }, worldAxis(2), 90);
    expectPoint(applyMatrix(m, { x: 15, y: 10, z: 3 }), { x: 5, y: 20, z: 3 });
    expectPoint(applyMatrix(m, { x: 5, y: 10, z: 7 }), { x: 5, y: 10, z: 7 });
  });

  it("applies free move steps in order: X, Y, Z about the pivot, then the translation", () => {
    const pivot = { x: 1, y: 2, z: 3 };
    const m = stepsMatrix(freeMoveSteps(pivot, { x: 10, y: 0, z: 0 }, { x: 90, y: 0, z: 90 }));
    // (1, 0, 0) from the pivot: X leaves it, Z turns it to (0, 1, 0); then 10 along X.
    expectPoint(applyMatrix(m, { x: 2, y: 2, z: 3 }), { x: 11, y: 3, z: 3 });
    expectPoint(applyMatrix(m, pivot), { x: 11, y: 2, z: 3 });
  });

  it("inverts a rigid move", () => {
    const m = stepsMatrix(freeMoveSteps({ x: 3, y: -4, z: 2 }, { x: 7, y: 8, z: -9 }, { x: 20, y: -35, z: 110 }));
    expectMatrix(multiply(invertRigid(m), m), IDENTITY);
  });

  it("finds the angles of a rotation again", () => {
    for (const angles of [
      { x: 20, y: -35, z: 110 },
      { x: 0, y: 0, z: -45 },
      { x: 170, y: 10, z: 0 },
    ]) {
      const found = anglesOf(rotation(angles));
      expectMatrix(rotation(found), rotation(angles));
      expectPoint(found, angles);
    }
  });

  it("adds a turn about one world axis to the angles", () => {
    // Only one angle changes where that is enough.
    expect(turnAngles({ x: 10, y: 20, z: 30 }, 2, 15)).toEqual({ x: 10, y: 20, z: 45 });
    expect(turnAngles({ x: 10, y: 20, z: 0 }, 1, 15)).toEqual({ x: 10, y: 35, z: 0 });
    expect(turnAngles({ x: 10, y: 0, z: 0 }, 0, 15)).toEqual({ x: 25, y: 0, z: 0 });
    // Otherwise the combined rotation is what counts.
    for (const [start, axis] of [
      [{ x: 0, y: 0, z: 30 }, 0],
      [{ x: 15, y: 0, z: 40 }, 1],
      [{ x: 10, y: 25, z: 0 }, 0],
    ] as const) {
      const turned = turnAngles(start, axis, 30);
      expectMatrix(rotation(turned), multiply(rotationMatrix(O, worldAxis(axis), 30), rotation(start)));
    }
  });
});
