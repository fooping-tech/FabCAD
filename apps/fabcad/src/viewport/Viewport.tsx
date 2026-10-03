import { type Plane3, planeToWorld, type Vec3 } from "@fabcad/geometry";
import {
  type PlanePatch,
  offsetPlanePatch,
  resolveSketchPlane,
} from "@fabcad/features";
import { profileRefOf, sketchBounds } from "@fabcad/sketch";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  closeDialog,
  discardAutoSketch,
  enterSketch,
  faceAsProfile,
  finishSketch,
  patchDialog,
  pickInDialog,
  startSketchOnFace,
  startSketchOnOrigin,
  startSketchOnPlane,
} from "../app/actions";
import {
  type Dialog,
  type Selection,
  type SolidDialog,
  appState,
  isAdditiveClick,
  noteViewportPoint,
  select,
  selectionKey,
  toast,
} from "../app/appState";
import { openContextMenu } from "../app/contextMenu";
import {
  EXTRUDE_TO_WANTS,
  type PickWants,
  dialogReferences,
  dialogWants,
  isPathCurve,
  isSolidDialog,
} from "../app/solidDialogs";
import {
  edgeIndexOf,
  edgeRefOf,
  faceIndexOf,
  faceRefOf,
  facesOfFeatures,
  vertexPointOf,
} from "../app/topology";
import {
  type TopologyRef,
  evaluateAs,
  listBodies,
  listInstances,
  validComponentId,
} from "@fabcad/cad-document";
import { instanceWorldTransform } from "@fabcad/assembly";
import {
  currentScope,
  documentStore,
  editSketchSolved,
  modelState,
  sketchView,
  useDocument,
} from "../app/session";
import { useStore } from "../app/tinyStore";
import { useNumericKeypad } from "../panels/ExpressionInput";
import { projectPick } from "../sketch/projectTool";
import { type HoverProfile, SketchController } from "../sketch/SketchController";
import { editSketch } from "@fabcad/sketch";
import { createDoubleTapDetector } from "../ui/gestures";
import { Icon } from "../ui/Icon";
import { registerViewport } from "./api";
import { PointEntry } from "../panels/PointEntry";
import { dragStep, extrudeManipulator } from "./extrudeManipulator";
import { type Highlight, type Pick3D, type ViewName, ViewportScene } from "./scene";
import {
  IDENTITY,
  type MoveContext,
  formatValue,
  moveGizmo,
  movePreview,
  turnAngles,
} from "../app/moveTransform";
import { type DialogHandle, dialogHandles, referencePatch } from "../app/dialogHandles";
import { extrudeTargetReach } from "../app/extrudeTarget";
import { angleOnRing, arrowScreen, drawHandle, handleAt, handlePoint } from "./dialogHandleView";
import {
  type GizmoPart,
  drawMoveGizmo,
  gizmoPartAt,
  gizmoPartPoint,
  partDirection,
  ringAngle,
  ringPlane,
  samePart,
} from "./moveManipulator";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
];

function pickToSelection(pick: Pick3D): Selection {
  switch (pick.kind) {
    case "face":
      return { ...pick };
    case "edge":
      return { ...pick };
    case "vertex":
      return { ...pick };
    case "origin-plane":
      return { kind: "origin-plane", plane: pick.plane };
    case "plane":
      return { kind: "plane", featureId: pick.featureId };
    case "instance":
      return { kind: "instance", instanceId: pick.instanceId };
  }
}

function selectionToHighlight(s: Selection): Highlight | null {
  switch (s.kind) {
    case "body":
      return { kind: "body", bodyId: s.bodyId };
    case "face":
      return { kind: "face", bodyId: s.bodyId, faceIndex: s.faceIndex };
    case "edge":
      return { kind: "edge", bodyId: s.bodyId, edgeIndex: s.edgeIndex };
    case "vertex":
      return { kind: "vertex", bodyId: s.bodyId, point: s.point };
    case "origin-plane":
      return { kind: "origin-plane", plane: s.plane };
    case "plane":
      return { kind: "plane", featureId: s.featureId };
    case "instance":
      return { kind: "instance", instanceId: s.instanceId };
    default:
      return null;
  }
}

/** A plane square placed by a row-major 4×4 matrix. */
function transformPatch(patch: PlanePatch, m: number[]): PlanePatch {
  const point = (p: Vec3): Vec3 => ({
    x: m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + m[3]!,
    y: m[4]! * p.x + m[5]! * p.y + m[6]! * p.z + m[7]!,
    z: m[8]! * p.x + m[9]! * p.y + m[10]! * p.z + m[11]!,
  });
  const dir = (d: Vec3): Vec3 => ({
    x: m[0]! * d.x + m[1]! * d.y + m[2]! * d.z,
    y: m[4]! * d.x + m[5]! * d.y + m[6]! * d.z,
    z: m[8]! * d.x + m[9]! * d.y + m[10]! * d.z,
  });
  const { origin, xDir, yDir, normal } = patch.plane;
  return {
    plane: { origin: point(origin), xDir: dir(xDir), yDir: dir(yDir), normal: dir(normal) },
    center: point(patch.center),
    size: patch.size,
  };
}

const INSTANCE_PICK_MESSAGE =
  "A component instance cannot be used in a command. Activate the component to edit it.";

const near = (a: Vec3, b: Vec3, tol = 1e-4): boolean =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;

/** Highlights for the references held by an open feature dialog. */
function dialogHighlights(dialog: Dialog | null, scene: ViewportScene): Highlight[] {
  if (!dialog) return [];
  const out: Highlight[] = [];
  if ((dialog.type === "fillet" || dialog.type === "chamfer") && dialog.bodyId) {
    for (const ref of dialog.edges) {
      const edgeIndex = edgeIndexOf(dialog.bodyId, ref);
      if (edgeIndex >= 0) out.push({ kind: "edge", bodyId: dialog.bodyId, edgeIndex });
    }
  } else if (dialog.type === "shell" && dialog.bodyId) {
    for (const ref of dialog.faces) {
      const faceIndex = faceIndexOf(dialog.bodyId, ref);
      if (faceIndex >= 0) out.push({ kind: "face", bodyId: dialog.bodyId, faceIndex });
    }
  } else if (dialog.type === "combine") {
    if (dialog.targetBodyId) out.push({ kind: "body", bodyId: dialog.targetBodyId });
    for (const id of dialog.toolBodyIds) out.push({ kind: "body", bodyId: id });
  } else if ((dialog.type === "extrude" || dialog.type === "revolve") && dialog.operation !== "new") {
    // Targets are listed in the dialog; tinting every body would hide the profile.
  } else if (isSolidDialog(dialog)) {
    // Sketch points, lines and profiles are drawn by the sketch overlay.
    const refs = dialogReferences(dialog);
    for (const bodyId of refs.bodies) out.push({ kind: "body", bodyId });
    for (const face of facesOfFeatures(refs.features)) out.push({ kind: "face", ...face });
    for (const { bodyId, ref } of refs.faces) {
      const faceIndex = faceIndexOf(bodyId, ref);
      if (faceIndex >= 0) out.push({ kind: "face", bodyId, faceIndex });
    }
    for (const { bodyId, ref } of refs.edges) {
      const edgeIndex = edgeIndexOf(bodyId, ref);
      if (edgeIndex >= 0) out.push({ kind: "edge", bodyId, edgeIndex });
    }
    for (const p of refs.points) {
      const point = p.type === "vertex" ? vertexPointOf(p) : p.point;
      if (point && p.type === "vertex") out.push({ kind: "vertex", bodyId: p.bodyId, point });
    }
    for (const plane of refs.originPlanes) out.push({ kind: "origin-plane", plane });
    for (const featureId of refs.planes) out.push({ kind: "plane", featureId });
  }
  return out;
}

