import {
  type Command,
  type CreatedRef,
  type Feature,
  command,
  setSketchVisible,
  addBoolean,
  addChamfer,
  addExtrude,
  addFillet,
  addImport,
  addRevolve,
  addShell,
  addSketch,
  evaluateAs,
  removeBody,
  removeFeatures,
  updateFeature,
} from "@fabcad/cad-document";
import { type OriginPlaneName, type Vec3, makePlane } from "@fabcad/geometry";
import { type SketchPlaneRef, editSketch, profileRefOf } from "@fabcad/sketch";
import {
  type Dialog,
  type Selection,
  appState,
  selectionKey,
  setSelection,
  toast,
} from "./appState";
import {
  currentScope,
  documentStore,
  editSketchSolved,
  fileToBase64,
  pickFile,
  run,
  sketchView,
} from "./session";

/** High-level user actions shared by the ribbon, the panels and the keyboard shortcuts. */

const titleCase = (id: string): string =>
  id
    .replace(/^constraint:/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export function setTool(tool: string): void {
  if (appState.get().tool === tool) return;
  const patch: Partial<ReturnType<typeof appState.get>> = { tool, hover: null, dimensionEdit: null };
  if (tool !== "select") patch.lastCommand = { kind: "tool", id: tool, label: titleCase(tool) };
  appState.set(patch);
}

/** Start the most recent command again. */
export function repeatLastCommand(): void {
  const last = appState.get().lastCommand;
  if (!last) return;
  if (last.kind === "dialog") openDialog(last.id as Dialog["type"]);
  else if (appState.get().activeSketchId) setTool(last.id);
  else beginSketchPlanePick(last.id);
}

export function setWorkspace(workspace: "design" | "fabrication"): void {
  const s = appState.get();
  if (s.workspace === workspace) return;
  if (s.activeSketchId) finishSketch();
  appState.set({ workspace, dialog: null, tool: "select", selection: [], hover: null });
}

// ------------------------------------------------------------------- sketches

/**
 * Start a sketch. `tool` is the sketch tool to activate once the plane is known, so that a
 * shortcut such as L works from the solid environment as well.
 */
export function beginSketchPlanePick(tool: string | null = null): void {
  appState.set({ pendingSketchTool: tool });
  const { selection } = appState.get();
  // A plane or planar face that is already selected is used directly.
  const first = selection[0];
  if (first?.kind === "origin-plane") {
    startSketch({ type: "origin", plane: first.plane });
    return;
  }
  if (first?.kind === "face" && first.planar) {
    startSketchOnFace(first.bodyId, first.point, first.normal);
    return;
  }
  appState.set({
    dialog: { type: "pick-sketch-plane" },
    tool: "select",
    selection: [],
    hint: "Select an origin plane or a planar face for the sketch",
  });
}

export function startSketch(plane: SketchPlaneRef): void {
  const out: CreatedRef = {};
  if (!run(addSketch(plane, out)) || !out.id) return;
  enterSketch(out.id);
}

export function startSketchOnOrigin(plane: OriginPlaneName): void {
  startSketch({ type: "origin", plane });
}

export function startSketchOnFace(bodyId: string, point: Vec3, normal: Vec3): void {
  // Keep the sketch axes aligned with the world axes where the face allows it.
  const xHint = Math.abs(normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  startSketch({ type: "face", bodyId, hint: point, plane: makePlane(point, normal, xHint) });
}

export function enterSketch(sketchId: string): void {
  const f = documentStore.document.features[sketchId];
  if (!f || f.type !== "sketch") return;
  appState.set({
    workspace: "design",
    activeSketchId: sketchId,
    dialog: null,
    tool: appState.get().pendingSketchTool ?? "select",
    pendingSketchTool: null,
    selection: [],
    hover: null,
    dimensionEdit: null,
    sidePanelOpen: false,
  });
}

export function finishSketch(): void {
  if (!appState.get().activeSketchId) return;
  if (documentStore.inTransaction) documentStore.commit();
  const id = appState.get().activeSketchId;
  appState.set({
    activeSketchId: null,
    tool: "select",
    selection: id ? [{ kind: "feature", featureId: id }] : [],
    hover: null,
    dimensionEdit: null,
    hint: "",
  });
}

// -------------------------------------------------------------------- dialogs

function selectedProfiles(): { sketchId: string | null; profiles: Extract<Selection, { kind: "profile" }>[] } {
  const profiles = appState
    .get()
    .selection.filter((s): s is Extract<Selection, { kind: "profile" }> => s.kind === "profile");
  const sketchId = profiles[0]?.sketchId ?? null;
  return { sketchId, profiles: profiles.filter((p) => p.sketchId === sketchId) };
}

function defaultTargets(): string[] {
  return Object.values(documentStore.document.bodies)
    .filter((b) => b.visible)
    .map((b) => b.id);
}

export function openDialog(type: Dialog["type"]): void {
  const state = appState.get();
  // Profiles picked inside the sketch carry over into the command started from it.
  const picked = selectedProfiles();
  if (state.activeSketchId) finishSketch();
  const selection = appState.get().selection;
  const doc = documentStore.document;
  let dialog: Dialog;
  switch (type) {
    case "extrude":
    case "revolve": {
      let { sketchId } = picked;
      let refs = picked.profiles.map((p) => p.ref);
      // Coming straight from a sketch: preselect it when it has exactly one profile.
      const sketchSel = selection.find((s) => s.kind === "feature");
      if (!sketchId && sketchSel?.kind === "feature") {
        const f = doc.features[sketchSel.featureId];
        if (f?.type === "sketch") {
          sketchId = f.id;
          const regions = sketchView(f.sketch, doc).regions;
          if (regions.length === 1) refs = [profileRefOf(regions[0]!)];
        }
      }
      const hasBodies = Object.keys(doc.bodies).length > 0;
      dialog =
        type === "extrude"
          ? {
              type,
              editing: null,
              sketchId,
              profiles: refs,
              distance: "10",
              direction: "positive",
              operation: hasBodies ? "join" : "new",
              targetBodyIds: defaultTargets(),
            }
          : {
              type,
              editing: null,
              sketchId,
              profiles: refs,
              axis: null,
              angle: "360",
              operation: hasBodies ? "join" : "new",
              targetBodyIds: defaultTargets(),
              picking: refs.length > 0 ? "axis" : "profile",
            };
      break;
    }
    case "fillet":
    case "chamfer": {
      const edges = selection.filter((s): s is Extract<Selection, { kind: "edge" }> => s.kind === "edge");
      const bodyId = edges[0]?.bodyId ?? null;
      dialog = {
        type,
        editing: null,
        bodyId,
        edges: edges.filter((e) => e.bodyId === bodyId).map((e) => ({ point: e.point })),
        value: type === "fillet" ? "3" : "2",
      };
      break;
    }
    case "shell": {
      const faces = selection.filter((s): s is Extract<Selection, { kind: "face" }> => s.kind === "face");
      const bodyId = faces[0]?.bodyId ?? null;
      dialog = {
        type,
        editing: null,
        bodyId,
        faces: faces
          .filter((f) => f.bodyId === bodyId)
          .map((f) => ({ point: f.point, normal: f.normal })),
        value: "2",
      };
      break;
    }
    case "combine": {
      const bodies = [
        ...new Set(selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : []))),
      ];
      dialog = {
        type,
        editing: null,
        operation: "union",
        targetBodyId: bodies[0] ?? null,
        toolBodyIds: bodies.slice(1),
        keepTools: false,
        picking: bodies.length === 0 ? "target" : "tools",
      };
      break;
    }
    case "pick-sketch-plane":
      beginSketchPlanePick(null);
      return;
    default:
      dialog = { type } as Dialog;
  }
  const filter =
    type === "fillet" || type === "chamfer"
      ? "edge"
      : type === "shell"
        ? "face"
        : type === "combine"
          ? "body"
          : state.selectionFilter;
  appState.set({
    dialog,
    tool: "select",
    selection: [],
    hover: null,
    selectionFilter: filter,
    sidePanelOpen: false,
    ...(dialog.type !== "parameters" && dialog.type !== "about"
      ? { lastCommand: { kind: "dialog" as const, id: dialog.type, label: titleCase(dialog.type) } }
      : {}),
  });
}

