import type {
  BodyOperation,
  EdgeRef,
  ExtrudeDirection,
  FaceRef,
  RevolveAxis,
} from "@fabcad/cad-document";
import type { OriginPlaneName, Vec2, Vec3 } from "@fabcad/geometry";
import type { ProfileRef } from "@fabcad/sketch";
import { TinyStore } from "./tinyStore";

export type Workspace = "design" | "fabrication";
export type FabricationTab = "model" | "parts" | "sheet";
export type SelectionFilter = "auto" | "body" | "face" | "edge" | "vertex";
export type Projection = "perspective" | "orthographic";

export type Selection =
  | { kind: "body"; bodyId: string }
  | { kind: "face"; bodyId: string; faceIndex: number; point: Vec3; normal: Vec3; planar: boolean }
  | { kind: "edge"; bodyId: string; edgeIndex: number; point: Vec3 }
  | { kind: "vertex"; bodyId: string; vertexIndex: number; point: Vec3 }
  | { kind: "entity"; sketchId: string; entityId: string }
  | { kind: "constraint"; sketchId: string; id: string }
  | { kind: "dimension"; sketchId: string; id: string }
  | { kind: "profile"; sketchId: string; regionId: string; ref: ProfileRef }
  | { kind: "feature"; featureId: string }
  | { kind: "origin-plane"; plane: OriginPlaneName };

export const selectionKey = (s: Selection): string => {
  switch (s.kind) {
    case "body":
      return `body:${s.bodyId}`;
    case "face":
      return `face:${s.bodyId}:${s.faceIndex}`;
    case "edge":
      return `edge:${s.bodyId}:${s.edgeIndex}`;
    case "vertex":
      return `vertex:${s.bodyId}:${s.vertexIndex}`;
    case "entity":
      return `entity:${s.sketchId}:${s.entityId}`;
    case "constraint":
      return `constraint:${s.sketchId}:${s.id}`;
    case "dimension":
      return `dimension:${s.sketchId}:${s.id}`;
    case "profile":
      return `profile:${s.sketchId}:${s.regionId}`;
    case "feature":
      return `feature:${s.featureId}`;
    case "origin-plane":
      return `origin-plane:${s.plane}`;
  }
};

/** Feature dialogs. `editing` is the id of an existing feature being edited. */
export type Dialog =
  | { type: "pick-sketch-plane" }
  | {
      type: "extrude";
      editing: string | null;
      sketchId: string | null;
      profiles: ProfileRef[];
      distance: string;
      direction: ExtrudeDirection;
      operation: BodyOperation;
      targetBodyIds: string[];
    }
  | {
      type: "revolve";
      editing: string | null;
      sketchId: string | null;
      profiles: ProfileRef[];
      axis: RevolveAxis | null;
      angle: string;
      operation: BodyOperation;
      targetBodyIds: string[];
      /** Which input the next viewport click fills. */
      picking: "profile" | "axis";
    }
  | {
      type: "fillet" | "chamfer";
      editing: string | null;
      bodyId: string | null;
      edges: EdgeRef[];
      value: string;
    }
  | { type: "shell"; editing: string | null; bodyId: string | null; faces: FaceRef[]; value: string }
  | {
      type: "combine";
      editing: string | null;
      operation: "union" | "cut" | "intersect";
      targetBodyId: string | null;
      toolBodyIds: string[];
      keepTools: boolean;
      picking: "target" | "tools";
    }
  | { type: "parameters" }
  | { type: "about" };

export interface DimensionEdit {
  sketchId: string;
  dimensionId: string;
  /** Screen position of the inline editor, relative to the viewport. */
  x: number;
  y: number;
  value: string;
  /** True when the dimension was just created: cancelling removes it again. */
  fresh: boolean;
}

export interface Toast {
  id: number;
  kind: "info" | "warning" | "error";
  text: string;
}

export interface ToolOptions {
  polygonSides: number;
  construction: boolean;
  filletRadius: number;
  chamferDistance: number;
  offsetDistance: number;
  patternCount: number;
  patternCountY: number;
  patternSpacing: number;
  scaleFactor: number;
  mirrorSymmetry: boolean;
  /** Snap picked and dragged sketch positions to whole millimetres. */
  gridSnap: boolean;
}

export interface AppState {
  workspace: Workspace;
  fabricationTab: FabricationTab;
  /** Sketch feature being edited, or null in the solid environment. */
  activeSketchId: string | null;
  /** Active command. "select" is the idle state. */
  tool: string;
  toolOptions: ToolOptions;
  selection: Selection[];
  hover: Selection | null;
  selectionFilter: SelectionFilter;
  projection: Projection;
  dialog: Dialog | null;
  dimensionEdit: DimensionEdit | null;
  /** Sketch cursor position in sketch coordinates, for the status bar. */
  cursor: Vec2 | null;
  toasts: Toast[];
  /** Short hint for the active command shown in the status bar. */
  hint: string;
  showConstraints: boolean;
  showDimensions: boolean;
  /** Sketch tool to start as soon as a sketch plane has been picked. */
  pendingSketchTool: string | null;
  /** Small screens: whether the side panel sheet is open. */
  sidePanelOpen: boolean;
}

export const appState = new TinyStore<AppState>({
  workspace: "design",
  fabricationTab: "model",
  activeSketchId: null,
  tool: "select",
  toolOptions: {
    polygonSides: 6,
    construction: false,
    filletRadius: 5,
    chamferDistance: 5,
    offsetDistance: 5,
    patternCount: 3,
    patternCountY: 1,
    patternSpacing: 20,
    scaleFactor: 2,
    mirrorSymmetry: true,
    gridSnap: true,
  },
  selection: [],
  hover: null,
  selectionFilter: "auto",
  projection: "perspective",
  dialog: null,
  dimensionEdit: null,
  cursor: null,
  toasts: [],
  hint: "",
  showConstraints: true,
  showDimensions: true,
  pendingSketchTool: null,
  sidePanelOpen: false,
});

let toastId = 1;

export function toast(text: string, kind: Toast["kind"] = "info", ms = 4000): void {
  const id = toastId++;
  appState.set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => {
    appState.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, ms);
}

export function setSelection(selection: Selection[]): void {
  appState.set({ selection });
}

/** Click selection: replace, or toggle when `additive` (Shift / Ctrl / Cmd held). */
export function select(item: Selection | null, additive: boolean): void {
  const { selection } = appState.get();
  if (!item) {
    if (!additive && selection.length > 0) appState.set({ selection: [] });
    return;
  }
  const key = selectionKey(item);
  const exists = selection.some((s) => selectionKey(s) === key);
  if (additive) {
    appState.set({
      selection: exists ? selection.filter((s) => selectionKey(s) !== key) : [...selection, item],
    });
  } else {
    appState.set({ selection: [item] });
  }
}

export const isSelected = (selection: Selection[], item: Selection): boolean => {
  const key = selectionKey(item);
  return selection.some((s) => selectionKey(s) === key);
};
