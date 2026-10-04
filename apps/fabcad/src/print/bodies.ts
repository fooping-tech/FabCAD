import { type CadDocument, listBodies, listComponents, listInstances } from "@fabcad/cad-document";
import type { PrintBody, PrintSettings } from "@fabcad/fabrication-print";
import type { PrintWorkspaceSettings } from "./settingsModel";

/**
 * Which bodies the 3D Print workspace prints, and how many of each. A body of a component is
 * printed once per visible instance of the component (or once, when the component is set to
 * "once"): the number of instances is the quantity. Copies share the orientation of their body.
 * Pure functions; the side panel, the preview and the export all use them.
 */
export interface PrintBodyChoice {
  id: string;
  name: string;
  visible: boolean;
  included: boolean;
  componentId: string;
  /** How many are printed when included. */
  copies: number;
}

/** Whether a body is shown in the model: visible itself, and its component placed visibly. */
function shown(doc: CadDocument, b: { visible: boolean; componentId: string }): boolean {
  if (!b.visible) return false;
  return (
    b.componentId === doc.assembly.rootComponentId ||
    listInstances(doc, b.componentId).some((i) => i.visible)
  );
}

export function printChoices(
  doc: CadDocument,
  settings: PrintWorkspaceSettings,
  computed: ReadonlySet<string>,
): PrintBodyChoice[] {
  const root = doc.assembly.rootComponentId;
  // The root first, then the components in the order they were made: grouped for the list.
  const order = [root, ...listComponents(doc).map((c) => c.id)];
  return listBodies(doc)
    .filter((b) => computed.has(b.id))
    .sort((a, b) => order.indexOf(a.componentId) - order.indexOf(b.componentId))
    .map((b) => {
      const mode = settings.copies[b.componentId] ?? "instances";
      const copies =
        b.componentId === root || mode === "once"
          ? 1
          : listInstances(doc, b.componentId).filter((i) => i.visible).length;
      return {
        id: b.id,
        name: b.name,
        visible: b.visible,
        included: settings.bodyIds ? settings.bodyIds.includes(b.id) : shown(doc, b),
        componentId: b.componentId,
        copies,
      };
    });
}

/** Id of the n-th copy (0-based) of a body: the body id itself for the first. */
export const copyId = (bodyId: string, n: number): string => (n === 0 ? bodyId : `${bodyId}#${n + 1}`);

/** The body a printed part (or one of its copies) comes from. */
export const sourceBodyId = (partId: string): string => partId.replace(/#\d+$/, "");

/** Bodies as the print compiler receives them: one per copy, tessellated, nothing else. */
export function printBodies(
  doc: CadDocument,
  choices: readonly PrintBodyChoice[],
  meshes: Record<string, { positions: Float32Array; indices: Uint32Array } | undefined>,
): PrintBody[] {
  const out: PrintBody[] = [];
  for (const c of choices) {
    const mesh = meshes[c.id];
    if (!c.included || !mesh) continue;
    const instances =
      c.componentId === doc.assembly.rootComponentId
        ? []
        : listInstances(doc, c.componentId).filter((i) => i.visible);
    for (let n = 0; n < c.copies; n++) {
      const name = c.copies > 1 && instances[n] ? `${instances[n]!.name}/${c.name}` : c.name;
      out.push({ id: copyId(c.id, n), name, mesh: { positions: mesh.positions, indices: mesh.indices } });
    }
  }
  return out;
}

/** Print settings with the orientation of every body given to its copies too. */
export function withCopyOrientations(settings: PrintSettings, bodies: readonly PrintBody[]): PrintSettings {
  const orientations = { ...settings.orientations };
  for (const b of bodies) {
    const source = sourceBodyId(b.id);
    const o = settings.orientations[source];
    if (source !== b.id && o) orientations[b.id] = o;
  }
  return { ...settings, orientations };
}