/** Open the dialog of an existing feature to edit it. */
export function editFeature(featureId: string): void {
  const f = documentStore.document.features[featureId];
  if (!f) return;
  if (appState.get().activeSketchId) finishSketch();
  let dialog: Dialog | null = null;
  switch (f.type) {
    case "sketch":
      enterSketch(f.id);
      return;
    case "extrude":
      dialog = {
        type: "extrude",
        editing: f.id,
        sketchId: f.sketchId,
        profiles: f.profiles,
        distance: f.distance,
        direction: f.direction,
        operation: f.operation,
        targetBodyIds: f.targetBodyIds,
      };
      break;
    case "revolve":
      dialog = {
        type: "revolve",
        editing: f.id,
        sketchId: f.sketchId,
        profiles: f.profiles,
        axis: f.axis,
        angle: f.angle,
        operation: f.operation,
        targetBodyIds: f.targetBodyIds,
        picking: "profile",
      };
      break;
    case "fillet":
      dialog = { type: "fillet", editing: f.id, bodyId: f.bodyId, edges: f.edges, value: f.radius };
      break;
    case "chamfer":
      dialog = { type: "chamfer", editing: f.id, bodyId: f.bodyId, edges: f.edges, value: f.distance };
      break;
    case "shell":
      dialog = { type: "shell", editing: f.id, bodyId: f.bodyId, faces: f.faces, value: f.thickness };
      break;
    case "boolean":
      dialog = {
        type: "combine",
        editing: f.id,
        operation: f.operation,
        targetBodyId: f.targetBodyId,
        toolBodyIds: f.toolBodyIds,
        keepTools: f.keepTools,
        picking: "tools",
      };
      break;
    case "import":
      toast("Imported bodies have nothing to edit.");
      return;
  }
  const filter =
    dialog.type === "fillet" || dialog.type === "chamfer"
      ? "edge"
      : dialog.type === "shell"
        ? "face"
        : dialog.type === "combine"
          ? "body"
          : appState.get().selectionFilter;
  appState.set({ dialog, tool: "select", selection: [], hover: null, selectionFilter: filter });
}

