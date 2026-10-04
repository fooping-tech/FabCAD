import {
  type ComponentInstance,
  IDENTITY_INSTANCE_TRANSFORM,
  type InstanceTransform,
  ROOT_INSTANCE_ID,
  anglesFromQuaternion,
  composeInstanceTransforms,
  invertInstanceTransform,
  isIdentityTransform,
  normalizeQuaternion,
} from "@fabcad/assembly";
import { type CadDocument, allocateId, consumedBodies } from "./document";
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
import { addMove, removeFeatures } from "./commands";
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

/** The name a new component gets when none is given: "Component3". */
export function nextComponentName(doc: CadDocument): string {
  return nextName(
    Object.values(doc.assembly.components).map((c) => c.name),
    "Component",
  );
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
 * Features that cannot be separated from `seeds`, and the bodies that go with them.
 *
 * Bodies are tied by the features that change them: a feature that adds to, cuts, fillets,
 * moves, uses up or makes a body belongs with it, and every body such a feature changes comes
 * along (an Extrude that joins into two bodies ties those two). Sketches and construction planes
 * go with the features that use them: they move when every feature built on them moves, or,
 * unused, when they lie on a face of a body that moves. Only reading geometry ties nothing: a
 * sketch on a face of another body, a projection, a plane based on a face, a direction or a
 * point may refer into another component. Only features of `componentId` are followed.
 *
 * `pulledBy` names, for each body that was not a seed, the feature that tied it to the rest.
 */
export function entangledFeatures(
  doc: CadDocument,
  componentId: string,
  seeds: { featureIds?: readonly string[]; bodyIds?: readonly string[] },
): { featureIds: string[]; bodyIds: string[]; pulledBy: Record<string, string> } {
  const lookup = (id: string): Feature | undefined => doc.features[id];
  const own = Object.values(doc.features).filter((f) => f.componentId === componentId);
  const isReference = (f: Feature): boolean => f.type === "sketch" || f.type === "offset-plane";
  const changes = (f: Feature): string[] => [
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
  const pulledBy: Record<string, string> = {};
  const queue: Feature[] = [];
  const addFeature = (id: string): void => {
    const f = doc.features[id];
    if (!f || f.componentId !== componentId || features.has(id)) return;
    features.add(id);
    queue.push(f);
  };
  const addBody = (id: string, via?: string): void => {
    const b = doc.bodies[id];
    if (bodies.has(id)) return;
    if (b && b.componentId !== componentId) return;
    bodies.add(id);
    if (via) pulledBy[id] = via;
    if (b) addFeature(b.createdBy);
    const dynamic = parseDynamicBodyId(id);
    if (dynamic) addFeature(dynamic.featureId);
    for (const f of own) if (!isReference(f) && changes(f).includes(id)) addFeature(f.id);
  };
  for (const id of seeds.featureIds ?? []) addFeature(id);
  for (const id of seeds.bodyIds ?? []) addBody(id);
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (isReference(f)) {
      // A selected sketch or plane takes along what is built on it.
      for (const g of own) if (refsOf(g).includes(f.id)) addFeature(g.id);
      continue;
    }
    for (const b of changes(f)) addBody(b, f.id);
    // Features whose recorded effect this one applies again (the sources of a pattern).
    for (const r of featureInputFeatures(f)) addFeature(r);
  }
  // Bodies with a derived id (pattern instances …) go with the feature that makes them.
  for (const b of Object.values(doc.bodies)) {
    const dynamic = parseDynamicBodyId(b.id);
    if (dynamic && features.has(dynamic.featureId) && b.componentId === componentId) bodies.add(b.id);
  }
  // Sketches and planes follow their users; unused ones the body they lie on.
  const all = Object.values(doc.features);
  const references = own.filter(isReference);
  const liesOnMovedBody = (f: Feature): boolean => {
    const base =
      f.type === "sketch" ? f.sketch.plane : f.type === "offset-plane" ? f.base : undefined;
    return base?.type === "face" && bodies.has(base.bodyId);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of references) {
      if (features.has(p.id)) continue;
      const users = all.filter((g) => refsOf(g).includes(p.id));
      const follows =
        users.length > 0 ? users.every((g) => features.has(g.id)) : liesOnMovedBody(p);
      if (follows) {
        features.add(p.id);
        changed = true;
      }
    }
  }
  return {
    featureIds: doc.timeline.filter((id) => features.has(id)),
    bodyIds: [...bodies].filter((id) => doc.bodies[id] !== undefined),
    pulledBy,
  };
}

