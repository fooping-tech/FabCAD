import {
  type Command,
  type CreatedRef,
  type Feature,
  applySketchEdit,
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
import {
  type OriginPlaneName,
  type Vec3,
  dot3,
  makePlane,
  norm3,
  planeToWorld,
  scale3,
} from "@fabcad/geometry";
import { pointInBody } from "@fabcad/brep";
import {
  type ProfileRef,
  type Sketch,
  type SketchPlaneRef,
  editSketch,
  profileRefOf,
  removeTexts,
} from "@fabcad/sketch";
import { resolveSketchPlane } from "@fabcad/features";
import { projectInto } from "../sketch/projectTool";
import { directionForOperation, extrudeRange, operationForSide } from "./extrudeDirection";
import { cancelText, commitText, deleteTexts } from "../text/textCommands";
import { viewportApi } from "../viewport/api";
import { edgeRefOf, faceIndexOf, faceRefOf, pickedOf } from "./topology";
import {
  type Dialog,
  type Selection,
  type SolidDialog,
  appState,
  selectionKey,
  setSelection,
  toast,
} from "./appState";
import {
  type Picked,
  applyPick,
  consumedSketches,
  dialogFromFeature,
  freePoints,
  holeBody,
  isSolidDialog,
  nextPicking,
  solidDialogCommand,
  solidDialogProblem,
} from "./solidDialogs";
import {
  currentScope,
  documentStore,
  editSketchSolved,
  fileToBase64,
  modelState,
  pickFile,
  run,
  sketchView,
} from "./session";
import { bodiesCenter } from "./moveTransform";

/** High-level user actions shared by the ribbon, the panels and the keyboard shortcuts. */

const titleCase = (id: string): string =>
  id
    .replace(/^constraint:/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** Names and icons of the commands that open a feature dialog. */
export const DIALOG_COMMANDS: Partial<Record<Dialog["type"], { label: string; icon: string }>> = {
  "pick-sketch-plane": { label: "Create Sketch", icon: "new-sketch" },
  "offset-plane": { label: "Offset Plane", icon: "offset-plane" },
  extrude: { label: "Extrude", icon: "extrude" },
  revolve: { label: "Revolve", icon: "revolve" },
  sweep: { label: "Sweep", icon: "sweep" },
  loft: { label: "Loft", icon: "loft" },
  hole: { label: "Hole", icon: "hole" },
  fillet: { label: "Fillet", icon: "fillet-3d" },
  chamfer: { label: "Chamfer", icon: "chamfer-3d" },
  shell: { label: "Shell", icon: "shell" },
  combine: { label: "Combine", icon: "combine" },
  split: { label: "Split Body", icon: "split" },
  move: { label: "Move/Copy", icon: "move-3d" },
  align: { label: "Align", icon: "align" },
  "rectangular-pattern": { label: "Rectangular Pattern", icon: "pattern-rectangular" },
  "circular-pattern": { label: "Circular Pattern", icon: "pattern-circular" },
  mirror: { label: "Mirror", icon: "mirror-3d" },
};

/** Measure (I): picks made before the command was started are measured right away. */
export function startMeasure(): void {
  const state = appState.get();
  if (state.measuring) return;
  if (state.dialog) closeDialog();
  viewportApi()?.cancel();
  appState.set((s) => ({
    measuring: true,
    tool: "select",
    dimensionEdit: null,
    contextMenu: null,
    selectionFilter: "auto",
    selection: s.selection
      .filter((x) => x.kind !== "constraint" && x.kind !== "dimension" && x.kind !== "feature")
      .slice(0, 2),
    lastCommand: { kind: "measure", id: "measure", label: "Measure" },
    hint: "Measure: select one or two points, edges, faces or bodies.",
  }));
}

export function stopMeasure(): void {
  if (!appState.get().measuring) return;
  appState.set({ measuring: false, selection: [], hover: null, hint: "" });
}

export function setTool(tool: string): void {
  if (tool !== "select") stopMeasure();
  if (appState.get().tool === tool) return;
  const patch: Partial<ReturnType<typeof appState.get>> = { tool, hover: null, dimensionEdit: null };
  if (tool !== "select") patch.lastCommand = { kind: "tool", id: tool, label: titleCase(tool) };
  appState.set(patch);
}

/** Start the most recent command again. */
export function repeatLastCommand(): void {
  const last = appState.get().lastCommand;
  if (!last) return;
  if (last.kind === "measure") startMeasure();
  else if (last.kind === "dialog") openDialog(last.id as Dialog["type"]);
  else if (appState.get().activeSketchId) setTool(last.id);
  else beginSketchPlanePick(last.id);
}

export function setWorkspace(workspace: "design" | "fabrication"): void {
  stopMeasure();
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
    startSketchOnFace(first.bodyId, first.point, first.normal, first.faceIndex);
    return;
  }
  if (first?.kind === "plane" && startSketchOnPlane(first.featureId)) return;
  appState.set({
    dialog: { type: "pick-sketch-plane" },
    tool: "select",
    selection: [],
    hint: "Select a plane or a planar face for the sketch",
  });
}

/**
 * A pick made while Create Sketch asks for its plane, outside the viewport (in the browser).
 * Returns true when the command is waiting for a plane, whether or not this was one.
 */
export function pickSketchPlane(item: Selection): boolean {
  if (appState.get().dialog?.type !== "pick-sketch-plane") return false;
  if (item.kind === "origin-plane") startSketchOnOrigin(item.plane);
  else if (item.kind === "plane") startSketchOnPlane(item.featureId);
  else if (item.kind === "face" && item.planar) {
    startSketchOnFace(item.bodyId, item.point, item.normal, item.faceIndex);
  }
  return true;
}

export function startSketch(plane: SketchPlaneRef, prepare?: (sketch: Sketch) => Sketch): void {
  const out: CreatedRef = {};
  const create = addSketch(plane, out);
  // Whatever the sketch starts with belongs to the same undo step as its creation.
  const cmd = prepare
    ? command(create.label, (doc) => {
        const next = create.apply(doc);
        return out.id ? applySketchEdit(next, out.id, prepare) : next;
      })
    : create;
  if (!run(cmd) || !out.id) return;
  enterSketch(out.id);
}

export function startSketchOnOrigin(plane: OriginPlaneName): void {
  startSketch({ type: "origin", plane });
}

/** Sketch on a construction plane. False when the plane has not been evaluated (yet). */
export function startSketchOnPlane(featureId: string): boolean {
  const plane = modelState.get().planes[featureId]?.plane;
  if (!plane) {
    toast("This plane is not available. It may be suppressed or its reference is missing.", "warning");
    return false;
  }
  startSketch({ type: "plane", featureId, plane });
  return true;
}

/**
 * Sketch on a planar face of a body. As in Fusion, the outline of the face is projected into
 * the new sketch, so that there is something to dimension and constrain against right away.
 */
export function startSketchOnFace(
  bodyId: string,
  point: Vec3,
  normal: Vec3,
  faceIndex?: number,
): void {
  // Keep the sketch axes aligned with the world axes where the face allows it.
  const xHint = Math.abs(normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // The sketch origin is the world origin dropped onto the face, so coordinates stay familiar.
  const n = norm3(normal);
  const origin = scale3(n, dot3(n, point));
  const plane = makePlane(origin, n, xHint);
  const model = modelState.get().bodies[bodyId];
  const geometry = model?.geometry;
  startSketch(
    {
      type: "face",
      bodyId,
      hint: point,
      plane,
      ...(faceIndex !== undefined ? { ref: faceRefOf(bodyId, faceIndex, point, normal) } : {}),
    },
    geometry && faceIndex !== undefined
      ? (sketch) =>
          projectInto(sketch, plane, geometry, { kind: "face", bodyId, faceIndex }, model.names)
            .sketch
      : undefined,
  );
}

const FACE_PROFILE = "Face profile";

/**
 * Use a planar face of a body as a profile (Fusion lets you extrude a face directly). The
 * outline of the face is projected into a new sketch on that face; the regions that make up
 * the face itself, not its holes, are returned as the profiles.
 */
export function faceAsProfile(
  bodyId: string,
  point: Vec3,
  normal: Vec3,
  faceIndex: number,
): { sketchId: string; profiles: ProfileRef[] } | null {
  const model = modelState.get().bodies[bodyId];
  const geometry = model?.geometry;
  if (!geometry) return null;
  const xHint = Math.abs(normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const n = norm3(normal);
  const plane = makePlane(scale3(n, dot3(n, point)), n, xHint);
  const out: CreatedRef = {};
  const create = addSketch(
    { type: "face", bodyId, hint: point, plane, ref: faceRefOf(bodyId, faceIndex, point, normal) },
    out,
  );
  const ok = run(
    command(FACE_PROFILE, (doc) => {
      const next = create.apply(doc);
      return out.id
        ? applySketchEdit(next, out.id, (sketch) =>
            projectInto(sketch, plane, geometry, { kind: "face", bodyId, faceIndex }, model.names)
              .sketch,
          )
        : next;
    }),
  );
  const f = out.id ? documentStore.document.features[out.id] : undefined;
  if (!ok || !out.id || f?.type !== "sketch") return null;
  const regions = sketchView(f.sketch).regions;
  // A region bounded by the hole of another region is a hole of the face, not the face.
  const holes = new Set(
    regions.flatMap((r) => r.holeEntityIds.map((ids) => ids.slice().sort().join(","))),
  );
  const faceRegions = regions.filter((r) => !holes.has(r.entityIds.slice().sort().join(",")));
  if (faceRegions.length === 0) {
    discardAutoSketch(out.id);
    return null;
  }
  return { sketchId: out.id, profiles: faceRegions.map(profileRefOf) };
}

/** Take back a sketch made by `faceAsProfile` that ended up unused. */
export function discardAutoSketch(sketchId: string | null | undefined): void {
  if (!sketchId || !documentStore.document.features[sketchId]) return;
  const used = Object.values(documentStore.document.features).some(
    (f) => (f.type === "extrude" || f.type === "revolve") && f.sketchId === sketchId,
  );
  if (used) return;
  const last = documentStore.document.timeline[documentStore.document.timeline.length - 1];
  if (documentStore.undoLabel === FACE_PROFILE && last === sketchId) documentStore.undo();
  else run(removeFeatures([sketchId]));
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

/**
 * Fill a new dialog from the selection, like Fusion's preselection. `plan` tells which input
 * of the dialog a selected item goes to, or null when the dialog has no use for it.
 */
function preselect<D extends SolidDialog>(
  dialog: D,
  selection: Selection[],
  plan: (picked: Picked, dialog: D) => string | null,
): D {
  let d = dialog;
  for (const s of selection) {
    const picked = pickedOf(s);
    const picking = picked ? plan(picked, d) : null;
    if (!picked || picking === null) continue;
    const at = "picking" in d ? ({ ...d, picking } as D) : d;
    const patch = applyPick(at, picked, { doc: documentStore.document, faceIndexOf });
    if (patch) d = { ...at, ...patch } as D;
  }
  return nextPicking(d);
}

/** Bodies named by the selection, a face or an edge standing for its body. */
const selectedBodies = (selection: Selection[]): string[] => [
  ...new Set(selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : []))),
];

function newSolidDialog(type: SolidDialog["type"], selection: Selection[]): SolidDialog {
  const doc = documentStore.document;
  const operation = {
    operation: Object.keys(doc.bodies).length > 0 ? ("join" as const) : ("new" as const),
    targetBodyIds: defaultTargets(),
  };
  const bodies = selection.some((s) => s.kind === "body");
  const source = {
    sourceKind: bodies ? ("bodies" as const) : ("features" as const),
    featureIds: [],
    bodyIds: [],
  };
  const sourcePlan = (p: Picked): string | null =>
    p.kind === "body" || p.kind === "feature" ? "source" : null;
  switch (type) {
    case "hole": {
      // A selected sketch stands for its point when it has exactly one to drill at.
      const sketchSel = selection.find((s) => s.kind === "feature" || s.kind === "entity");
      const sketchId =
        sketchSel?.kind === "feature"
          ? sketchSel.featureId
          : sketchSel?.kind === "entity"
            ? sketchSel.sketchId
            : null;
      const f = sketchId ? doc.features[sketchId] : undefined;
      const free = f?.type === "sketch" ? freePoints(f.sketch) : [];
      const points =
        f && free.length === 1 && !selection.some((s) => s.kind === "entity")
          ? [{ kind: "entity" as const, sketchId: f.id, entityId: free[0]! }]
          : [];
      const body = selectedBodies(selection)[0] ?? null;
      const dialog = preselect<Extract<SolidDialog, { type: "hole" }>>(
        {
          type,
          editing: null,
          bodyId: body,
          bodyAuto: body === null,
          sketchId: null,
          points: [],
          holeType: "simple",
          diameter: "5",
          extent: "through-all",
          depth: "10",
          counterboreDiameter: "9",
          counterboreDepth: "3",
          countersinkDiameter: "10",
          countersinkAngle: "90",
          flip: false,
          picking: "points",
        },
        [...points, ...selection],
        (p) => (p.kind === "entity" ? "points" : null),
      );
      return dialog.bodyId ? dialog : nextPicking({ ...dialog, bodyId: holeBody(doc, dialog.sketchId) });
    }
    case "rectangular-pattern":
      return preselect<Extract<SolidDialog, { type: "rectangular-pattern" }>>(
        {
          type,
          editing: null,
          ...source,
          direction: null,
          count: "3",
          distance: "10",
          flip: false,
          second: false,
          direction2: null,
          count2: "2",
          distance2: "10",
          flip2: false,
          picking: "source",
        },
        selection,
        (p, d) => sourcePlan(p) ?? (p.kind === "edge" ? (d.direction ? null : "direction") : null),
      );
    case "circular-pattern":
      return preselect<Extract<SolidDialog, { type: "circular-pattern" }>>(
        {
          type,
          editing: null,
          ...source,
          axis: null,
          count: "4",
          angle: "360",
          flip: false,
          picking: "source",
        },
        selection,
        (p, d) => sourcePlan(p) ?? (p.kind === "edge" ? (d.axis ? null : "axis") : null),
      );
    case "mirror":
      return preselect<Extract<SolidDialog, { type: "mirror" }>>(
        { type, editing: null, ...source, plane: null, picking: "source" },
        selection,
        (p, d) =>
          sourcePlan(p) ??
          (p.kind === "origin-plane" || p.kind === "face" || p.kind === "plane"
            ? d.plane
              ? null
              : "plane"
            : null),
      );
    case "move":
      return preselect<Extract<SolidDialog, { type: "move" }>>(
        {
          type,
          editing: null,
          bodyIds: [],
          copy: false,
          mode: "free",
          x: "0",
          y: "0",
          z: "0",
          rx: "0",
          ry: "0",
          rz: "0",
          pivot: null,
          axis: null,
          angle: "90",
          from: null,
          to: null,
          picking: "bodies",
        },
        selectedBodies(selection).map((bodyId) => ({ kind: "body", bodyId })),
        () => "bodies",
      );
    case "align": {
      const points = selection.length > 0 && selection.every((s) => s.kind === "vertex");
      return preselect<Extract<SolidDialog, { type: "align" }>>(
        {
          type,
          editing: null,
          mode: points ? "point-to-point" : "face-to-face",
          bodyId: null,
          fromFace: null,
          toFace: null,
          fromPoint: null,
          toPoint: null,
          flip: false,
          picking: "from",
        },
        selection,
        (p, d) => (p.kind === "face" || p.kind === "vertex" ? d.picking : null),
      );
    }
    case "split": {
      const only = Object.keys(doc.bodies).length === 1 ? Object.keys(doc.bodies)[0]! : null;
      const body = selection.find((s) => s.kind === "body");
      return preselect<Extract<SolidDialog, { type: "split" }>>(
        {
          type,
          editing: null,
          bodyId: body?.kind === "body" ? body.bodyId : only,
          tool: null,
          keep: "both",
          picking: "body",
        },
        selection,
        (p, d) =>
          p.kind === "origin-plane" || p.kind === "face" || p.kind === "plane"
            ? d.tool
              ? null
              : "tool"
            : null,
      );
    }
    case "sweep":
      return preselect<Extract<SolidDialog, { type: "sweep" }>>(
        {
          type,
          editing: null,
          sketchId: null,
          profiles: [],
          pathSketchId: null,
          path: [],
          ...operation,
          picking: "profile",
        },
        selection,
        (p, d) =>
          p.kind === "profile"
            ? "profile"
            : p.kind === "entity" && !d.path.includes(p.entityId)
              ? "path"
              : null,
      );
    case "loft":
      return preselect<Extract<SolidDialog, { type: "loft" }>>(
        { type, editing: null, sections: [], ruled: false, ...operation },
        selection,
        (p) => (p.kind === "profile" || p.kind === "face" ? "" : null),
      );
    case "offset-plane":
      return preselect<Extract<SolidDialog, { type: "offset-plane" }>>(
        { type, editing: null, base: null, offset: "10", picking: "base" },
        selection,
        (p, d) =>
          (p.kind === "origin-plane" || p.kind === "face" || p.kind === "plane") && !d.base
            ? "base"
            : null,
      );
  }
}

export function openDialog(type: Dialog["type"]): void {
  stopMeasure();
  const state = appState.get();
  // Profiles picked inside the sketch carry over into the command started from it.
  const picked = selectedProfiles();
  // So does the rest of what was selected there, for the commands that can use it.
  const inSketch = state.activeSketchId ? state.selection : [];
  if (state.activeSketchId) finishSketch();
  const selection = appState.get().selection;
  const doc = documentStore.document;
  let dialog: Dialog;
  switch (type) {
    case "hole":
    case "rectangular-pattern":
    case "circular-pattern":
    case "mirror":
    case "move":
    case "align":
    case "split":
    case "sweep":
    case "loft":
    case "offset-plane":
      dialog = newSolidDialog(type, [...inSketch, ...selection]);
      break;
    case "extrude":
    case "revolve": {
      let { sketchId } = picked;
      let refs = picked.profiles.map((p) => p.ref);
      // Coming straight from a sketch: preselect it when it has exactly one profile.
      // A selected sketch, or any of its curves, stands for the sketch.
      const sketchSel = selection.find((s) => s.kind === "feature" || s.kind === "entity");
      if (!sketchId && (sketchSel?.kind === "feature" || sketchSel?.kind === "entity")) {
        const f = doc.features[sketchSel.kind === "feature" ? sketchSel.featureId : sketchSel.sketchId];
        if (f?.type === "sketch") {
          sketchId = f.id;
          const regions = sketchView(f.sketch, doc).regions;
          if (regions.length === 1) refs = [profileRefOf(regions[0]!)];
        }
      }
      const hasBodies = Object.keys(doc.bodies).length > 0;
      // A selected planar face is extruded as it is.
      let autoSketch: string | null = null;
      let faceBody: string | null = null;
      const face = selection.find((s) => s.kind === "face" && s.planar);
      if (type === "extrude" && refs.length === 0 && face?.kind === "face") {
        const made = faceAsProfile(face.bodyId, face.point, face.normal, face.faceIndex);
        if (made) {
          sketchId = made.sketchId;
          refs = made.profiles;
          autoSketch = made.sketchId;
          faceBody = face.bodyId;
        }
      }
      dialog =
        type === "extrude"
          ? {
              type,
              editing: null,
              sketchId,
              profiles: refs,
              autoSketch,
              distance: "10",
              direction: "positive",
              operation: hasBodies ? "join" : "new",
              targetBodyIds: faceBody ? [faceBody] : defaultTargets(),
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
        edges: edges
          .filter((e) => e.bodyId === bodyId)
          .map((e) => edgeRefOf(e.bodyId, e.edgeIndex, e.point)),
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
          .map((f) => faceRefOf(f.bodyId, f.faceIndex, f.point, f.normal)),
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
    case "parameters":
    case "about":
      dialog = { type };
      break;
    case "text":
    case "import-dxf":
      // Opened by their own commands, with the data they need.
      return;
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
      ? {
          lastCommand: {
            kind: "dialog" as const,
            id: dialog.type,
            label: DIALOG_COMMANDS[dialog.type]?.label ?? titleCase(dialog.type),
          },
        }
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
        // The direction of an existing feature is what the user settled on.
        directionChosen: true,
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
    case "hole":
    case "rectangular-pattern":
    case "circular-pattern":
    case "mirror":
    case "move":
    case "align":
    case "split":
    case "sweep":
    case "loft":
    case "offset-plane":
      dialog = dialogFromFeature(f);
      break;
  }
  if (!dialog) return;
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
  const dialog = appState.get().dialog;
  if (!dialog) return;
  if (dialog.type === "text") {
    cancelText();
    return;
  }
  if (dialog.type === "extrude") discardAutoSketch(dialog.autoSketch);
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
  let next = { ...d, ...patch } as Dialog;
  if (d.type === "extrude" && next.type === "extrude") {
    const turned = ("direction" in patch || "distance" in patch) && !("operation" in patch)
      ? operationAfterTurn(d, next)
      : null;
    if (turned) {
      // The operation follows the side; the side stays what the user made it.
      next = { ...next, ...turned, directionChosen: true };
    } else if ("direction" in patch) {
      // A direction picked by the user is kept whatever the operation becomes.
      next = { ...next, directionChosen: true };
    } else if (!d.directionChosen && next.operation !== d.operation) {
      const direction = defaultDirection(d, next);
      if (direction) next = { ...next, direction };
    }
  }
  appState.set({ dialog: next });
}

type ExtrudeDialog = Extract<Dialog, { type: "extrude" }>;

/** The side of its sketch an extrusion goes to: 1, -1, or 0 for symmetric or unknown. */
function extrudeSide(dialog: ExtrudeDialog): number {
  try {
    const [from, to] = extrudeRange(dialog.direction, evaluateAs(dialog.distance, "length", currentScope()));
    return Math.sign(from + to);
  } catch {
    return 0;
  }
}

/**
 * Join ↔ Cut when the extrusion has been turned to the other side of its sketch (direction
 * buttons, or the arrow dragged through the sketch). It goes into a body when the middle of
 * the extrusion under a picked profile lies inside that body.
 */
function operationAfterTurn(from: ExtrudeDialog, to: ExtrudeDialog): Partial<ExtrudeDialog> | null {
  const side = extrudeSide(to);
  if (side === 0 || side === extrudeSide(from)) return null;
  if (to.operation !== "join" && to.operation !== "cut") return null;
  const doc = documentStore.document;
  const f = to.sketchId ? doc.features[to.sketchId] : undefined;
  if (f?.type !== "sketch" || to.profiles.length === 0) return null;
  const plane = resolveSketchPlane(f.sketch.plane);
  let range: [number, number];
  try {
    range = extrudeRange(to.direction, evaluateAs(to.distance, "length", currentScope()));
  } catch {
    return null;
  }
  const mid = (range[0] + range[1]) / 2;
  const samples = to.profiles.map((p) => {
    const q = planeToWorld(plane, p.point);
    return { x: q.x + plane.normal.x * mid, y: q.y + plane.normal.y * mid, z: q.z + plane.normal.z * mid };
  });
  const computed = modelState.get().bodies;
  const own = to.editing ? doc.features[to.editing] : undefined;
  const ownBody = own && "bodyId" in own ? own.bodyId : "";
  const into = Object.values(doc.bodies)
    .filter((b) => b.visible && b.id !== ownBody)
    .filter((b) => {
      const g = computed[b.id]?.geometry;
      return g ? samples.some((p) => pointInBody(g, p)) : false;
    })
    .map((b) => b.id);
  return operationForSide(to.operation, into);
}

function defaultDirection(from: ExtrudeDialog, to: ExtrudeDialog): ExtrudeDialog["direction"] | null {
  const doc = documentStore.document;
  const f = to.sketchId ? doc.features[to.sketchId] : undefined;
  if (f?.type !== "sketch") return null;
  const computed = modelState.get().bodies;
  const ids =
    to.targetBodyIds.length > 0
      ? to.targetBodyIds
      : Object.values(doc.bodies)
          .filter((b) => b.visible)
          .map((b) => b.id);
  const boxes = ids.flatMap((id) => (computed[id] ? [computed[id].geometry.bounds] : []));
  return directionForOperation(
    from.direction,
    from.operation,
    to.operation,
    resolveSketchPlane(f.sketch.plane),
    boxes,
  );
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

/**
 * A pick made for the open dialog outside the viewport's own handling: in the timeline, in the
 * browser, or passed on by the viewport. Returns true when a dialog is open that takes its
 * picks this way, whether or not it had a use for this one: the pick is then not a selection.
 */
export function pickInDialog(item: Selection, additive = false): boolean {
  const dialog = appState.get().dialog;
  if (!isSolidDialog(dialog)) return false;
  const picked = pickedOf(item);
  const patch = picked
    ? applyPick(dialog, picked, { doc: documentStore.document, additive, faceIndexOf })
    : null;
  if (patch) appState.set({ dialog: { ...dialog, ...patch } as Dialog, hover: null });
  return true;
}

/** Reason why the dialog cannot be applied yet, or null when it is complete. */
export function dialogProblem(dialog: Dialog): string | null {
  if (isSolidDialog(dialog)) {
    return solidDialogProblem(dialog, documentStore.document, currentScope());
  }
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
function consumingSketch(cmd: Command, ...sketchIds: string[]): Command {
  return command(cmd.label, (doc) => {
    const next = cmd.apply(doc);
    if (next === doc) return doc;
    return sketchIds.reduce((d, id) => setSketchVisible(id, false).apply(d), next);
  });
}

export function commitDialog(): boolean {
  if (appState.get().dialog?.type === "text") return commitText();
  let dialog = appState.get().dialog;
  if (!dialog) return false;
  if (dialog.type === "move" && dialog.mode === "free" && !dialog.pivot) {
    // The bodies turn about the point where the manipulator stands: store it with the move.
    dialog = { ...dialog, pivot: bodiesCenter(modelState.get().bodies, dialog.bodyIds) };
  }
  const problem = dialogProblem(dialog);
  if (problem) {
    toast(problem, "warning");
    return false;
  }
  const out: CreatedRef = {};
  let ok = false;
  if (isSolidDialog(dialog)) {
    const cmd = solidDialogCommand(dialog, out);
    if (!cmd) return false;
    ok = run(dialog.editing ? cmd : consumingSketch(cmd, ...consumedSketches(dialog)));
    if (!ok && !dialog.editing) {
      toast("The feature could not be created. Check what is selected.", "warning");
    }
  }
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
    const texts = selection.flatMap((s) =>
      s.kind === "text" && s.sketchId === activeSketchId ? [s.textId] : [],
    );
    if (entities.length + constraints.length + dimensions.length + texts.length === 0) return;
    if (entities.length + constraints.length + dimensions.length === 0) {
      deleteTexts(activeSketchId, texts);
      setSelection([]);
      appState.set({ hover: null });
      return;
    }
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
        if (texts.length > 0) b.replace(removeTexts(b.current, texts));
      }),
    );
    setSelection([]);
    appState.set({ hover: null });
    return;
  }
  const features = new Set<string>();
  const doc = documentStore.document;
  for (const s of selection) {
    if (s.kind === "feature" || s.kind === "plane") features.add(s.featureId);
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
    case "offset-plane":
      return "offset-plane";
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
    case "hole":
      return "hole";
    case "rectangular-pattern":
      return "pattern-rectangular";
    case "circular-pattern":
      return "pattern-circular";
    case "mirror":
      return "mirror-3d";
    case "move":
      return feature.copy ? "copy-3d" : "move-3d";
    case "align":
      return "align";
    case "split":
      return "split";
    case "sweep":
      return "sweep";
    case "loft":
      return "loft";
  }
};