/** How far the Extrude dialog reaches when it goes up to a target; null otherwise. */
function extrudeReachOf(dialog: Extract<Dialog, { type: "extrude" }>): number | null {
  const model = modelState.get();
  const found = extrudeTargetReach(dialog, {
    doc: documentStore.document,
    bodies: model.bodies,
    planes: model.planes,
    scope: currentScope(),
  });
  return found && "reach" in found ? found.reach : null;
}

/** The plane that the Offset Plane dialog would make, for the preview. */
function offsetPlanePreview(dialog: Dialog | null): PlanePatch | null {
  if (dialog?.type !== "offset-plane" || !dialog.base) return null;
  const model = modelState.get();
  const base = referencePatch(dialog.base, {
    doc: documentStore.document,
    bodies: model.bodies,
    planes: model.planes,
    scope: currentScope(),
  });
  if (!base) return null;
  try {
    const offset = evaluateAs(dialog.offset, "length", currentScope());
    return Number.isFinite(offset) ? offsetPlanePatch(base, offset) : null;
  } catch {
    return null;
  }
}

export function Viewport(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const webglRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ViewportScene | null>(null);
  const controllerRef = useRef<SketchController | null>(null);
  const [ready, setReady] = useState(false);

  const doc = useDocument();
  const app = useStore(appState);
  const model = useStore(modelState);
  const activeComponent = app.activeComponentId;

  // ------------------------------------------------------------------ set-up
  useEffect(() => {
    const host = hostRef.current;
    const webgl = webglRef.current;
    const overlay = overlayRef.current;
    if (!host || !webgl || !overlay) return;
    const scene = new ViewportScene(webgl);
    const controller = new SketchController(overlay, scene);
    sceneRef.current = scene;
    controllerRef.current = controller;
    const off = scene.onChange(() => controller.requestDraw());

    const resize = (): void => {
      const r = host.getBoundingClientRect();
      scene.resize(r.width, r.height);
      controller.resize(r.width, r.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    setReady(true);

    const info = (e: PointerEvent | MouseEvent) => {
      const r = webgl.getBoundingClientRect();
      return {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        // The multi-selection mode stands in for Shift where there is no keyboard.
        shift: e.shiftKey || appState.get().multiSelect,
        meta: e.metaKey || e.ctrlKey,
      };
    };

    let down: { x: number; y: number; button: number; time: number } | null = null;

    /** What the active input of a feature dialog would take from under the pointer. */
    const hoverForDialog = (wants: PickWants, x: number, y: number): void => {
      let hover: Selection | null = null;
      let profile: HoverProfile | null = null;
      const entity = (e: { sketchId: string; entityId: string } | null): Selection | null =>
        e ? { kind: "entity", sketchId: e.sketchId, entityId: e.entityId } : null;
      // Points first, then curves, then areas: the smaller target wins.
      if (wants.sketchPoints) {
        hover = entity(controller.entityAt(x, y, { curves: false, origin: true, through: true }));
      }
      if (!hover && wants.vertices) {
        const pick = scene.pick(x, y, { faces: false, edges: false, vertices: true });
        if (pick?.kind === "vertex") hover = pickToSelection(pick);
      }
      if (!hover && (wants.sketchLines || wants.sketchCurves)) {
        const path = wants.sketchCurves === true;
        hover = entity(
          controller.entityAt(x, y, {
            points: false,
            through: true,
            accept: (e) => (path ? isPathCurve(e) : e.type === "line"),
          }),
        );
      }
      if (!hover && wants.edges) {
        const pick = scene.pick(x, y, { faces: false, edges: true, vertices: false });
        if (pick?.kind === "edge") {
          const curve = scene.bodyGeometry(pick.bodyId)?.edges[pick.edgeIndex]?.curve;
          if (curve === "line" || (wants.edges === "axis" && curve === "circle")) {
            hover = pickToSelection(pick);
          }
        }
      }
      if (!hover && wants.profiles) {
        profile = controller.profileAt(x, y, { visibleOnly: true }) ?? controller.profileAt(x, y);
      }
      if (!hover && !profile && (wants.faces || wants.originPlanes)) {
        const pick = scene.pick(x, y, {
          faces: wants.faces !== undefined,
          edges: false,
          vertices: false,
          originPlanes: wants.originPlanes === true,
        });
        if (pick?.kind === "origin-plane" || pick?.kind === "plane") hover = pickToSelection(pick);
        else if (pick?.kind === "face" && (wants.faces === "any" || pick.planar)) {
          hover = pickToSelection(pick);
        }
      }
      if (!hover && !profile && wants.bodies) {
        const id = scene.pickBody(x, y);
        if (id) hover = { kind: "body", bodyId: id };
      }
      controller.setHoverProfile(profile);
      const previous = appState.get().hover;
      if ((previous ? selectionKey(previous) : "") !== (hover ? selectionKey(hover) : "")) {
        appState.set({ hover });
      }
    };

    const hover3d = (x: number, y: number): void => {
      const state = appState.get();
      const dialog = state.dialog;
      if (isSolidDialog(dialog)) {
        hoverForDialog(dialogWants(dialog), x, y);
        return;
      }
      if (dialog?.type === "extrude" && dialog.picking === "to") {
        controller.setHoverProfile(null);
        hoverForDialog(EXTRUDE_TO_WANTS, x, y);
        return;
      }
      if (dialog && (dialog.type === "extrude" || dialog.type === "revolve")) {
        const wantsAxis = dialog.type === "revolve" && dialog.picking === "axis";
        if (wantsAxis && dialog.sketchId) {
          const line = controller.lineAt(x, y, dialog.sketchId);
          controller.setHoverProfile(null);
          const hover: Selection | null = line
            ? { kind: "entity", sketchId: dialog.sketchId, entityId: line }
            : null;
          if ((state.hover ? selectionKey(state.hover) : "") !== (hover ? selectionKey(hover) : "")) {
            appState.set({ hover });
          }
          return;
        }
        const profile =
          controller.profileAt(x, y, { visibleOnly: true }) ?? controller.profileAt(x, y);
        controller.setHoverProfile(profile);
        // Without a profile under the pointer, a planar face of a body can be extruded too.
        let face: Selection | null = null;
        if (!profile && dialog.type === "extrude" && !dialog.editing) {
          const pick = scene.pick(x, y, { faces: true, edges: false, vertices: false });
          if (pick?.kind === "face" && pick.planar) face = pickToSelection(pick);
        }
        if ((state.hover ? selectionKey(state.hover) : "") !== (face ? selectionKey(face) : "")) {
          appState.set({ hover: face });
        }
        return;
      }
      controller.setHoverProfile(null);
      const filter = state.selectionFilter;
      let hover: Selection | null = null;
      if (filter === "body") {
        const id = scene.pickBody(x, y);
        const instance = id ? null : scene.pickInstance(x, y);
        if (id) hover = { kind: "body", bodyId: id };
        else if (instance) hover = { kind: "instance", instanceId: instance };
      } else {
        const pick = scene.pick(x, y, {
          faces: filter === "auto" || filter === "face",
          edges: filter === "auto" || filter === "edge",
          vertices: filter === "auto" || filter === "vertex",
          originPlanes: dialog?.type === "pick-sketch-plane" || filter === "auto",
        });
        if (pick) hover = pickToSelection(pick);
      }
      // A sketch drawn on a face lies on top of it: its profiles win over the face below.
      // Edges and vertices keep their priority, and so does an explicit selection filter.
      // Sketches lie on top of the face or origin plane they were drawn on: their curves and
      // profiles win over what is below. Edges and vertices of bodies keep their priority,
      // and so does an explicit selection filter.
      const below =
        hover?.kind === "face" || hover?.kind === "origin-plane" || hover?.kind === "plane";
      if (!dialog && (hover === null || (below && filter === "auto"))) {
        const entity = controller.entityAt(x, y);
        if (entity) {
          hover = { kind: "entity", sketchId: entity.sketchId, entityId: entity.entityId };
        } else {
          const profile = controller.profileAt(x, y, { visibleOnly: true });
          controller.setHoverProfile(profile);
          if (profile) hover = null;
        }
      }
      if ((state.hover ? selectionKey(state.hover) : "") !== (hover ? selectionKey(hover) : "")) {
        appState.set({ hover });
      }
    };

    const click3d = (x: number, y: number, additive: boolean): void => {
      const state = appState.get();
      const dialog = state.dialog;
      hover3d(x, y);
      const hover = appState.get().hover;
      const profile = controller.hoveredProfile;

      // Commands work on the geometry of the active component; an instance shows a definition
      // somewhere else, so nothing of it can be picked.
      if (dialog && !profile && (hover === null || hover.kind === "instance") && scene.pickInstance(x, y)) {
        toast(INSTANCE_PICK_MESSAGE, "warning");
        return;
      }

      if (dialog?.type === "pick-sketch-plane") {
        if (hover?.kind === "origin-plane") startSketchOnOrigin(hover.plane);
        else if (hover?.kind === "plane") startSketchOnPlane(hover.featureId);
        else if (hover?.kind === "face" && hover.planar) {
          startSketchOnFace(hover.bodyId, hover.point, hover.normal, hover.faceIndex);
        } else if (hover?.kind === "face") {
          toast("Sketches need a planar face.", "warning");
        }
        return;
      }
      if (isSolidDialog(dialog)) {
        const item: Selection | null =
          hover ??
          (profile
            ? {
                kind: "profile",
                sketchId: profile.sketchId,
                regionId: profile.region.id,
                ref: profileRefOf(profile.region),
              }
            : null);
        if (item) {
          pickInDialog(item, additive);
          controller.setHoverProfile(null);
        } else if (dialogWants(dialog).faces === "planar") {
          const pick = scene.pick(x, y, { faces: true, edges: false, vertices: false });
          if (pick?.kind === "face" && !pick.planar) toast("Select a flat face.", "warning");
        }
        return;
      }
      if (dialog?.type === "extrude" && dialog.picking === "to") {
        if (hover) pickInDialog(hover);
        return;
      }
      if (dialog && (dialog.type === "extrude" || dialog.type === "revolve")) {
        if (dialog.type === "revolve" && dialog.picking === "axis") {
          if (hover?.kind === "entity") {
            patchDialog({ axis: { type: "sketch-line", entityId: hover.entityId } });
          }
          return;
        }
        if (!profile) {
          if (dialog.type !== "extrude" || hover?.kind !== "face") return;
          const made = faceAsProfile(hover.bodyId, hover.point, hover.normal, hover.faceIndex);
          if (!made) return;
          // The face replaces what was picked before.
          discardAutoSketch(dialog.autoSketch);
          patchDialog({
            sketchId: made.sketchId,
            profiles: made.profiles,
            autoSketch: made.sketchId,
            operation: dialog.operation === "new" ? "join" : dialog.operation,
            targetBodyIds: [hover.bodyId],
          });
          appState.set({ hover: null });
          return;
        }
        const ref = profileRefOf(profile.region);
        if (dialog.sketchId !== profile.sketchId) {
          patchDialog({ sketchId: profile.sketchId, profiles: [ref], ...(dialog.type === "revolve" ? { axis: null } : {}) });
          return;
        }
        const same = (r: typeof ref): boolean =>
          r.textId !== undefined || ref.textId !== undefined
            ? r.textId === ref.textId
            : r.entityIds.length === ref.entityIds.length &&
          r.entityIds.every((e) => ref.entityIds.includes(e)) &&
          Math.hypot(r.point.x - ref.point.x, r.point.y - ref.point.y) < 1e-6;
        const exists = dialog.profiles.some(same);
        patchDialog({
          profiles: exists ? dialog.profiles.filter((r) => !same(r)) : [...dialog.profiles, ref],
        });
        return;
      }
      if (dialog && (dialog.type === "fillet" || dialog.type === "chamfer")) {
        if (hover?.kind !== "edge") return;
        const picked = edgeRefOf(hover.bodyId, hover.edgeIndex, hover.point);
        if (dialog.bodyId && dialog.bodyId !== hover.bodyId) {
          patchDialog({ bodyId: hover.bodyId, edges: [picked] });
          return;
        }
        const same = (e: TopologyRef): boolean =>
          edgeIndexOf(hover.bodyId, e) === hover.edgeIndex;
        patchDialog({
          bodyId: hover.bodyId,
          edges: dialog.edges.some(same)
            ? dialog.edges.filter((e) => !same(e))
            : [...dialog.edges, picked],
        });
        return;
      }
      if (dialog?.type === "shell") {
        if (hover?.kind !== "face") return;
        const picked = faceRefOf(hover.bodyId, hover.faceIndex, hover.point, hover.normal);
        if (dialog.bodyId && dialog.bodyId !== hover.bodyId) {
          patchDialog({ bodyId: hover.bodyId, faces: [picked] });
          return;
        }
        const same = (f: TopologyRef): boolean =>
          faceIndexOf(hover.bodyId, f) === hover.faceIndex;
        patchDialog({
          bodyId: hover.bodyId,
          faces: dialog.faces.some(same)
            ? dialog.faces.filter((f) => !same(f))
            : [...dialog.faces, picked],
        });
        return;
      }
      if (dialog?.type === "combine") {
        const id = hover && "bodyId" in hover ? hover.bodyId : scene.pickBody(x, y);
        if (!id) return;
        if (dialog.picking === "target" || !dialog.targetBodyId) {
          patchDialog({
            targetBodyId: id,
            toolBodyIds: dialog.toolBodyIds.filter((t) => t !== id),
            picking: "tools",
          });
        } else if (id !== dialog.targetBodyId) {
          patchDialog({
            toolBodyIds: dialog.toolBodyIds.includes(id)
              ? dialog.toolBodyIds.filter((t) => t !== id)
              : [...dialog.toolBodyIds, id],
          });
        }
        return;
      }

      if (hover) {
        select(hover, additive);
      } else if (profile) {
        select(
          {
            kind: "profile",
            sketchId: profile.sketchId,
            regionId: profile.region.id,
            ref: profileRefOf(profile.region),
          },
          additive,
        );
      } else {
        select(null, additive);
      }
    };

    // ------------------------------------------------- dialog handles
    // Arrows and rings that set a value of the open dialog by dragging (`dialogHandles`).
    let manipulator: {
      pointerId: number;
      key: string;
      start: number;
      /** Linear: the axis parameter it was grabbed at. Angular: the angle seen last. */
      grab: number;
      turned: number;
      handle: DialogHandle;
    } | null = null;
    let manipulatorHover: string | null = null;

    const currentHandles = (): DialogHandle[] => {
      const state = appState.get();
      if (state.activeSketchId || state.workspace !== "design") return [];
      const model = modelState.get();
      return dialogHandles(state.dialog, {
        doc: documentStore.document,
        bodies: model.bodies,
        planes: model.planes,
        scope: currentScope(),
      });
    };

    const overManipulator = (x: number, y: number, reach: number): DialogHandle | null =>
      handleAt(scene, currentHandles(), x, y, reach);

    const dragHandle = (x: number, y: number, fine: boolean): void => {
      const drag = manipulator;
      if (!drag) return;
      const h = drag.handle;
      let value: number;
      let step: number;
      if (h.kind === "linear") {
        const t = scene.axisParameter(x, y, h.origin, h.direction);
        if (t === null) return;
        value = drag.start + (t - drag.grab) / h.factor;
        step = fine ? 0.001 : dragStep(scene.pixelSize(h.origin) / Math.abs(h.factor));
      } else {
        const a = angleOnRing(scene, h, x, y);
        if (a === null) return;
        // Unwrap, so that a drag can go round more than once.
        let d = a - drag.grab;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        drag.grab = a;
        drag.turned += d;
        value = drag.start + drag.turned;
        step = fine ? 0.1 : 1;
      }
      let snapped = Math.round(value / step) * step;
      if (h.positive) snapped = Math.max(step, snapped);
      patchDialog(h.patch(snapped));
    };

    // --------------------------------------------------- move manipulator
    let moveDrag: {
      pointerId: number;
      part: GizmoPart;
      center: Vec3;
      direction: Vec3;
      /** Arrows: the axis parameter where it was grabbed. Rings: the angle it was grabbed at. */
      grab: number;
      plane: Plane3;
      /** Rings: the angle seen last and the turn so far (it may go past a full turn). */
      last: number;
      turned: number;
      start: { x: number; y: number; z: number; rx: number; ry: number; rz: number; angle: number };
    } | null = null;
    let moveHover: GizmoPart | null = null;
    let moveLabel: string | null = null;

    const moveContext = (): MoveContext => ({
      doc: documentStore.document,
      bodies: modelState.get().bodies,
      scope: currentScope(),
    });

    const currentGizmo = (): ReturnType<typeof moveGizmo> => {
      const state = appState.get();
      if (state.activeSketchId || state.workspace !== "design") return null;
      return state.dialog?.type === "move" ? moveGizmo(state.dialog, moveContext()) : null;
    };

    const startMoveDrag = (pointerId: number, part: GizmoPart, x: number, y: number): boolean => {
      const gizmo = currentGizmo();
      const dialog = appState.get().dialog;
      if (!gizmo || dialog?.type !== "move") return false;
      const direction = partDirection(gizmo, part);
      const plane = ringPlane(gizmo.center, direction);
      const grab =
        part.kind === "arrow"
          ? scene.axisParameter(x, y, gizmo.center, direction)
          : ringAngle(scene, plane, x, y);
      if (grab === null) return false;
      const scope = currentScope();
      const value = (e: string, kind: "length" | "angle"): number => {
        try {
          const v = evaluateAs(e, kind, scope);
          return Number.isFinite(v) ? v : 0;
        } catch {
          return 0;
        }
      };
      moveDrag = {
        pointerId,
        part,
        center: gizmo.center,
        direction,
        grab,
        plane,
        last: grab,
        turned: 0,
        start: {
          x: value(dialog.x, "length"),
          y: value(dialog.y, "length"),
          z: value(dialog.z, "length"),
          rx: value(dialog.rx, "angle"),
          ry: value(dialog.ry, "angle"),
          rz: value(dialog.rz, "angle"),
          angle: value(dialog.angle, "angle"),
        },
      };
      return true;
    };

    const dragMove = (x: number, y: number, fine: boolean): void => {
      const drag = moveDrag;
      if (!drag) return;
      const part = drag.part;
      if (part.kind === "arrow") {
        const t = scene.axisParameter(x, y, drag.center, drag.direction);
        if (t === null) return;
        const key = (["x", "y", "z"] as const)[part.axis]!;
        const step = fine ? 0.001 : dragStep(scene.pixelSize(drag.center));
        const value = Math.round((drag.start[key] + t - drag.grab) / step) * step;
        moveLabel = `${key.toUpperCase()} ${formatValue(value)} mm`;
        patchDialog({ [key]: formatValue(value) });
        return;
      }
      const a = ringAngle(scene, drag.plane, x, y);
      if (a === null) return;
      // Unwrap, so that a drag can go round more than once.
      let d = a - drag.last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      drag.last = a;
      drag.turned += d;
      const step = fine ? 0.1 : 1;
      const delta = Math.round(drag.turned / step) * step;
      if (part.kind === "axis-ring") {
        const angle = drag.start.angle + delta;
        moveLabel = `${formatValue(angle)}°`;
        patchDialog({ angle: formatValue(angle) });
        return;
      }
      const s = drag.start;
      const angles = turnAngles({ x: s.rx, y: s.ry, z: s.rz }, part.axis, delta);
      moveLabel = `${"XYZ"[part.axis]} ${formatValue(delta)}°`;
      patchDialog({ rx: formatValue(angles.x), ry: formatValue(angles.y), rz: formatValue(angles.z) });
    };

    const endMoveDrag = (pointerId: number): void => {
      moveDrag = null;
      moveLabel = null;
      scene.setControlsEnabled(true);
      if (webgl.hasPointerCapture(pointerId)) webgl.releasePointerCapture(pointerId);
      controller.requestDraw();
    };

    controller.overlayPainter = (ctx) => {
      for (const h of currentHandles()) {
        const dragging = manipulator?.key === h.key;
        drawHandle(ctx, scene, h, dragging ? "drag" : !manipulator && manipulatorHover === h.key ? "hover" : "idle");
      }
      const gizmo = currentGizmo();
      if (gizmo) drawMoveGizmo(ctx, scene, gizmo, moveHover, moveDrag?.part ?? null, moveLabel);
    };

    // ------------------------------------------------------ project tool
    const projecting = (): boolean =>
      appState.get().activeSketchId !== null && appState.get().tool === "project";

    const projectHover = (x: number, y: number): Selection | null => {
      const pick = scene.pick(x, y, { faces: true, edges: true, vertices: true });
      const hover =
        pick && pick.kind !== "origin-plane" && pick.kind !== "plane"
          ? pickToSelection(pick)
          : null;
      const prev = appState.get().hover;
      if ((prev ? selectionKey(prev) : "") !== (hover ? selectionKey(hover) : "")) {
        appState.set({ hover });
      }
      return hover;
    };

    const projectClick = (x: number, y: number): void => {
      const hover = projectHover(x, y);
      if (!hover) return;
      if (hover.kind === "edge") projectPick({ kind: "edge", bodyId: hover.bodyId, edgeIndex: hover.edgeIndex });
      else if (hover.kind === "face") projectPick({ kind: "face", bodyId: hover.bodyId, faceIndex: hover.faceIndex });
      else if (hover.kind === "vertex") projectPick({
          kind: "vertex",
          bodyId: hover.bodyId,
          vertexIndex: hover.vertexIndex,
          point: hover.point,
        });
      appState.set({ hover: null });
    };

    // ---------------------------------------------------------- pointers
    const touches = new Set<number>();
    /** A touch that places a point when the finger is lifted, so that it can be aimed first. */
    let touchPick: { id: number; aborted: boolean } | null = null;
    /** A one-finger swipe over empty sketch space that moves the view. */
    let touchPan: { id: number; x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent): void => {
      const touch = e.pointerType === "touch";
      controller.setCoarse(touch);
      scene.setTouchInput(touch);
      if (touch) {
        // The primary pointer starts a new gesture: forget fingers whose release was missed.
        if (e.isPrimary) touches.clear();
        touches.add(e.pointerId);
      }
      down = { x: e.clientX, y: e.clientY, button: e.button, time: e.timeStamp };
      if (e.button !== 0) return;
      noteViewportPoint(e.clientX, e.clientY);
      const p = info(e);

      if (touch && touches.size > 1) {
        // A second finger means pan / zoom: whatever the first finger started is called off.
        doubleTap.reset();
        if (touchPick) touchPick.aborted = true;
        touchPan = null;
        controller.cancelDrag();
        controller.clearCursor();
        down = null;
        return;
      }

      const gizmo = currentGizmo();
      const part = gizmo ? gizmoPartAt(scene, gizmo, p.x, p.y, touch ? 22 : 8) : null;
      if (part && startMoveDrag(e.pointerId, part, p.x, p.y)) {
        // The manipulator owns this gesture: keep the camera controls and selection out of it.
        e.stopImmediatePropagation();
        e.preventDefault();
        webgl.setPointerCapture(e.pointerId);
        scene.setControlsEnabled(false);
        down = null;
        controller.requestDraw();
        return;
      }

      const hit = overManipulator(p.x, p.y, touch ? 34 : 18);
      if (hit) {
        const grab =
          hit.kind === "linear"
            ? scene.axisParameter(p.x, p.y, hit.origin, hit.direction)
            : angleOnRing(scene, hit, p.x, p.y);
        if (grab !== null) {
          // The handle owns this gesture: keep the camera controls out of it.
          e.stopImmediatePropagation();
          e.preventDefault();
          webgl.setPointerCapture(e.pointerId);
          scene.setControlsEnabled(false);
          manipulator = { pointerId: e.pointerId, key: hit.key, start: hit.value, grab, turned: 0, handle: hit };
          down = null;
          controller.requestDraw();
          return;
        }
      }

      if (!appState.get().activeSketchId) {
        if (touch) scene.setOneFingerGesture("rotate");
        return;
      }
      if (touch && appState.get().tool !== "select" && controller.grabs(p)) {
        // The previewed Offset curve follows the finger right away.
        scene.setOneFingerGesture("none");
        controller.pointerDown(p);
        return;
      }
      if (touch && appState.get().tool !== "select") {
        scene.setOneFingerGesture("none");
        touchPick = { id: e.pointerId, aborted: false };
        if (projecting()) projectHover(p.x, p.y);
        else controller.pointerMove(p);
        return;
      }
      if (projecting()) {
        projectClick(p.x, p.y);
        return;
      }
      if (touch && !controller.hitsSomething(p)) {
        // Swiping over empty space moves the view; a tap still selects.
        scene.setOneFingerGesture("pan");
        touchPan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        return;
      }
      if (touch) scene.setOneFingerGesture("none");
      controller.pointerDown(p);
    };

    const onPointerMove = (e: PointerEvent): void => {
      const p = info(e);
      if (moveDrag) {
        if (e.pointerId === moveDrag.pointerId) dragMove(p.x, p.y, e.altKey);
        return;
      }
      if (manipulator) {
        if (e.pointerId === manipulator.pointerId) dragHandle(p.x, p.y, e.altKey);
        return;
      }
      if (appState.get().activeSketchId) {
        if (e.pointerType === "touch") {
          if (touches.size > 1 || touchPan) return;
          if (touchPick && (touchPick.aborted || touchPick.id !== e.pointerId)) return;
        }
        if (projecting()) {
          if (e.buttons === 0 || e.pointerType === "touch") projectHover(p.x, p.y);
          return;
        }
        if (e.buttons === 0 || e.buttons === 1) controller.pointerMove(p);
        return;
      }
      if (e.buttons !== 0) return;
      if (appState.get().workspace !== "design") return;
      const gizmo = currentGizmo();
      const part = gizmo ? gizmoPartAt(scene, gizmo, p.x, p.y, 8) : null;
      if (!samePart(part, moveHover) && (part || moveHover)) {
        moveHover = part;
        webgl.style.cursor = part ? "grab" : "";
        controller.requestDraw();
      }
      if (part) {
        controller.setHoverProfile(null);
        if (appState.get().hover) appState.set({ hover: null });
        return;
      }
      const key = overManipulator(p.x, p.y, 18)?.key ?? null;
      const over = key !== null;
      if (key !== manipulatorHover) {
        manipulatorHover = key;
        webgl.style.cursor = over ? "grab" : "";
        controller.requestDraw();
      }
      if (over) {
        controller.setHoverProfile(null);
        if (appState.get().hover) appState.set({ hover: null });
        return;
      }
      hover3d(p.x, p.y);
    };

    /**
     * Right-click, or double tap on a touch screen: select what is under the pointer and open
     * the menu.
     */
    const contextAt = (
      e: { clientX: number; clientY: number },
      p: ReturnType<typeof info>,
      held = false,
    ): void => {
      const state = appState.get();
      if (state.workspace !== "design") return;
      let target: Selection | null = null;
      if (state.activeSketchId) {
        target = state.tool === "select" ? controller.pickForMenu(p) : null;
      } else if (!state.dialog) {
        hover3d(p.x, p.y);
        target = appState.get().hover;
        const profile = controller.hoveredProfile;
        if (!target && profile) {
          target = {
            kind: "profile",
            sketchId: profile.sketchId,
            regionId: profile.region.id,
            ref: profileRefOf(profile.region),
          };
        }
      }
      // Like Fusion: the menu acts on the selection; a click on something else selects that.
      if (target && !state.selection.some((s) => selectionKey(s) === selectionKey(target))) {
        appState.set({ selection: [target] });
      }
      openContextMenu(e.clientX, e.clientY, held);
    };

    /**
     * Double tap is what opens the context menu on a touch screen. The first tap selects as
     * usual; the selection from before it comes back with the second tap, so that the menu
     * acts on what was selected, as a right-click on a selected object does.
     */
    const doubleTap = createDoubleTapDetector<{ selection: Selection[] }>();
    /** When the last double tap opened the menu: the `dblclick` that follows is part of it. */
    let doubleTapAt = -Infinity;

    /** Whether a double tap opens the context menu in the state the editor is in. */
    const doubleTapOpensMenu = (): boolean => {
      const state = appState.get();
      if (state.workspace !== "design" || state.measuring) return false;
      // A running sketch tool places points with taps; its commands are on the touch bar.
      if (state.activeSketchId) return state.tool === "select";
      return true;
    };

    /** True when the lifted finger was the second tap of a double tap and the menu opened. */
    const handleDoubleTap = (e: PointerEvent, start: NonNullable<typeof down>): boolean => {
      if (!doubleTapOpensMenu() || manipulator || moveDrag || touches.size > 0) {
        doubleTap.reset();
        return false;
      }
      const second = doubleTap.tap(
        { x: start.x, y: start.y, time: start.time },
        { x: e.clientX, y: e.clientY, time: e.timeStamp },
        { selection: appState.get().selection },
      );
      if (!second) return false;
      doubleTapAt = e.timeStamp;
      touchPick = null;
      touchPan = null;
      controller.cancelDrag();
      appState.set({ selection: second.first.selection });
      contextAt(e, info(e));
      return true;
    };

    const onPointerUp = (e: PointerEvent): void => {
      const touch = e.pointerType === "touch";
      if (touch) touches.delete(e.pointerId);
      if (e.button === 2 && !manipulator && !moveDrag) {
        const start = down;
        down = null;
        // A right-drag orbits; only a click without movement opens the menu.
        if (start?.button === 2 && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 4) {
          if (e.target === webgl) contextAt(e, info(e));
        }
        return;
      }
      if (moveDrag) {
        if (e.pointerId === moveDrag.pointerId) endMoveDrag(e.pointerId);
        return;
      }
      if (manipulator) {
        if (e.pointerId !== manipulator.pointerId) return;
        manipulator = null;
        scene.setControlsEnabled(true);
        if (webgl.hasPointerCapture(e.pointerId)) webgl.releasePointerCapture(e.pointerId);
        controller.requestDraw();
        return;
      }
      const start = down;
      down = null;
      if (e.button !== 0) return;
      const p = info(e);
      if (touch && start && e.target === webgl && handleDoubleTap(e, start)) return;
      if (appState.get().activeSketchId) {
        if (touchPan) {
          const pan = touchPan;
          touchPan = null;
          if (pan.id !== e.pointerId) return;
          if (Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 12) return;
          controller.pointerDown(p);
        }
        if (touchPick) {
          const pick = touchPick;
          touchPick = null;
          if (pick.id !== e.pointerId || pick.aborted) return;
          if (projecting()) {
            projectClick(p.x, p.y);
            return;
          }
          controller.pointerDown(p);
        }
        if (projecting()) return;
        controller.pointerUp(p);
        if (touch) controller.clearCursor();
        return;
      }
      if (!start || start.button !== 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > (touch ? 12 : 4)) return;
      if (appState.get().workspace !== "design") return;
      click3d(p.x, p.y, isAdditiveClick(e));
    };
    const onPointerCancel = (e: PointerEvent): void => {
      touches.delete(e.pointerId);
      doubleTap.reset();
      if (touchPick?.id === e.pointerId) touchPick = null;
      if (touchPan?.id === e.pointerId) touchPan = null;
      if (manipulator?.pointerId === e.pointerId) {
        manipulator = null;
        scene.setControlsEnabled(true);
      }
      if (moveDrag?.pointerId === e.pointerId) endMoveDrag(e.pointerId);
      controller.cancelDrag();
      down = null;
    };
    const onDoubleClick = (e: MouseEvent): void => {
      // The double tap that opened the context menu is not a double click as well.
      if (e.timeStamp - doubleTapAt < 600) return;
      const state = appState.get();
      if (state.activeSketchId) {
        controller.doubleClick(info(e));
        return;
      }
      if (state.workspace !== "design" || state.dialog) return;
      // Double-clicking sketch geometry in the solid environment opens its sketch.
      const p = info(e);
      const target = controller.entityAt(p.x, p.y)?.sketchId ??
        controller.profileAt(p.x, p.y, { visibleOnly: true })?.sketchId;
      if (target) enterSketch(target);
    };
    const onLeave = (): void => {
      controller.setHoverProfile(null);
      if (appState.get().hover) appState.set({ hover: null });
      appState.set({ cursor: null });
    };
    const onContextMenu = (e: MouseEvent): void => {
      // The menu of the mouse opens on the release of the right button (a right-drag orbits).
      // Android reports a long press as a context menu event: on a touch screen the menu
      // belongs to the double tap, so there is nothing to do but keep the browser's menu away.
      e.preventDefault();
    };
    // iOS Safari: keep the page itself from zooming while the view is pinched.
    const onGesture = (e: Event): void => e.preventDefault();
    host.addEventListener("gesturestart", onGesture);
    host.addEventListener("gesturechange", onGesture);

    // Capture phase: the manipulator must see the event before the camera controls do.
    webgl.addEventListener("pointerdown", onPointerDown, { capture: true });
    webgl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    webgl.addEventListener("dblclick", onDoubleClick);
    webgl.addEventListener("pointerleave", onLeave);
    webgl.addEventListener("contextmenu", onContextMenu);

    if (import.meta.env.DEV) {
      // Hooks for automated browser tests.
      (window as unknown as Record<string, unknown>).__fabcad = {
        documentStore,
        appState,
        modelState,
        sketchToScreen: (x: number, y: number) => {
          const id = appState.get().activeSketchId;
          const f = id ? documentStore.document.features[id] : undefined;
          if (f?.type !== "sketch") return null;
          const r = webgl.getBoundingClientRect();
          const s = scene.project(planeToWorld(resolveSketchPlane(f.sketch.plane), { x, y }));
          return { x: s.x + r.left, y: s.y + r.top };
        },
        view: () => ({
          ...scene.saveView(),
          pixel: scene.pixelSize(scene.saveView().target),
        }),
        /**
         * Screen point to grab a handle of the open dialog by (Extrude, Offset Plane, Revolve …);
         * `key` picks one where there are several (the field it sets). For an arrow,
         * `direction` is the way it points on screen.
         */
        manipulatorHandle: (key?: string) => {
          const handles = currentHandles();
          const h = key ? handles.find((x) => x.key === key) : handles[0];
          if (!h) return null;
          const r = webgl.getBoundingClientRect();
          const at = handlePoint(scene, h);
          return {
            handle: { x: at.x + r.left, y: at.y + r.top },
            direction: h.kind === "linear" ? arrowScreen(scene, h).direction : null,
          };
        },
        /** Screen point of a part of the Move manipulator, e.g. { kind: "arrow", axis: 0 }. */
        moveGizmoPoint: (part: GizmoPart) => {
          const gizmo = currentGizmo();
          const point = gizmo ? gizmoPartPoint(scene, gizmo, part) : null;
          if (!point) return null;
          const r = webgl.getBoundingClientRect();
          return { x: point.x + r.left, y: point.y + r.top };
        },
        worldToScreen: (x: number, y: number, z: number) => {
          const r = webgl.getBoundingClientRect();
          const s = scene.project({ x, y, z });
          return { x: s.x + r.left, y: s.y + r.top };
        },
      };
    }

    registerViewport({
      cancel: () => controller.cancel(),
      confirm: () => controller.confirm(),
      fit: () => scene.fitAll(sketchExtents()),
      setView: (view) => scene.setView(view),
      editDimension: (id) => controller.editDimension(id),
      typePoint: (point) => controller.typePoint(point),
      lastPick: () => controller.lastPick(),
    });

    return () => {
      off();
      observer.disconnect();
      webgl.removeEventListener("pointerdown", onPointerDown, { capture: true });
      webgl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      webgl.removeEventListener("dblclick", onDoubleClick);
      webgl.removeEventListener("pointerleave", onLeave);
      webgl.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("gesturestart", onGesture);
      host.removeEventListener("gesturechange", onGesture);
      registerViewport(null);
      controller.dispose();
      scene.dispose();
      sceneRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  // ------------------------------------------------------- bodies and origin
  const firstBodies = useRef(true);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ids = new Set(Object.keys(model.bodies));
    scene.retainBodies(ids);
    const hadBodies = scene.hasBodies();
    for (const b of Object.values(model.bodies)) scene.setBody(b.id, b.hash, b.geometry);
    // The bodies of the active component are shown where they are; with the root active, the
    // other components are shown through their instances.
    const active = validComponentId(doc, activeComponent);
    for (const b of Object.values(doc.bodies)) {
      scene.setBodyVisible(b.id, b.visible && b.componentId === active);
    }
    const rootActive = active === doc.assembly.rootComponentId;
    scene.setInstances(
      rootActive
        ? listInstances(doc)
            .filter((i) => i.visible)
            .map((i) => ({
              id: i.id,
              matrix: instanceWorldTransform(doc.assembly, i.id),
              bodyIds: listBodies(doc, i.componentId)
                .filter((b) => b.visible && model.bodies[b.id])
                .map((b) => b.id),
            }))
        : [],
    );
    scene.setOriginVisibility(doc.origin.visible, doc.origin.hidden);
    // Frame the model when the first body appears, and whenever it leaves the view.
    if (scene.hasBodies() && !appState.get().activeSketchId) {
      if (!hadBodies && firstBodies.current) scene.fitAll();
      else setTimeout(() => sceneRef.current?.ensureVisible(), 320);
      firstBodies.current = false;
    }
    if (!scene.hasBodies()) firstBodies.current = true;
    scene.setBodiesTransparent(appState.get().activeSketchId !== null);
    scene.invalidate();
  }, [model.bodies, doc.bodies, doc.origin, doc.assembly, activeComponent, ready]);

  // Switching components frames what is shown now.
  const shownComponent = useRef(activeComponent);
  useEffect(() => {
    if (shownComponent.current === activeComponent) return;
    shownComponent.current = activeComponent;
    const scene = sceneRef.current;
    // Not when a sketch was started at once (a plane of the component): it frames itself.
    if (scene) setTimeout(() => !appState.get().activeSketchId && scene.fitAll(sketchExtents()), 0);
  }, [activeComponent]);

  // ------------------------------------------------- construction planes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const sketching = app.activeSketchId !== null;
    const active = validComponentId(doc, activeComponent);
    const rootActive = active === doc.assembly.rootComponentId;
    scene.setPlanes(
      Object.values(model.planes).flatMap((p): { id: string; featureId?: string; patch: PlanePatch; visible: boolean }[] => {
        const f = doc.features[p.id];
        if (f?.type !== "offset-plane") return [];
        // Like the origin planes, construction planes step back while sketching.
        const shown = f.visible && !sketching;
        if (f.componentId === active) return [{ id: p.id, patch: p, visible: shown }];
        // At the root, the planes of a component are shown where its instances are. Picking
        // one picks the plane of the definition.
        if (!rootActive) return [];
        return listInstances(doc, f.componentId)
          .filter((i) => i.visible)
          .map((i) => ({
            id: `${p.id}@${i.id}`,
            featureId: p.id,
            patch: transformPatch(p, instanceWorldTransform(doc.assembly, i.id)),
            visible: shown,
          }));
      }),
    );
  }, [model.planes, doc.features, doc.assembly, app.activeSketchId, activeComponent, ready]);

  // ------------------------------------------------------------- highlights
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const items: { highlight: Highlight; mode: "hover" | "selected" }[] = [];
    for (const h of dialogHighlights(app.dialog, scene)) items.push({ highlight: h, mode: "selected" });
    for (const s of app.selection) {
      const h = selectionToHighlight(s);
      if (h) items.push({ highlight: h, mode: "selected" });
      if (s.kind === "feature" && doc.features[s.featureId]?.type === "offset-plane") {
        items.push({ highlight: { kind: "plane", featureId: s.featureId }, mode: "selected" });
      }
      if (s.kind === "component") {
        for (const i of listInstances(doc, s.componentId)) {
          items.push({ highlight: { kind: "instance", instanceId: i.id }, mode: "selected" });
        }
      }
      if (s.kind === "feature") {
        for (const b of Object.values(doc.bodies)) {
          if (b.createdBy === s.featureId) {
            items.push({ highlight: { kind: "body", bodyId: b.id }, mode: "selected" });
          }
        }
      }
    }
    if (app.hover) {
      const h = selectionToHighlight(app.hover);
      if (h) items.push({ highlight: h, mode: "hover" });
    }
    scene.setHighlights(items);
    controllerRef.current?.requestDraw();
  }, [app.selection, app.hover, app.dialog, model.bodies, model.planes, doc.bodies, doc.assembly, activeComponent, ready]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const showing = !app.activeSketchId && app.workspace === "design";
    scene.setPlanePreview(showing ? offsetPlanePreview(app.dialog) : null);
    // `doc.parameters`: the offset may be an expression.
  }, [app.dialog, app.activeSketchId, app.workspace, doc.parameters, model.planes, model.bodies, ready]);

  // ---------------------------------------------------- extrude preview
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const dialog = app.dialog;
    const m =
      dialog?.type === "extrude" && !app.activeSketchId && app.workspace === "design"
        ? extrudeManipulator(doc, dialog, extrudeReachOf(dialog))
        : null;
    scene.setExtrudePreview(
      m && m.distance !== null
        ? { plane: m.plane, regions: m.regions, from: m.from, to: m.to, removing: m.removing }
        : null,
    );
    controllerRef.current?.requestDraw();
  }, [app.dialog, app.activeSketchId, app.workspace, doc, model.bodies, model.planes, ready]);

  // ------------------------------------------------------- move preview
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const dialog = app.dialog;
    const showing = dialog?.type === "move" && !app.activeSketchId && app.workspace === "design";
    const preview = showing
      ? movePreview(dialog, { doc, bodies: model.bodies, scope: currentScope(doc) })
      : null;
    // Nothing moves yet: the preview would only cover the bodies.
    const still = !preview || preview.matrix.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-9);
    scene.setMovePreview(
      !still && dialog?.type === "move" ? { bodyIds: dialog.bodyIds, matrix: preview.matrix } : null,
    );
    controllerRef.current?.requestDraw();
  }, [app.dialog, app.activeSketchId, app.workspace, doc, model.bodies, ready]);

  // -------------------------------------------------------- sketch redraws
  useEffect(() => {
    controllerRef.current?.requestDraw();
  }, [doc, app.showConstraints, app.showDimensions, app.workspace, app.toolOptions, app.sketchOffset]);

  // Keep the sketch in view: a dimension can push geometry far outside the window.
  useEffect(() => {
    const scene = sceneRef.current;
    const id = appState.get().activeSketchId;
    if (!scene || !id || documentStore.inTransaction) return;
    const f = doc.features[id];
    if (f?.type !== "sketch") return;
    const b = sketchBounds(f.sketch);
    if (!b) return;
    const plane = resolveSketchPlane(f.sketch.plane);
    const { width, height } = scene.size;
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ].map((p) => scene.project(planeToWorld(plane, p)));
    const outside = corners.some((c) => c.x < 0 || c.y < 0 || c.x > width || c.y > height);
    if (!outside) return;
    scene.lookAtPlane(plane, {
      center: planeToWorld(plane, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }),
      radius: Math.max(70, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.78),
    });
  }, [doc]);

  useEffect(() => {
    controllerRef.current?.toolChanged();
  }, [app.tool]);

  // The hint of Offset changes between picking a curve and adjusting the preview, and the hint
  // of a transform command with the input being picked.
  useEffect(() => {
    controllerRef.current?.refreshHint();
  }, [app.sketchOffset === null, app.sketchTransform?.picking, app.sketchTransform === null]);
  useEffect(() => {
    controllerRef.current?.requestDraw();
  }, [app.sketchTransform]);

  useEffect(() => {
    sceneRef.current?.setProjection(app.projection);
  }, [app.projection, ready]);

  // Entering and leaving the sketch environment.
  const previousProjection = useRef(app.projection);
  const previousView = useRef<ReturnType<ViewportScene["saveView"]> | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    const controller = controllerRef.current;
    if (!scene || !controller) return;
    const id = app.activeSketchId;
    scene.setLeftButtonOrbit(id === null);
    scene.setBodiesTransparent(id !== null);
    scene.suppressOriginPlanes(id !== null);
    controller.cancel();
    if (id) {
      const f = documentStore.document.features[id];
      if (f?.type === "sketch") {
        previousProjection.current = appState.get().projection;
        previousView.current = scene.saveView();
        appState.set({ projection: "orthographic" });
        scene.setProjection("orthographic");
        const plane = resolveSketchPlane(f.sketch.plane);
        const b = sketchBounds(f.sketch);
        const fit = b
          ? {
              center: planeToWorld(plane, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }),
              radius: Math.max(70, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.78),
            }
          : { center: plane.origin, radius: 90 };
        scene.lookAtPlane(plane, fit);
      }
      controller.refreshHint();
    } else {
      appState.set({ projection: previousProjection.current });
      scene.setProjection(previousProjection.current);
      if (previousView.current) {
        // Back to the view from before the sketch, framed on what exists now.
        const saved = previousView.current;
        previousView.current = null;
        scene.restoreView(saved);
        setTimeout(() => {
          if (scene.hasBodies()) scene.ensureVisible();
          else scene.fitAll(sketchExtents());
        }, 320);
      }
    }
    controller.requestDraw();
  }, [app.activeSketchId, ready]);

  function sketchExtents(): Vec3[] {
    const out: Vec3[] = [];
    const doc = documentStore.document;
    const active = validComponentId(doc, appState.get().activeComponentId);
    for (const f of Object.values(doc.features)) {
      if (f.type !== "sketch" || !f.visible || f.componentId !== active) continue;
      const b = sketchBounds(f.sketch);
      if (!b) continue;
      const plane = resolveSketchPlane(f.sketch.plane);
      out.push(planeToWorld(plane, { x: b.minX, y: b.minY }), planeToWorld(plane, { x: b.maxX, y: b.maxY }));
    }
    return out;
  }

  // After the page is opened, nothing is shown until the project is found and its history has
  // been computed: say so. Later recomputes keep the old bodies on screen, so a small badge is
  // enough, and only when they take long enough to notice.
  const building =
    model.kernel === "ready" &&
    (model.restoring || (model.busy && doc.timeline.length > 0 && Object.keys(model.bodies).length === 0));
  const computing = useDelayed(model.kernel === "ready" && model.busy && !building, 400);

  const activeSketch = app.activeSketchId ? doc.features[app.activeSketchId] : undefined;
  const view = activeSketch?.type === "sketch" ? sketchView(activeSketch.sketch, doc) : null;
  const tooling = app.activeSketchId !== null && app.tool !== "select";

  return (
    <div className={`viewport${tooling ? " tooling" : ""}`} ref={hostRef}>
      <canvas className="webgl" ref={webglRef} />
      <canvas className="overlay" ref={overlayRef} />

      {activeSketch?.type === "sketch" && view && (
        <div className="sketch-banner">
          <Icon name="sketch" size={14} />
          <strong>{activeSketch.name}</strong>
          <span
            className={`badge ${
              view.status === "fully-constrained"
                ? "ok"
                : view.status === "over-constrained"
                  ? "danger"
                  : "info"
            }`}
          >
            {view.status === "fully-constrained"
              ? "Fully constrained"
              : view.status === "over-constrained"
                ? "Over-constrained"
                : `Under-constrained · ${view.degreesOfFreedom} DOF`}
          </span>
          <button className="btn small accent" onClick={finishSketch}>
            Finish Sketch
          </button>
        </div>
      )}

      {app.dialog?.type === "pick-sketch-plane" && (
        <div className="sketch-banner">
          <Icon name="plane" size={14} />
          <span>Select a plane or a planar face</span>
          <button className="btn small" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      )}

      {app.dimensionEdit && <DimensionEditor />}
      <PointEntry />

      <div className="view-tools">
        <div className="view-card">
          <div className="view-grid">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => sceneRef.current?.setView(v.id)} title={`${v.label} view`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="view-row" style={{ marginTop: 1 }}>
            <button style={{ flex: 1 }} onClick={() => sceneRef.current?.setView("iso")} title="Isometric view">
              Iso
            </button>
            <button
              style={{ flex: 1 }}
              onClick={() => sceneRef.current?.fitAll(sketchExtents())}
              title="Fit all (F6)"
            >
              Fit
            </button>
          </div>
        </div>
        <div className="view-card">
          <div className="view-row">
            <button
              className={app.projection === "perspective" ? "on" : ""}
              onClick={() => appState.set({ projection: "perspective" })}
              title="Perspective projection"
            >
              Persp
            </button>
            <button
              className={app.projection === "orthographic" ? "on" : ""}
              onClick={() => appState.set({ projection: "orthographic" })}
              title="Orthographic projection"
            >
              Ortho
            </button>
          </div>
        </div>
      </div>

      {building && (
        <div className="overlay-note" role="status" aria-live="polite">
          <div className="overlay-card">
            <div className="spinner" />
            <h3>{model.restoring ? "Opening the project" : "Building the model"}</h3>
            <p>The bodies appear as soon as the history has been computed.</p>
          </div>
        </div>
      )}
      {computing && (
        <div className="computing-badge" role="status" aria-live="polite">
          <span className="spinner small" />
          Computing…
        </div>
      )}

      {model.kernel !== "ready" && (
        <div className="overlay-note">
          <div className="overlay-card">
            {model.kernel === "loading" ? (
              <>
                <div className="spinner" />
                <h3>Loading the geometry kernel</h3>
                <p>OpenCASCADE is starting. You can already sketch.</p>
              </>
            ) : (
              <>
                <h3>The geometry kernel failed to start</h3>
                <p>{model.kernelError || "WebAssembly could not be loaded."}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** `value`, but true only once it has stayed true for `ms` (no flicker for short work). */
function useDelayed(value: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!value) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value && shown;
}

/** Inline expression editor shown on top of a dimension label. */
function DimensionEditor(): ReactElement | null {
  const edit = useStore(appState, (s) => s.dimensionEdit);
  const [value, setValue] = useState(edit?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    setValue(edit?.value ?? "");
    const t = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [edit?.dimensionId, edit?.value]);

  if (!edit) return null;
  const editedType = (() => {
    const f = documentStore.document.features[edit.sketchId];
    return f?.type === "sketch" ? f.sketch.dimensions[edit.dimensionId]?.type : undefined;
  })();
  const unit = editedType === "angle" ? "deg" : "mm";
  const keypad = useNumericKeypad(edit.value);

  const close = (): void => {
    done.current = true;
    appState.set({ dimensionEdit: null });
  };

  const apply = (): void => {
    if (done.current) return;
    const expression = value.trim();
    if (expression === "" || expression === edit.value) {
      close();
      return;
    }
    const ok = editSketchSolved(
      edit.sketchId,
      "Edit dimension",
      (sketch) => {
        const d = sketch.dimensions[edit.dimensionId];
        if (!d) return sketch;
        return { ...sketch, dimensions: { ...sketch.dimensions, [d.id]: { ...d, expression } } };
      },
      { rejectOverConstrained: true },
    );
    if (ok) close();
    else inputRef.current?.select();
  };

  const cancel = (): void => {
    if (edit.fresh) {
      // A dimension that was never confirmed is taken back, leaving no trace in the history.
      const d = documentStore.document.features[edit.sketchId];
      if (d?.type === "sketch" && d.sketch.dimensions[edit.dimensionId]) {
        if (documentStore.undoLabel === "Dimension") documentStore.undo();
        else {
          editSketchSolved(edit.sketchId, "Remove dimension", (sketch) =>
            editSketch(sketch, (b) => b.removeDimension(edit.dimensionId)),
          );
        }
      }
    }
    close();
  };

  return (
    <div className="inline-editor" style={{ left: edit.x, top: edit.y }}>
      <input
        ref={inputRef}
        value={value}
        aria-label="Dimension value or expression"
        inputMode={keypad.inputMode}
        enterKeyHint="done"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") apply();
          else if (e.key === "Escape") cancel();
        }}
        onBlur={apply}
      />
      <span className="unit">{unit}</span>
      {keypad.touch && (
        <button
          type="button"
          className="keys-toggle"
          aria-label={keypad.text ? "Switch to number keys" : "Switch to letter keys"}
          onPointerDown={(e) => e.preventDefault()}
          onClick={keypad.toggle}
        >
          {keypad.text ? "123" : "abc"}
        </button>
      )}
    </div>
  );
}