export interface SeparationProblem {
  /** What to tell the user. */
  message: string;
  /** Features that change a selected body and another one: what ties the selection. */
  ties: string[];
  /** Further features through which more bodies come along. */
  chain: string[];
  /** Bodies that are not selected but would have to move. */
  bodyIds: string[];
}

/**
 * Why the selection cannot be taken out of its component on its own: a body that is not
 * selected (and not used up) would have to come along, because a feature changes both. The
 * features that tie a selected body to another one come first (`ties`); the ones through which
 * more bodies follow after (`chain`). Null when nothing else would move.
 */
export function separationProblem(
  doc: CadDocument,
  input: { featureIds?: readonly string[]; bodyIds?: readonly string[] },
): SeparationProblem | null {
  const source = sourceOf(doc, input);
  if (source === null) {
    return { message: "The selection belongs to different components.", ties: [], chain: [], bodyIds: [] };
  }
  if (source === undefined) return null;
  const moved = entangledFeatures(doc, source, input);
  const selected = new Set(input.bodyIds ?? []);
  const consumed = consumedBodies(doc);
  const extra = moved.bodyIds.filter((b) => !selected.has(b) && !consumed.has(b));
  if (extra.length === 0) return null;
  const lookup = (id: string): Feature | undefined => doc.features[id];
  const changes = (id: string): string[] => {
    const f = doc.features[id];
    return f
      ? [...featureOutputBodies(f, lookup), ...featureCreatedBodies(f), ...featureConsumedBodies(f)]
      : [];
  };
  const inTimeline = (ids: Iterable<string>): string[] => {
    const set = new Set(ids);
    return doc.timeline.filter((id) => set.has(id));
  };
  const vias = inTimeline(Object.values(moved.pulledBy));
  const direct = vias.filter((f) => changes(f).some((b) => selected.has(b)));
  const ties = direct.length > 0 ? direct : vias.slice(0, 1);
  const chain = vias.filter((f) => !ties.includes(f));
  const near = extra.filter((b) => ties.some((f) => changes(f).includes(b)));
  const far = extra.filter((b) => !near.includes(b));
  const body = (b: string): string => `"${doc.bodies[b]?.name ?? b}"`;
  const feature = (f: string): string => `"${doc.features[f]?.name ?? f}"`;
  const and = (xs: string[]): string =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const tied = ties.map(feature);
  let message =
    `${and(tied)} also ${ties.length === 1 ? "changes" : "change"} ${and(near.map(body))}, ` +
    `so ${near.length === 1 ? "it" : "they"} would have to move with the selection.`;
  if (far.length > 0) {
    message +=
      ` Through ${near.length === 1 ? "it" : "them"}, ${and(far.map(body))} would follow as well` +
      (chain.length > 0 ? ` (${and(chain.map(feature))}).` : ".");
  }
  message += ` Edit ${and(tied)} so that ${ties.length === 1 ? "it changes" : "each changes"} one body only, or select those bodies too.`;
  return { message, ties, chain, bodyIds: extra };
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
    const source = sourceOf(doc, input);
    if (source === null) return doc;
    const moved = source
      ? entangledFeatures(doc, source, input)
      : { featureIds: [] as string[], bodyIds: [] as string[] };

    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "component");
    const name = input.name?.trim() || nextComponentName(doc);
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

/** The one component that selected bodies and features belong to; null when they span several. */
function sourceOf(
  doc: CadDocument,
  input: { featureIds?: readonly string[]; bodyIds?: readonly string[] },
): string | null | undefined {
  const owners = new Set<string>();
  for (const id of input.featureIds ?? []) {
    const c = doc.features[id]?.componentId;
    if (c) owners.add(c);
  }
  for (const id of input.bodyIds ?? []) {
    const c = doc.bodies[id]?.componentId;
    if (c) owners.add(c);
  }
  if (owners.size > 1) return null;
  return [...owners][0];
}

