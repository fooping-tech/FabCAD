import type { Vec3 } from "@fabcad/geometry";

/**
 * Assembly data model. The MVP uses a single root component, but documents are structured as
 * components + instances + joints from day one so that assemblies do not require a migration.
 */

/** Row-major 4×4 rigid transform. */
export type Transform = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export const IDENTITY_TRANSFORM: Transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A component owns sketches, features and bodies (they point back through `componentId`). */
export interface Component {
  id: string;
  name: string;
}

/** Placement of a component inside a parent component. */
export interface ComponentInstance {
  id: string;
  name: string;
  componentId: string;
  /** Component that contains this instance; null for the root instance. */
  parentInstanceId: string | null;
  transform: Transform;
  visible: boolean;
}

export type JointType = "rigid" | "revolute" | "slider" | "cylindrical" | "planar" | "ball";

export interface JointFrame {
  instanceId: string;
  origin: Vec3;
  /** Primary axis of the joint (rotation axis or slide direction). */
  axis: Vec3;
  /** Reference direction perpendicular to the axis. */
  reference: Vec3;
}

export interface Joint {
  id: string;
  name: string;
  type: JointType;
  a: JointFrame;
  b: JointFrame;
  /** Current joint value: degrees for revolute, mm for slider. */
  value: number;
  limits?: { min: number; max: number };
  suppressed: boolean;
}

/** Instances that move as one. */
export interface RigidGroup {
  id: string;
  name: string;
  instanceIds: string[];
}

export interface AssemblyModel {
  rootComponentId: string;
  components: Record<string, Component>;
  instances: Record<string, ComponentInstance>;
  joints: Record<string, Joint>;
  rigidGroups: Record<string, RigidGroup>;
}

export const ROOT_COMPONENT_ID = "component-root";
export const ROOT_INSTANCE_ID = "instance-root";

export function createAssembly(rootName = "Root"): AssemblyModel {
  return {
    rootComponentId: ROOT_COMPONENT_ID,
    components: { [ROOT_COMPONENT_ID]: { id: ROOT_COMPONENT_ID, name: rootName } },
    instances: {
      [ROOT_INSTANCE_ID]: {
        id: ROOT_INSTANCE_ID,
        name: rootName,
        componentId: ROOT_COMPONENT_ID,
        parentInstanceId: null,
        transform: IDENTITY_TRANSFORM,
        visible: true,
      },
    },
    joints: {},
    rigidGroups: {},
  };
}

export function addComponent(
  model: AssemblyModel,
  component: Component,
  instance: Omit<ComponentInstance, "componentId">,
): AssemblyModel {
  return {
    ...model,
    components: { ...model.components, [component.id]: component },
    instances: {
      ...model.instances,
      [instance.id]: { ...instance, componentId: component.id },
    },
  };
}

export function addInstance(model: AssemblyModel, instance: ComponentInstance): AssemblyModel {
  if (!model.components[instance.componentId]) {
    throw new Error(`Unknown component: ${instance.componentId}`);
  }
  return { ...model, instances: { ...model.instances, [instance.id]: instance } };
}

export function addJoint(model: AssemblyModel, joint: Joint): AssemblyModel {
  return { ...model, joints: { ...model.joints, [joint.id]: joint } };
}

export function removeComponent(model: AssemblyModel, componentId: string): AssemblyModel {
  if (componentId === model.rootComponentId) return model;
  const components = { ...model.components };
  delete components[componentId];
  const removedInstances = new Set(
    Object.values(model.instances)
      .filter((i) => i.componentId === componentId)
      .map((i) => i.id),
  );
  const instances = Object.fromEntries(
    Object.entries(model.instances).filter(([id]) => !removedInstances.has(id)),
  );
  const joints = Object.fromEntries(
    Object.entries(model.joints).filter(
      ([, j]) => !removedInstances.has(j.a.instanceId) && !removedInstances.has(j.b.instanceId),
    ),
  );
  return { ...model, components, instances, joints };
}

export function multiplyTransforms(a: Transform, b: Transform): Transform {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  }
  return out as Transform;
}

export function translation(v: Vec3): Transform {
  return [1, 0, 0, v.x, 0, 1, 0, v.y, 0, 0, 1, v.z, 0, 0, 0, 1];
}

export function transformPoint(t: Transform, p: Vec3): Vec3 {
  return {
    x: t[0] * p.x + t[1] * p.y + t[2] * p.z + t[3],
    y: t[4] * p.x + t[5] * p.y + t[6] * p.z + t[7],
    z: t[8] * p.x + t[9] * p.y + t[10] * p.z + t[11],
  };
}

/** World transform of an instance: product of the transforms along its parent chain. */
export function instanceWorldTransform(model: AssemblyModel, instanceId: string): Transform {
  let t: Transform = IDENTITY_TRANSFORM;
  let cur: ComponentInstance | undefined = model.instances[instanceId];
  let guard = 0;
  while (cur && guard++ < 1000) {
    t = multiplyTransforms(cur.transform, t);
    cur = cur.parentInstanceId ? model.instances[cur.parentInstanceId] : undefined;
  }
  return t;
}

export function childInstances(model: AssemblyModel, parentInstanceId: string): ComponentInstance[] {
  return Object.values(model.instances).filter((i) => i.parentInstanceId === parentInstanceId);
}
