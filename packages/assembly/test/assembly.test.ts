import { describe, expect, it } from "vitest";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  anglesFromQuaternion,
  instanceMatrix,
  instanceTransformFromMatrix,
  quaternionFromAngles,
  ROOT_INSTANCE_ID,
  addComponent,
  addJoint,
  childInstances,
  createAssembly,
  instanceWorldTransform,
  removeComponent,
  transformPoint,
} from "../src";

const at = (x: number, y: number, z: number) => ({
  position: [x, y, z] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
});

describe("assembly model", () => {
  it("starts with a root component and instance", () => {
    const a = createAssembly("Root");
    expect(Object.keys(a.components)).toEqual([a.rootComponentId]);
    expect(a.instances[ROOT_INSTANCE_ID]!.transform).toEqual(IDENTITY_INSTANCE_TRANSFORM);
  });

  it("nests instances and composes their transforms", () => {
    let a = createAssembly();
    a = addComponent(
      a,
      { id: "c1", name: "Bracket" },
      {
        id: "i1",
        name: "Bracket:1",
        parentInstanceId: ROOT_INSTANCE_ID,
        transform: at(10, 0, 0),
        visible: true,
      },
    );
    a = addComponent(
      a,
      { id: "c2", name: "Pin" },
      {
        id: "i2",
        name: "Pin:1",
        parentInstanceId: "i1",
        transform: at(0, 5, 0),
        visible: true,
      },
    );
    expect(childInstances(a, ROOT_INSTANCE_ID).map((i) => i.id)).toEqual(["i1"]);
    const world = instanceWorldTransform(a, "i2");
    expect(transformPoint(world, { x: 1, y: 1, z: 1 })).toEqual({ x: 11, y: 6, z: 1 });

    a = addJoint(a, {
      id: "j1",
      name: "Revolute1",
      type: "revolute",
      a: { instanceId: "i1", origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, reference: { x: 1, y: 0, z: 0 } },
      b: { instanceId: "i2", origin: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, reference: { x: 1, y: 0, z: 0 } },
      value: 0,
      suppressed: false,
    });
    const removed = removeComponent(a, "c2");
    expect(removed.instances.i2).toBeUndefined();
    expect(removed.joints.j1).toBeUndefined();
    expect(removeComponent(a, a.rootComponentId)).toBe(a);
  });

  it("turns instances by angles about X, then Y, then Z", () => {
    const q = quaternionFromAngles(0, 0, 90);
    const m = instanceMatrix({ position: [5, 0, 0], rotation: q });
    const p = transformPoint(m, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(0);
    // X first, then Z: the Y axis turned about X becomes Z, and stays there.
    const xz = instanceMatrix({ position: [0, 0, 0], rotation: quaternionFromAngles(90, 0, 90) });
    const y = transformPoint(xz, { x: 0, y: 1, z: 0 });
    expect([y.x, y.y, y.z].map((v) => Math.round(v) + 0)).toEqual([0, 0, 1]);
    const angles = anglesFromQuaternion(quaternionFromAngles(10, -20, 30));
    expect(angles[0]).toBeCloseTo(10);
    expect(angles[1]).toBeCloseTo(-20);
    expect(angles[2]).toBeCloseTo(30);
  });

  it("reads the matrices instances were stored as before", () => {
    const t = { position: [1, 2, 3] as [number, number, number], rotation: quaternionFromAngles(30, 40, -50) };
    const back = instanceTransformFromMatrix(instanceMatrix(t));
    expect(back.position).toEqual([1, 2, 3]);
    back.rotation.forEach((v, k) => expect(v).toBeCloseTo(t.rotation[k]!));
  });
});
