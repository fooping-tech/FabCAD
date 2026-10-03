import type { InstanceTransform } from "@fabcad/assembly";
import {
  type CadDocument,
  type CreatedComponent,
  applyInstanceTransform,
  createComponent,
  createInstance,
  duplicateInstances,
  listInstances,
  removeComponents,
  removeInstances,
  validComponentId,
} from "@fabcad/cad-document";
import { appState, lastViewportPoint, setSelection, toast } from "./appState";
import { documentStore, run, useDocument } from "./session";
import { useStore } from "./tinyStore";

/**
 * Components in the editor.
 *
 * One component is active at a time (`appState.activeComponentId`, null for the root). What
 * is created belongs to it: a new sketch directly, features through the sketch or body they are
 * built on. Editing a component shows its definition alone, in its own coordinates, so that
 * nothing of another component can be picked into its features. With the root active, the root
 * bodies are shown as they are and every component through its instances, each placed by its
 * transform; an instance is picked as a whole, never as faces or edges.
 */

/** The component being edited; the root when none is, or when the active one is gone. */
export function activeComponentId(doc: CadDocument = documentStore.document): string {
  return validComponentId(doc, appState.get().activeComponentId);
}

export function useActiveComponentId(): string {
  const doc = useDocument();
  const id = useStore(appState, (s) => s.activeComponentId);
  return validComponentId(doc, id);
}

/** Whether things of `componentId` are shown and editable in the current context. */
export function inActiveComponent(componentId: string, doc: CadDocument = documentStore.document): boolean {
  return componentId === activeComponentId(doc);
}

/** Edit a component (null: the root). Leaves a sketch and closes a command first. */
export function activateComponent(componentId: string | null): void {
  const doc = documentStore.document;
  const id = componentId === doc.assembly.rootComponentId ? null : componentId;
  if (id !== null && !doc.assembly.components[id]) return;
  if (documentStore.inTransaction) documentStore.commit();
  appState.set({
    activeComponentId: id,
    activeSketchId: null,
    tool: "select",
    dialog: null,
    instanceMove: null,
    selection: id ? [{ kind: "component", componentId: id }] : [],
    hover: null,
    dimensionEdit: null,
    measuring: false,
  });
}

/**
 * New component. Selected bodies and features (of one component) move into it together with
 * the history they cannot be separated from; without a selection it starts empty and is
 * activated, ready to model in.
 */
export function newComponent(): void {
  const doc = documentStore.document;
  const selection = appState.get().selection;
  const bodyIds = selection.flatMap((s) => (s.kind === "body" ? [s.bodyId] : []));
  const featureIds = selection.flatMap((s) =>
    s.kind === "feature" || s.kind === "plane" ? [s.featureId] : [],
  );
  const fromSelection = bodyIds.length + featureIds.length > 0;
  if (fromSelection && activeComponentId(doc) !== doc.assembly.rootComponentId) {
    toast("Components are made from the root. Activate the root first, then select the bodies.", "warning");
    return;
  }
  const owners = new Set([
    ...bodyIds.map((id) => doc.bodies[id]?.componentId),
    ...featureIds.map((id) => doc.features[id]?.componentId),
  ]);
  if (owners.size > 1) {
    toast("The selection belongs to different components.", "warning");
    return;
  }
  const out: CreatedComponent = {};
  if (!run(createComponent({ bodyIds, featureIds }, out)) || !out.id) return;
  if (!fromSelection) {
    activateComponent(out.id);
    toast("New component. It is active: what you make now belongs to it.");
    return;
  }
  setSelection([{ kind: "component", componentId: out.id }]);
  const bodies = out.bodyIds?.length ?? 0;
  const extra = bodies - bodyIds.length;
  toast(
    `Made a component of ${bodies} ${bodies === 1 ? "body" : "bodies"} and ${out.featureIds?.length ?? 0} steps` +
      (extra > 0 ? ` (${extra} more ${extra === 1 ? "body was" : "bodies were"} tied to the selection).` : "."),
  );
}

/** Another instance of a definition, selected and ready to be moved. */
export function newInstance(componentId: string): void {
  const out: { id?: string } = {};
  if (!run(createInstance(componentId, out)) || !out.id) return;
  if (appState.get().activeComponentId !== null) activateComponent(null);
  setSelection([{ kind: "instance", instanceId: out.id }]);
  openInstanceMove(out.id);
}

export function duplicateSelectedInstances(): void {
  const ids = selectedInstances();
  if (ids.length === 0) return;
  const out: { ids?: string[] } = {};
  if (!run(duplicateInstances(ids, out)) || !out.ids) return;
  setSelection(out.ids.map((instanceId) => ({ kind: "instance" as const, instanceId })));
  if (out.ids.length === 1) openInstanceMove(out.ids[0]!);
}

export function selectedInstances(): string[] {
  return appState.get().selection.flatMap((s) => (s.kind === "instance" ? [s.instanceId] : []));
}

/** The Move / Rotate window of an instance. */
export function openInstanceMove(instanceId: string): void {
  if (!documentStore.document.assembly.instances[instanceId]) return;
  if (documentStore.inTransaction) documentStore.commit();
  appState.set({ instanceMove: { instanceId, anchor: lastViewportPoint() }, dialog: null });
}

/**
 * Show the instance at `transform` while the window is open. The changes are one transaction:
 * OK keeps them as one step, Cancel puts the instance back.
 */
export function previewInstanceMove(transform: InstanceTransform): void {
  const move = appState.get().instanceMove;
  if (!move) return;
  if (!documentStore.inTransaction) documentStore.begin("Move instance");
  documentStore.update((doc) => applyInstanceTransform(doc, move.instanceId, transform));
}

export function commitInstanceMove(): void {
  if (!appState.get().instanceMove) return;
  if (documentStore.inTransaction) documentStore.commit();
  appState.set({ instanceMove: null });
}

export function cancelInstanceMove(): void {
  if (!appState.get().instanceMove) return;
  if (documentStore.inTransaction) documentStore.cancel();
  appState.set({ instanceMove: null });
}

/**
 * Delete the selected components and instances. Returns false when there were none, so that
 * the caller goes on with the rest of the selection.
 */
export function deleteSelectedComponents(): boolean {
  const selection = appState.get().selection;
  const components = selection.flatMap((s) => (s.kind === "component" ? [s.componentId] : []));
  const instances = selectedInstances();
  if (components.length + instances.length === 0) return false;
  const doc = documentStore.document;
  if (components.length > 0) {
    run(removeComponents(components));
    if (components.includes(appState.get().activeComponentId ?? "")) activateComponent(null);
  }
  const left = instances.filter((id) => documentStore.document.assembly.instances[id]);
  if (left.length > 0) run(removeInstances(left));
  if (instances.length > 0 && components.length === 0) {
    const definitions = new Set(left.map((id) => doc.assembly.instances[id]?.componentId));
    const orphaned = [...definitions].filter(
      (c) => c && listInstances(documentStore.document, c).length === 0,
    );
    if (orphaned.length > 0) {
      toast("The definition stays in the browser under Components; Create Instance places it again.");
    }
  }
  setSelection([]);
  appState.set({ hover: null, instanceMove: null });
  return true;
}