/** Where a component is seen: the origin for the root, its first instance otherwise. */
function placementOf(doc: CadDocument, componentId: string): InstanceTransform | null {
  if (componentId === doc.assembly.rootComponentId) return IDENTITY_INSTANCE_TRANSFORM;
  return listInstances(doc, componentId)[0]?.transform ?? null;
}

/**
 * Where the geometry of component `from` lies as seen from component `to`, as a placement in
 * the coordinates of `to`. Each component is seen at its first instance (the root at the
 * origin); one without instances is taken to be at the origin. This is how a component that is
 * being edited sees the others, and how a sketch projects edges of another component's bodies.
 */
export function relativePlacement(
  doc: CadDocument,
  from: string,
  to: string,
  /** An instance of `from` to see it at, instead of its first one. */
  instanceId?: string,
): InstanceTransform {
  const instance = instanceId ? doc.assembly.instances[instanceId] : undefined;
  const at = instance && instance.componentId === from ? instance.transform : undefined;
  if (from === to && !at) return IDENTITY_INSTANCE_TRANSFORM;
  const a = at ?? placementOf(doc, from) ?? IDENTITY_INSTANCE_TRANSFORM;
  const b = placementOf(doc, to) ?? IDENTITY_INSTANCE_TRANSFORM;
  return composeInstanceTransforms(invertInstanceTransform(b), a);
}

const round = (v: number): string => String(Math.round(v * 1e6) / 1e6 + 0);

export interface MovedToComponent {
  featureIds?: string[];
  bodyIds?: string[];
  /** The Move step added to keep the bodies where they were seen; absent when none was needed. */
  moveId?: string;
}

/**
 * Give bodies (and features) to another existing component, together with everything they
 * cannot be separated from (`entangledFeatures`).
 *
 * The geometry lies in the coordinates of its definition. When the two components are placed
 * differently (the root at the origin, a component at its first instance), a free Move is
 * added at the end of the moved history that takes the bodies from the one placement to the
 * other, so that they stay where they were seen. It is an ordinary step of the timeline: it
 * can be edited or deleted like any other.
 */
export function moveToComponent(
  input: { featureIds?: readonly string[]; bodyIds?: readonly string[] },
  targetId: string,
  out: MovedToComponent = {},
): Command {
  return command("Move to component", (doc) => {
    const source = sourceOf(doc, input);
    if (!source || source === targetId || !doc.assembly.components[targetId]) return doc;
    const moved = entangledFeatures(doc, source, input);
    if (moved.featureIds.length === 0) return doc;
    const features = { ...doc.features };
    for (const f of moved.featureIds) features[f] = { ...features[f]!, componentId: targetId };
    const bodies = { ...doc.bodies };
    for (const b of moved.bodyIds) bodies[b] = { ...bodies[b]!, componentId: targetId };
    let d: CadDocument = { ...doc, features, bodies };
    out.featureIds = moved.featureIds;
    out.bodyIds = moved.bodyIds;

    const from = placementOf(doc, source);
    const to = placementOf(doc, targetId);
    if (!from || !to) return d;
    const change = composeInstanceTransforms(invertInstanceTransform(to), from);
    if (isIdentityTransform(change, 1e-9)) return d;
    const consumed = consumedBodies(d);
    const alive = moved.bodyIds.filter((b) => !consumed.has(b));
    if (alive.length === 0) return d;
    const [rx, ry, rz] = anglesFromQuaternion(change.rotation);
    const [x, y, z] = change.position;
    const ref: { id?: string } = {};
    d = addMove(
      {
        bodyIds: alive,
        transform: {
          type: "free",
          x: round(x),
          y: round(y),
          z: round(z),
          rx: round(rx),
          ry: round(ry),
          rz: round(rz),
          pivot: { x: 0, y: 0, z: 0 },
        },
      },
      ref,
    ).apply(d);
    if (!ref.id) return d;
    // Right after the last moved step, wherever the history marker is: the Move needs the
    // bodies as that history leaves them.
    const last = Math.max(...moved.featureIds.map((f) => doc.timeline.indexOf(f)));
    const timeline = doc.timeline.slice();
    timeline.splice(last + 1, 0, ref.id);
    const cursor = doc.timelineCursor;
    d = {
      ...d,
      timeline,
      timelineCursor: cursor === null ? null : cursor + (last + 1 <= cursor ? 1 : 0),
    };
    out.moveId = ref.id;
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
