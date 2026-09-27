import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  ROOT_INSTANCE_ID,
  addComponent,
  addJoint,
  childInstances,
  createAssembly,
  instanceWorldTransform,
  removeComponent,
  transformPoint,
  translation,
} from "../src";

describe("assembly model", () => {
  it("starts with a root component and instance", () => {
    const a = createAssembly("Root");
    expect(Object.keys(a.components)).toEqual([a.rootComponentId]);
    expect(a.instances[ROOT_INSTANCE_ID]!.transform).toEqual(IDENTITY_TRANSFORM);
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
        transform: translation({ x: 10, y: 0, z: 0 }),
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
        transform: translation({ x: 0, y: 5, z: 0 }),
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
});
