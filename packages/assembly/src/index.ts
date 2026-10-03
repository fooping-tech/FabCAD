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

/**
 * Rigid placement of an instance: turned by the unit quaternion `rotation` ([x, y, z, w]) about
 * the origin of its component, then moved by `position` (mm).
 */
export interface InstanceTransform {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export const IDENTITY_INSTANCE_TRANSFORM: InstanceTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

/**
 * A component definition. It owns sketches, features and bodies: they point back through
 * their `componentId`, so what a definition contains is never stored twice.
 */
export interface Component {
  id: string;
  name: string;
}

/**
 * Placement of a component definition. Every instance shows the same geometry, the one the
 * definition's features produce; an instance only adds where it is and whether it is shown.
 */
export interface ComponentInstance {
  id: string;
  name: string;
  /** The definition this is an instance of. */
  componentId: string;
  /** Component that contains this instance; null for the root instance. */
  parentInstanceId: string | null;
  transform: InstanceTransform;
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
        transform: IDENTITY_INSTANCE_TRANSFORM,
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

/** Row-major 4×4 matrix of an instance placement. */
export function instanceMatrix(t: InstanceTransform): Transform {
  const [x, y, z, w] = normalizeQuaternion(t.rotation);
  const [px, py, pz] = t.position;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), px,
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), py,
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), pz,
    0, 0, 0, 1,
  ];
}

/** Placement of a row-major rigid 4×4 matrix (the form instances were stored in before). */
export function instanceTransformFromMatrix(m: readonly number[]): InstanceTransform {
  const [m00 = 1, m01 = 0, m02 = 0, px = 0, m10 = 0, m11 = 1, m12 = 0, py = 0, m20 = 0, m21 = 0, m22 = 1, pz = 0] = m;
  const trace = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return { position: [px, py, pz], rotation: normalizeQuaternion(q) };
}

type Quaternion = [number, number, number, number];

function multiplyQuaternions(a: readonly number[], b: readonly number[]): Quaternion {
  const [ax, ay, az, aw] = a as Quaternion;
  const [bx, by, bz, bw] = b as Quaternion;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function rotateByQuaternion(q: readonly number[], v: readonly number[]): [number, number, number] {
  const [x, y, z, w] = normalizeQuaternion(q);
  const r = multiplyQuaternions(multiplyQuaternions([x, y, z, w], [v[0]!, v[1]!, v[2]!, 0]), [-x, -y, -z, w]);
  return [r[0], r[1], r[2]];
}

/** `a` after `b`: a point is placed by `b` first, then by `a`. */
export function composeInstanceTransforms(a: InstanceTransform, b: InstanceTransform): InstanceTransform {
  const moved = rotateByQuaternion(a.rotation, b.position);
  return {
    position: [moved[0] + a.position[0], moved[1] + a.position[1], moved[2] + a.position[2]],
    rotation: normalizeQuaternion(multiplyQuaternions(a.rotation, b.rotation)),
  };
}

export function invertInstanceTransform(t: InstanceTransform): InstanceTransform {
  const [x, y, z, w] = normalizeQuaternion(t.rotation);
  const inverse: Quaternion = [-x, -y, -z, w];
  const p = rotateByQuaternion(inverse, t.position);
  return { position: [-p[0], -p[1], -p[2]], rotation: inverse };
}

/** Whether a placement leaves everything where it is (within `tolerance` mm / radians). */
export function isIdentityTransform(t: InstanceTransform, tolerance = 1e-9): boolean {
  const [x, y, z] = normalizeQuaternion(t.rotation);
  return Math.hypot(...t.position) <= tolerance && Math.hypot(x, y, z) <= tolerance;
}

export function normalizeQuaternion(q: readonly number[]): [number, number, number, number] {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const len = Math.hypot(x, y, z, w);
  return len < 1e-12 ? [0, 0, 0, 1] : [x / len, y / len, z / len, w / len];
}

const DEG = Math.PI / 180;

/**
 * Quaternion of a turn about the world X axis by `rx`, then about Y by `ry`, then about Z by
 * `rz` (degrees, counter-clockwise), the convention of the free Move.
 */
export function quaternionFromAngles(rx: number, ry: number, rz: number): [number, number, number, number] {
  const [cx, sx] = [Math.cos((rx * DEG) / 2), Math.sin((rx * DEG) / 2)];
  const [cy, sy] = [Math.cos((ry * DEG) / 2), Math.sin((ry * DEG) / 2)];
  const [cz, sz] = [Math.cos((rz * DEG) / 2), Math.sin((rz * DEG) / 2)];
  // q = qz · qy · qx
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/** Inverse of `quaternionFromAngles`: degrees about X, Y and Z. */
export function anglesFromQuaternion(q: readonly number[]): [number, number, number] {
  const [x, y, z, w] = normalizeQuaternion(q);
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const ry = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx / DEG, ry / DEG, rz / DEG];
}

/** World transform of an instance: product of the transforms along its parent chain. */
export function instanceWorldTransform(model: AssemblyModel, instanceId: string): Transform {
  let t: Transform = IDENTITY_TRANSFORM;
  let cur: ComponentInstance | undefined = model.instances[instanceId];
  let guard = 0;
  while (cur && guard++ < 1000) {
    t = multiplyTransforms(instanceMatrix(cur.transform), t);
    cur = cur.parentInstanceId ? model.instances[cur.parentInstanceId] : undefined;
  }
  return t;
}

export function childInstances(model: AssemblyModel, parentInstanceId: string): ComponentInstance[] {
  return Object.values(model.instances).filter((i) => i.parentInstanceId === parentInstanceId);
}