export function closeDialog(): void {
  if (!appState.get().dialog) return;
  appState.set({
    dialog: null,
    hover: null,
    selectionFilter: "auto",
    hint: "",
    pendingSketchTool: null,
  });
}

export function patchDialog(patch: Partial<Dialog>): void {
  const d = appState.get().dialog;
  if (!d) return;
  appState.set({ dialog: { ...d, ...patch } as Dialog });
}

/** Validate an expression of a dialog field; returns an error message or null. */
export function expressionError(expression: string, kind: "length" | "angle", positive = true): string | null {
  try {
    const v = evaluateAs(expression, kind, currentScope());
    if (positive && !(v > 0)) return "Must be greater than zero";
    if (!positive && Math.abs(v) < 1e-9) return "Must not be zero";
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Reason why the dialog cannot be applied yet, or null when it is complete. */
export function dialogProblem(dialog: Dialog): string | null {
  switch (dialog.type) {
    case "extrude":
      if (!dialog.sketchId || dialog.profiles.length === 0) return "Select a profile";
      if (dialog.operation !== "new" && dialog.targetBodyIds.length === 0) return "Select a target body";
      return expressionError(dialog.distance, "length", false);
    case "revolve":
      if (!dialog.sketchId || dialog.profiles.length === 0) return "Select a profile";
      if (!dialog.axis) return "Select an axis";
      if (dialog.operation !== "new" && dialog.targetBodyIds.length === 0) return "Select a target body";
      return expressionError(dialog.angle, "angle", false);
    case "fillet":
    case "chamfer":
      if (!dialog.bodyId || dialog.edges.length === 0) return "Select an edge";
      return expressionError(dialog.value, "length");
    case "shell":
      if (!dialog.bodyId || dialog.faces.length === 0) return "Select a face to remove";
      return expressionError(dialog.value, "length");
    case "combine":
      if (!dialog.targetBodyId) return "Select the target body";
      if (dialog.toolBodyIds.length === 0) return "Select a tool body";
      return null;
    default:
      return null;
  }
}

/** Like Fusion, a sketch is hidden once a feature has been built from it. */
function consumingSketch(cmd: Command, sketchId: string): Command {
  return command(cmd.label, (doc) => {
    const next = cmd.apply(doc);
    return next === doc ? doc : setSketchVisible(sketchId, false).apply(next);
  });
}

export function commitDialog(): boolean {
  const dialog = appState.get().dialog;
  if (!dialog) return false;
  const problem = dialogProblem(dialog);
  if (problem) {
    toast(problem, "warning");
    return false;
  }
  const out: CreatedRef = {};
  let ok = false;
  switch (dialog.type) {
    case "extrude": {
      const input = {
        sketchId: dialog.sketchId!,
        profiles: dialog.profiles,
        distance: dialog.distance,
        direction: dialog.direction,
        operation: dialog.operation,
        targetBodyIds: dialog.operation === "new" ? [] : dialog.targetBodyIds,
      };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit extrude"))
        : run(consumingSketch(addExtrude(input, out), input.sketchId));
      break;
    }
    case "revolve": {
      const input = {
        sketchId: dialog.sketchId!,
        profiles: dialog.profiles,
        axis: dialog.axis!,
        angle: dialog.angle,
        operation: dialog.operation,
        targetBodyIds: dialog.operation === "new" ? [] : dialog.targetBodyIds,
      };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit revolve"))
        : run(consumingSketch(addRevolve(input, out), input.sketchId));
      break;
    }
    case "fillet": {
      const input = { bodyId: dialog.bodyId!, edges: dialog.edges, radius: dialog.value };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit fillet"))
        : run(addFillet(input, out));
      break;
    }
    case "chamfer": {
      const input = { bodyId: dialog.bodyId!, edges: dialog.edges, distance: dialog.value };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit chamfer"))
        : run(addChamfer(input, out));
      break;
    }
    case "shell": {
      const input = { bodyId: dialog.bodyId!, faces: dialog.faces, thickness: dialog.value };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit shell"))
        : run(addShell(input, out));
      break;
    }
    case "combine": {
      const input = {
        operation: dialog.operation,
        targetBodyId: dialog.targetBodyId!,
        toolBodyIds: dialog.toolBodyIds,
        keepTools: dialog.keepTools,
      };
      ok = dialog.editing
        ? run(updateFeature(dialog.editing, input, "Edit combine"))
        : run(addBoolean(input, out));
      break;
    }
    default:
      break;
  }
  const featureId = dialog.type !== "parameters" && dialog.type !== "about" && "editing" in dialog
    ? (dialog.editing ?? out.id)
    : out.id;
  // Editing without changing anything still closes the dialog.
  if (!ok && !("editing" in dialog && dialog.editing)) return false;
  appState.set({
    dialog: null,
    hover: null,
    selectionFilter: "auto",
    selection: [],
    hint: "",
  });
  void featureId;
  return true;
}

// ------------------------------------------------------------------ deletion

export function deleteSelection(): void {
  const { selection, activeSketchId } = appState.get();
  if (selection.length === 0) return;
  if (activeSketchId) {
    const entities = selection.flatMap((s) =>
      s.kind === "entity" && s.sketchId === activeSketchId ? [s.entityId] : [],
    );
    const constraints = selection.flatMap((s) =>
      s.kind === "constraint" && s.sketchId === activeSketchId ? [s.id] : [],
    );
    const dimensions = selection.flatMap((s) =>
      s.kind === "dimension" && s.sketchId === activeSketchId ? [s.id] : [],
    );
    if (entities.length + constraints.length + dimensions.length === 0) return;
    editSketchSolved(activeSketchId, "Delete", (sketch) =>
      editSketch(sketch, (b) => {
        // The sketch origin and the constraint that fixes it are permanent.
        const origin = sketch.originId;
        for (const id of constraints) {
          const c = sketch.constraints[id];
          if (c && !(c.type === "fix" && origin && c.refs.includes(origin))) b.removeConstraint(id);
        }
        for (const id of dimensions) b.removeDimension(id);
        b.remove(entities.filter((id) => id !== origin));
      }),
    );
    setSelection([]);
    appState.set({ hover: null });
    return;
  }
  const features = new Set<string>();
  const doc = documentStore.document;
  for (const s of selection) {
    if (s.kind === "feature") features.add(s.featureId);
    if (s.kind === "body") {
      const b = doc.bodies[s.bodyId];
      if (b) features.add(b.createdBy);
    }
  }
  if (features.size === 0) return;
  run(removeFeatures([...features]));
  setSelection([]);
  appState.set({ hover: null });
}

export function deleteBody(bodyId: string): void {
  run(removeBody(bodyId));
  appState.set((s) => ({
    selection: s.selection.filter((x) => !("bodyId" in x) || x.bodyId !== bodyId),
  }));
}

export function toggleSelection(item: Selection): void {
  const { selection } = appState.get();
  const key = selectionKey(item);
  const exists = selection.some((s) => selectionKey(s) === key);
  setSelection(exists ? selection.filter((s) => selectionKey(s) !== key) : [...selection, item]);
}

export async function importStep(): Promise<void> {
  const file = await pickFile(".step,.stp,.STEP,.STP");
  if (!file) return;
  try {
    const data = await fileToBase64(file);
    run(addImport({ fileName: file.name, data, format: "step" }));
    toast(`Imported ${file.name}.`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

export const featureIcon = (feature: Feature): string => {
  switch (feature.type) {
    case "sketch":
      return "sketch";
    case "extrude":
      return "extrude";
    case "revolve":
      return "revolve";
    case "boolean":
      return "combine";
    case "fillet":
      return "fillet-3d";
    case "chamfer":
      return "chamfer-3d";
    case "shell":
      return "shell";
    case "import":
      return "import3d";
  }
};
