import {
  type ComponentInstance,
  IDENTITY_INSTANCE_TRANSFORM,
  type InstanceTransform,
  ROOT_INSTANCE_ID,
  normalizeQuaternion,
} from "@fabcad/assembly";
import { type CadDocument, allocateId } from "./document";
import {
  type Feature,
  featureConsumedBodies,
  featureCreatedBodies,
  featureInputBodies,
  featureInputFeatures,
  featureInputPlanes,
  featureInputSketches,
  featureOutputBodies,
  parseDynamicBodyId,
} from "./features";
import { removeFeatures } from "./commands";
import { type Command, command } from "./store";

/**
 * Components: reusable definitions (`assembly.components`) and their placed instances
 * (`assembly.instances`).
 *
 * A definition owns the sketches, features and bodies whose `componentId` names it. There is
 * one timeline for the whole document; the features of every definition are evaluated once,
 * in the coordinates of the definition, and every instance shows that geometry at its own
 * placement. Instances never copy history.
 *
 * The root component is the document itself: its bodies are where they are, and it has a
 * single instance (`ROOT_INSTANCE_ID`) that is never shown in the browser.
 */

export interface ComponentContents {
  sketchIds: string[];
  /** Every feature of the definition (sketches and construction planes included), in timeline order. */
  featureIds: string[];
  bodyIds: string[];
}

/** What a definition contains, read from the `componentId` of features and bodies. */
export function componentContents(doc: CadDocument, componentId: string): ComponentContents {
  const featureIds = doc.timeline.filter((id) => doc.features[id]?.componentId === componentId);
  return {
    sketchIds: featureIds.filter((id) => doc.features[id]?.type === "sketch"),
    featureIds,
    bodyIds: Object.values(doc.bodies)
      .filter((b) => b.componentId === componentId)
      .map((b) => b.id),
  };
}

/** Component definitions other than the root, in the order they were made. */
export function listComponents(doc: CadDocument): CadDocument["assembly"]["components"][string][] {
  return Object.values(doc.assembly.components).filter(
    (c) => c.id !== doc.assembly.rootComponentId,
  );
}

/** Instances of non-root definitions, optionally of one definition only. */
export function listInstances(doc: CadDocument, componentId?: string): ComponentInstance[] {
  return Object.values(doc.assembly.instances).filter(
    (i) =>
      i.id !== ROOT_INSTANCE_ID &&
      i.componentId !== doc.assembly.rootComponentId &&
      doc.assembly.components[i.componentId] !== undefined &&
      (componentId === undefined || i.componentId === componentId),
  );
}

/** `id` when it names a component of the document, the root component otherwise. */
export function validComponentId(doc: CadDocument, id: string | null | undefined): string {
  return id && doc.assembly.components[id] ? id : doc.assembly.rootComponentId;
}

