import { type InstanceTransform, normalizeQuaternion } from "@fabcad/assembly";
import type { ShapeTransform } from "@fabcad/brep";
import { type CadDocument, listBodies, listComponents, listInstances } from "@fabcad/cad-document";
import type { ExportItem } from "@fabcad/features";
import type { Selection } from "./appState";

/**
 * What a STEP / STL export of the 3D model contains: chosen bodies, and for the bodies of a
 * component whether they are written once per placed instance (where the instance is) or once,
 * where the definition lies. Pure functions: the window and the tests share them.
 */
export interface ExportChoice {
  /** Bodies to write: of the root and of components. */
  bodyIds: string[];
  /** By component id. */
  placement: Record<string, "instances" | "origin">;
}

/** Bodies that can be written: they exist at the history marker and have geometry. */
export function exportableBodies(doc: CadDocument, computed: ReadonlySet<string>) {
  return listBodies(doc).filter((b) => computed.has(b.id));
}

/**
 * What the export window starts with: what is selected (bodies, components, instances), or
 * else everything that is shown: the visible bodies of the root and of the components that have
 * a visible instance.
 */
export function defaultExportChoice(
  doc: CadDocument,
  selection: readonly Selection[],
  computed: ReadonlySet<string>,
): ExportChoice {
  const bodies = exportableBodies(doc, computed);
  const root = doc.assembly.rootComponentId;
  const shown = (componentId: string): boolean =>
    componentId === root || listInstances(doc, componentId).some((i) => i.visible);
  const placement: ExportChoice["placement"] = {};
  for (const c of listComponents(doc)) placement[c.id] = shown(c.id) ? "instances" : "origin";

  const picked = new Set<string>();
  for (const s of selection) {
    if (s.kind === "body") picked.add(s.bodyId);
    const componentId =
      s.kind === "component" ? s.componentId : s.kind === "instance" ? doc.assembly.instances[s.instanceId]?.componentId : undefined;
    if (componentId === undefined) continue;
    for (const b of bodies) if (b.componentId === componentId && b.visible) picked.add(b.id);
  }
  const bodyIds =
    picked.size > 0
      ? bodies.filter((b) => picked.has(b.id)).map((b) => b.id)
      : bodies.filter((b) => b.visible && shown(b.componentId)).map((b) => b.id);
  return { bodyIds, placement };
}

/** Rigid steps of an instance placement: the turn about the origin, then the move. */
export function instanceSteps(t: InstanceTransform): ShapeTransform[] {
  const [x, y, z, w] = normalizeQuaternion(t.rotation);
  const steps: ShapeTransform[] = [];
  const half = Math.acos(Math.max(-1, Math.min(1, w)));
  const s = Math.sin(half);
  if (s > 1e-9) {
    steps.push({
      type: "rotate",
      origin: { x: 0, y: 0, z: 0 },
      axis: { x: x / s, y: y / s, z: z / s },
      angle: (2 * half * 180) / Math.PI,
    });
  }
  const [px, py, pz] = t.position;
  if (Math.hypot(px, py, pz) > 1e-12) steps.push({ type: "translate", vector: { x: px, y: py, z: pz } });
  return steps;
}

/**
 * The solids to write for a choice. Bodies of the root are written as they are; bodies of a
 * component once for each visible instance, placed there and named "Instance/Body", or once at
 * the origin, named "Component/Body".
 */
export function exportItems(doc: CadDocument, choice: ExportChoice): ExportItem[] {
  const root = doc.assembly.rootComponentId;
  const chosen = new Set(choice.bodyIds);
  const out: ExportItem[] = [];
  for (const b of listBodies(doc)) {
    if (!chosen.has(b.id)) continue;
    if (b.componentId === root) {
      out.push({ id: b.id, name: b.name });
      continue;
    }
    const component = doc.assembly.components[b.componentId];
    if (!component) continue;
    if ((choice.placement[b.componentId] ?? "instances") === "origin") {
      out.push({ id: b.id, name: `${component.name}/${b.name}` });
      continue;
    }
    for (const i of listInstances(doc, b.componentId)) {
      if (!i.visible) continue;
      out.push({ id: b.id, name: `${i.name}/${b.name}`, steps: instanceSteps(i.transform) });
    }
  }
  return out;
}