function nextName(used: Iterable<string>, base: string): string {
  const taken = new Set(used);
  for (let i = 1; ; i++) {
    const name = `${base}${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Next "Frame:3" style instance name of a definition. */
function nextInstanceName(doc: CadDocument, componentId: string): string {
  const component = doc.assembly.components[componentId];
  const base = component?.name ?? "Component";
  return nextName(
    Object.values(doc.assembly.instances).map((i) => i.name),
    `${base}:`,
  );
}

function withInstance(
  doc: CadDocument,
  componentId: string,
  transform: InstanceTransform,
): [ComponentInstance, CadDocument] {
  const [id, d] = allocateId(doc, "instance");
  const instance: ComponentInstance = {
    id,
    name: nextInstanceName(doc, componentId),
    componentId,
    parentInstanceId: ROOT_INSTANCE_ID,
    transform,
    visible: true,
  };
  return [
    instance,
    { ...d, assembly: { ...d.assembly, instances: { ...d.assembly.instances, [id]: instance } } },
  ];
}

/**
 * Features that cannot be separated from `seeds`: those that write or read a body they write
 * or read, the sketches and planes they are built on, and the features built on those. Only
 * features of `componentId` are followed. Moving the result into another definition leaves no
 * reference from one definition into the other.
 */
export function entangledFeatures(
  doc: CadDocument,
  componentId: string,
  seeds: { featureIds?: readonly string[]; bodyIds?: readonly string[] },
): { featureIds: string[]; bodyIds: string[] } {
  const lookup = (id: string): Feature | undefined => doc.features[id];
  const own = Object.values(doc.features).filter((f) => f.componentId === componentId);
  const bodiesOf = (f: Feature): string[] => [
    ...featureInputBodies(f, lookup),
    ...featureOutputBodies(f, lookup),
    ...featureCreatedBodies(f),
    ...featureConsumedBodies(f),
  ];
  const refsOf = (f: Feature): string[] => [
    ...featureInputSketches(f),
    ...featureInputPlanes(f),
    ...featureInputFeatures(f),
  ];
  const features = new Set<string>();
  const bodies = new Set<string>();
  const queue: Feature[] = [];
  const addFeature = (id: string): void => {
    const f = doc.features[id];
    if (!f || f.componentId !== componentId || features.has(id)) return;
    features.add(id);
    queue.push(f);
  };
  const addBody = (id: string): void => {
    const b = doc.bodies[id];
    if (bodies.has(id)) return;
    if (b && b.componentId !== componentId) return;
    bodies.add(id);
    if (b) addFeature(b.createdBy);
    const dynamic = parseDynamicBodyId(id);
    if (dynamic) addFeature(dynamic.featureId);
    // Every feature of the component that touches the body.
    for (const f of own) if (bodiesOf(f).includes(id)) addFeature(f.id);
  };
  for (const id of seeds.featureIds ?? []) addFeature(id);
  for (const id of seeds.bodyIds ?? []) addBody(id);
  while (queue.length > 0) {
    const f = queue.pop()!;
    for (const b of bodiesOf(f)) addBody(b);
    for (const r of refsOf(f)) addFeature(r);
    // Features built on this one (an extrude of a sketch, a sketch on a plane …).
    for (const g of own) if (refsOf(g).includes(f.id)) addFeature(g.id);
  }
  // Bodies with a derived id (pattern instances …) go with the feature that makes them.
  for (const b of Object.values(doc.bodies)) {
    const dynamic = parseDynamicBodyId(b.id);
    if (dynamic && features.has(dynamic.featureId) && b.componentId === componentId) bodies.add(b.id);
  }
  return {
    featureIds: doc.timeline.filter((id) => features.has(id)),
    bodyIds: [...bodies].filter((id) => doc.bodies[id] !== undefined),
  };
}

export interface CreatedComponent {
  id?: string;
  instanceId?: string;
  /** Every instance made: one per instance of the component the selection came from. */
  instanceIds?: string[];
  /** Component the selection was taken out of. */
  sourceComponentId?: string;
  /** Features moved into the new definition (more than selected when they were entangled). */
  featureIds?: string[];
  bodyIds?: string[];
}

/**
 * New component definition with its instances.
 *
 * Selected bodies and features move into the definition together with everything they cannot
 * be separated from (`entangledFeatures`). They all have to belong to one component; the
 * command does nothing otherwise. They may come from the root or from another component: the
 * new definition gets an instance at every placement of the component they came from (one at
 * the origin for the root), so nothing moves on screen.
 */
export function createComponent(
  input: { name?: string; featureIds?: readonly string[]; bodyIds?: readonly string[] } = {},
  out: CreatedComponent = {},
): Command {
  return command("New component", (doc) => {
    const owners = new Set<string>();
    for (const id of input.featureIds ?? []) {
      const c = doc.features[id]?.componentId;
      if (c) owners.add(c);
    }
    for (const id of input.bodyIds ?? []) {
      const c = doc.bodies[id]?.componentId;
      if (c) owners.add(c);
    }
    if (owners.size > 1) return doc;
    const source = [...owners][0];
    const moved = source
      ? entangledFeatures(doc, source, input)
      : { featureIds: [] as string[], bodyIds: [] as string[] };

    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "component");
    const name =
      input.name?.trim() ||
      nextName(
        Object.values(doc.assembly.components).map((c) => c.name),
        "Component",
      );
    d = {
      ...d,
      assembly: { ...d.assembly, components: { ...d.assembly.components, [id]: { id, name } } },
    };
    if (moved.featureIds.length > 0) {
      const features = { ...d.features };
      for (const f of moved.featureIds) features[f] = { ...features[f]!, componentId: id };
      const bodies = { ...d.bodies };
      for (const b of moved.bodyIds) bodies[b] = { ...bodies[b]!, componentId: id };
      d = { ...d, features, bodies };
    }
    // Bodies taken out of a component are placed where that component's instances showed
    // them, so that nothing moves on screen. Root bodies, and new empty components, start at
    // the origin.
    const from =
      source && source !== doc.assembly.rootComponentId ? listInstances(doc, source) : [];
    const placements = from.length > 0 ? from : [{ transform: IDENTITY_INSTANCE_TRANSFORM, visible: true }];
    const instanceIds: string[] = [];
    for (const p of placements) {
      let instance: ComponentInstance;
      [instance, d] = withInstance(d, id, p.transform);
      if (!p.visible) {
        d = patchInstances(d, { [instance.id]: { ...instance, visible: false } });
      }
      instanceIds.push(instance.id);
    }
    out.id = id;
    out.instanceId = instanceIds[0];
    out.instanceIds = instanceIds;
    out.sourceComponentId = source;
    out.featureIds = moved.featureIds;
    out.bodyIds = moved.bodyIds;
    return d;
  });
}

/** One more instance of a definition, where `transform` puts it (the identity by default). */
export function createInstance(
  componentId: string,
  out: { id?: string } = {},
  transform: InstanceTransform = IDENTITY_INSTANCE_TRANSFORM,
): Command {
  return command("New instance", (doc) => {
    if (componentId === doc.assembly.rootComponentId || !doc.assembly.components[componentId]) {
      return doc;
    }
    const [instance, d] = withInstance(doc, componentId, transform);
    out.id = instance.id;
    return d;
  });
}

/** New instances of the same definitions at the same places: references, not copies. */
export function duplicateInstances(ids: readonly string[], out: { ids?: string[] } = {}): Command {
  return command(ids.length > 1 ? "Duplicate instances" : "Duplicate instance", (doc) => {
    let d = doc;
    const made: string[] = [];
    for (const id of ids) {
      const source = d.assembly.instances[id];
      if (!source || source.id === ROOT_INSTANCE_ID) continue;
      let instance: ComponentInstance;
      [instance, d] = withInstance(d, source.componentId, source.transform);
      made.push(instance.id);
    }
    out.ids = made;
    return made.length > 0 ? d : doc;
  });
}

/** Rename a definition. Instances called "<old name>:<n>" follow. */
export function renameComponent(id: string, name: string): Command {
  return command("Rename component", (doc) => {
    const c = doc.assembly.components[id];
    const next = name.trim();
    if (!c || id === doc.assembly.rootComponentId || next === "" || c.name === next) return doc;
    const prefix = `${c.name}:`;
    const instances = Object.fromEntries(
      Object.entries(doc.assembly.instances).map(([iid, i]) => [
        iid,
        i.componentId === id && i.name.startsWith(prefix)
          ? { ...i, name: `${next}:${i.name.slice(prefix.length)}` }
          : i,
      ]),
    );
    return {
      ...doc,
      assembly: {
        ...doc.assembly,
        components: { ...doc.assembly.components, [id]: { ...c, name: next } },
        instances,
      },
    };
  });
}

export function renameInstance(id: string, name: string): Command {
  return command("Rename instance", (doc) => {
    const i = doc.assembly.instances[id];
    const next = name.trim();
    if (!i || id === ROOT_INSTANCE_ID || next === "" || i.name === next) return doc;
    return patchInstances(doc, { [id]: { ...i, name: next } });
  });
}

const sameTransform = (a: InstanceTransform, b: InstanceTransform): boolean =>
  a.position.every((v, k) => v === b.position[k]) && a.rotation.every((v, k) => v === b.rotation[k]);

/** Place an instance. Non-command form, for the live preview of the Move window. */
export function applyInstanceTransform(
  doc: CadDocument,
  id: string,
  transform: InstanceTransform,
): CadDocument {
  const i = doc.assembly.instances[id];
  if (!i || id === ROOT_INSTANCE_ID) return doc;
  if (!transform.position.every(Number.isFinite) || !transform.rotation.every(Number.isFinite)) {
    return doc;
  }
  const next: InstanceTransform = {
    position: [...transform.position],
    rotation: normalizeQuaternion(transform.rotation),
  };
  if (sameTransform(i.transform, next)) return doc;
  return patchInstances(doc, { [id]: { ...i, transform: next } });
}

export function setInstanceTransform(id: string, transform: InstanceTransform): Command {
  return command("Move instance", (doc) => applyInstanceTransform(doc, id, transform));
}

export function setInstancesVisible(ids: readonly string[], visible: boolean): Command {
  return command(visible ? "Show instance" : "Hide instance", (doc) => {
    const patch: Record<string, ComponentInstance> = {};
    for (const id of ids) {
      const i = doc.assembly.instances[id];
      if (i && id !== ROOT_INSTANCE_ID && i.visible !== visible) patch[id] = { ...i, visible };
    }
    return Object.keys(patch).length > 0 ? patchInstances(doc, patch) : doc;
  });
}

/** Show or hide every instance of a definition. */
export function setComponentVisible(componentId: string, visible: boolean): Command {
  return command(visible ? "Show component" : "Hide component", (doc) =>
    setInstancesVisible(
      listInstances(doc, componentId).map((i) => i.id),
      visible,
    ).apply(doc),
  );
}

function patchInstances(doc: CadDocument, patch: Record<string, ComponentInstance>): CadDocument {
  return {
    ...doc,
    assembly: { ...doc.assembly, instances: { ...doc.assembly.instances, ...patch } },
  };
}

/** Delete instances. The definition stays, also without instances: it is not a copy. */
export function removeInstances(ids: readonly string[]): Command {
  return command(ids.length > 1 ? "Delete instances" : "Delete instance", (doc) => {
    const doomed = ids.filter((id) => id !== ROOT_INSTANCE_ID && doc.assembly.instances[id]);
    if (doomed.length === 0) return doc;
    const instances = { ...doc.assembly.instances };
    for (const id of doomed) delete instances[id];
    const joints = Object.fromEntries(
      Object.entries(doc.assembly.joints).filter(
        ([, j]) => instances[j.a.instanceId] && instances[j.b.instanceId],
      ),
    );
    return { ...doc, assembly: { ...doc.assembly, instances, joints } };
  });
}

/**
 * Delete definitions with everything they own (sketches, features, bodies) and all their
 * instances. Features of other components that referred to them report a missing input on
 * recompute, as after any other deletion.
 */
export function removeComponents(ids: readonly string[]): Command {
  return command(ids.length > 1 ? "Delete components" : "Delete component", (doc) => {
    const doomed = ids.filter(
      (id) => id !== doc.assembly.rootComponentId && doc.assembly.components[id],
    );
    if (doomed.length === 0) return doc;
    const features = doomed.flatMap((id) => componentContents(doc, id).featureIds);
    let d = features.length > 0 ? removeFeatures(features).apply(doc) : doc;
    const bodies = Object.fromEntries(
      Object.entries(d.bodies).filter(([, b]) => !doomed.includes(b.componentId)),
    );
    d = removeInstances(listInstances(d).filter((i) => doomed.includes(i.componentId)).map((i) => i.id)).apply(d);
    const components = { ...d.assembly.components };
    for (const id of doomed) delete components[id];
    return { ...d, bodies, assembly: { ...d.assembly, components } };
  });
}
