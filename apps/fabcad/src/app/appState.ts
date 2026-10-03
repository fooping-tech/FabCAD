import type { DxfDrawing } from "@fabcad/dxf";
import type {
  BodyOperation,
  EdgeRef,
  ExtrudeDirection,
  FaceRef,
  HoleExtent,
  HoleType,
  LoftSection,
  MirrorPlane,
  PatternAxis,
  PatternDirection,
  PlaneReference,
  Point3Ref,
  RevolveAxis,
  SplitFeature,
  SplitTool,
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
  | { kind: "text"; sketchId: string; textId: string }
  | { kind: "constraint"; sketchId: string; id: string }
  | { kind: "dimension"; sketchId: string; id: string }
  | { kind: "profile"; sketchId: string; regionId: string; ref: ProfileRef }
  | { kind: "feature"; featureId: string }
  | { kind: "origin-plane"; plane: OriginPlaneName }
  /** A construction plane, by the feature that defines it. */
  | { kind: "plane"; featureId: string };

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
    case "text":
      return `text:${s.sketchId}:${s.textId}`;
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
    case "plane":
      return `plane:${s.featureId}`;
  }
};

/** What a pattern or a mirror repeats, as the dialog holds it: both lists survive a switch. */
export interface SourcePick {
  sourceKind: "features" | "bodies";
  featureIds: string[];
  bodyIds: string[];
}

/** Operation and target bodies, shared by the features that build a solid from a sketch. */
export interface OperationPick {
  operation: BodyOperation;
  targetBodyIds: string[];
}

export type HoleDialog = {
  type: "hole";
  editing: string | null;
  bodyId: string | null;
  /** The body follows the sketch until the user picks one. */
  bodyAuto: boolean;
  sketchId: string | null;
  points: string[];
  holeType: HoleType;
  diameter: string;
  extent: HoleExtent;
  depth: string;
  counterboreDiameter: string;
  counterboreDepth: string;
  countersinkDiameter: string;
  countersinkAngle: string;
  flip: boolean;
  picking: "points" | "body";
};

export type RectangularPatternDialog = SourcePick & {
  type: "rectangular-pattern";
  editing: string | null;
  direction: PatternDirection | null;
  count: string;
  distance: string;
  flip: boolean;
  /** Whether the pattern has a second direction. */
  second: boolean;
  direction2: PatternDirection | null;
  count2: string;
  distance2: string;
  flip2: boolean;
  picking: "source" | "direction" | "direction2";
};

export type CircularPatternDialog = SourcePick & {
  type: "circular-pattern";
  editing: string | null;
  axis: PatternAxis | null;
  count: string;
  angle: string;
  flip: boolean;
  picking: "source" | "axis";
};

export type MirrorDialog = SourcePick & {
  type: "mirror";
  editing: string | null;
  plane: MirrorPlane | null;
  picking: "source" | "plane";
};

export type MoveDialog = {
  type: "move";
  editing: string | null;
  bodyIds: string[];
  copy: boolean;
  mode: "translate" | "rotate" | "point-to-point";
  x: string;
  y: string;
  z: string;
  axis: PatternAxis | null;
  angle: string;
  from: Point3Ref | null;
  to: Point3Ref | null;
  picking: "bodies" | "axis" | "from" | "to";
};

export type AlignDialog = {
  type: "align";
  editing: string | null;
  mode: "face-to-face" | "point-to-point";
  /** Body that moves: the one `from` lies on. */
  bodyId: string | null;
  fromFace: FaceRef | null;
  toFace: { bodyId: string; ref: FaceRef } | null;
  fromPoint: Point3Ref | null;
  toPoint: Point3Ref | null;
  flip: boolean;
  picking: "from" | "to";
};

export type SplitDialog = {
  type: "split";
  editing: string | null;
  bodyId: string | null;
  tool: SplitTool | null;
  keep: SplitFeature["keep"];
  picking: "body" | "tool";
};

export type SweepDialog = OperationPick & {
  type: "sweep";
  editing: string | null;
  sketchId: string | null;
  profiles: ProfileRef[];
  pathSketchId: string | null;
  path: string[];
  picking: "profile" | "path";
};

export type LoftDialog = OperationPick & {
  type: "loft";
  editing: string | null;
  sections: LoftSection[];
  ruled: boolean;
};

export type OffsetPlaneDialog = {
  type: "offset-plane";
  editing: string | null;
  base: PlaneReference | null;
  /** Length expression; negative values go against the normal of the base. */
  offset: string;
  picking: "base";
};

/** The dialogs of the solid features that pick through `dialogWants` / `applyPick`. */
export type SolidDialog =
  | HoleDialog
  | RectangularPatternDialog
  | CircularPatternDialog
  | MirrorDialog
  | MoveDialog
  | AlignDialog
  | SplitDialog
  | SweepDialog
  | LoftDialog
  | OffsetPlaneDialog;

/** Feature dialogs. `editing` is the id of an existing feature being edited. */
export type Dialog =
  | SolidDialog
  | { type: "pick-sketch-plane" }
  | {
      type: "extrude";
      editing: string | null;
      sketchId: string | null;
      profiles: ProfileRef[];
      /**
       * Sketch that was created for this command from a face of a body. It is taken back when
       * the command is cancelled.
       */
      autoSketch?: string | null;
      distance: string;
      direction: ExtrudeDirection;
      /** Set once the user picked a direction: the operation no longer changes it. */
      directionChosen?: boolean;
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
  /**
   * Sketch text being written. The text itself lives in the document, inside a transaction:
   * what the dialog shows is the real thing, and the whole edit is one undo step.
   */
  | { type: "text"; sketchId: string; textId: string; fresh: boolean; picking: "path" | null }
  | { type: "parameters" }
  /** A parsed DXF file waiting for the unit and layer choice. */
  | { type: "import-dxf"; fileName: string; drawing: DxfDrawing }
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

/** A help id (see `help/content.ts`) with what is known about the tool when it has no entry. */
export interface HelpTopic {
  id: string;
  title: string;
  summary?: string;
}

/** The help menu of a tool: the topic and where the menu goes, in client coordinates. */
export interface HelpRequest extends HelpTopic {
  x: number;
  y: number;
  /** Opened by a long press: the finger is still on the screen. */
  held?: boolean;
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
  /** Line picked and dragged sketch positions up with other points, horizontally and vertically. */
  alignSnap: boolean;
}

import type { ShapeDimension } from "../sketch/shapeDimensions";
import type { SketchTransform } from "../sketch/transformDialog";

export type FabricationProcess = "laser" | "print";

/** Sketch Offset waiting for OK: the chain, and the distance and side previewed. */
export interface SketchOffset {
  sketchId: string;
  chain: string[];
  /** mm, positive. */
  distance: number;
  /** Sign given to `offsetEntities` (+1: to the right of the chain, outward for loops). */
  side: 1 | -1;
}

export interface AppState {
  workspace: Workspace;
  /** Manufacturing process shown in the FABRICATION workspace. */
  fabricationProcess: FabricationProcess;
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
  /**
   * The options window of the running sketch command, opened beside the click that started
   * the operation (client coordinates). Null while the command has no window.
   */
  toolPanel: { x: number; y: number } | null;
  /** Sketch Offset previewed and waiting for OK. */
  sketchOffset: SketchOffset | null;
  /** The box where a point of the running Create tool is typed (`sketch/pointEntry.ts`). */
  pointEntry: { text: string; error?: string } | null;
  /** The command palette (Ctrl / Cmd + K) while it is open, with what has been typed. */
  commandPalette: { query: string } | null;
  /**
   * The window with the dimensions of the shape just drawn (`sketch/shapeDimensions.ts`).
   * `typed` is set when a key typed in the view starts editing its first value.
   */
  shapeDimensions: {
    sketchId: string;
    title: string;
    anchor: { x: number; y: number };
    fields: ShapeDimension[];
    typed?: { text: string; at: number };
  } | null;
  /** Move, Copy, Scale, Mirror or a pattern of the sketch, with its window (`transformDialog.ts`). */
  sketchTransform: SketchTransform | null;
  /** The window with the history log (steps, bodies) is open. */
  historyLogOpen: boolean;
  /** Sketch cursor position in sketch coordinates, for the status bar. */
  cursor: Vec2 | null;
  toasts: Toast[];
  /** Short hint for the active command shown in the status bar. */
  hint: string;
  showConstraints: boolean;
  showDimensions: boolean;
  /**
   * Multi-selection mode: every click adds to the selection or takes away from it, as if
   * Shift were held. It is how several things are selected without a keyboard.
   */
  multiSelect: boolean;
  /**
   * In-app help: the small menu at a tool icon, and the topic shown in the overlay. Both are
   * state of the session only; opening help changes nothing of the command that is running.
   */
  help: { menu: HelpRequest | null; topic: HelpTopic | null };
  /** Open context menu, in client coordinates. */
  contextMenu: { x: number; y: number; held?: boolean } | null;
  /** The command that "Repeat" in the context menu starts again. */
  lastCommand: { kind: "tool" | "dialog" | "measure"; id: string; label: string } | null;
  /** Sketch tool to start as soon as a sketch plane has been picked. */
  pendingSketchTool: string | null;
  /** Small screens: whether the side panel sheet is open. */
  sidePanelOpen: boolean;
  /**
   * Measure command: clicks pick what is measured (at most two things). Inspection state of
   * the session; nothing of it is stored in the document.
   */
  measuring: boolean;
}

export const appState = new TinyStore<AppState>({
  workspace: "design",
  fabricationProcess: "laser",
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
    alignSnap: true,
  },
  selection: [],
  hover: null,
  selectionFilter: "auto",
  projection: "perspective",
  dialog: null,
  dimensionEdit: null,
  toolPanel: null,
  sketchOffset: null,
  pointEntry: null,
  commandPalette: null,
  historyLogOpen: false,
  shapeDimensions: null,
  sketchTransform: null,
  cursor: null,
  toasts: [],
  hint: "",
  showConstraints: true,
  showDimensions: true,
  multiSelect: false,
  help: { menu: null, topic: null },
  contextMenu: null,
  lastCommand: null,
  pendingSketchTool: null,
  sidePanelOpen: false,
  measuring: false,
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

/**
 * Whether a click adds to the selection instead of replacing it: a modifier key is held, or
 * the multi-selection mode is on. Every place that selects by click asks here, so that the
 * viewport, the browser and the timeline behave alike.
 */
let viewportPoint: { x: number; y: number } | null = null;

/** Remember where the pointer last went down in the 3D view (client coordinates). */
export function noteViewportPoint(x: number, y: number): void {
  viewportPoint = { x, y };
}

/** Where the pointer last went down in the 3D view: command windows open beside it. */
export function lastViewportPoint(): { x: number; y: number } | null {
  return viewportPoint;
}

export function isAdditiveClick(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey || appState.get().multiSelect;
}

/** Click selection: replace, or toggle when `additive` (see `isAdditiveClick`). */
export function select(item: Selection | null, additive: boolean): void {
  const { selection, measuring } = appState.get();
  if (measuring) {
    if (!item || item.kind === "constraint" || item.kind === "dimension" || item.kind === "feature") return;
    const picked = selectionKey(item);
    // A third pick starts the next measurement.
    if (selection.some((s) => selectionKey(s) === picked)) {
      appState.set({ selection: selection.filter((s) => selectionKey(s) !== picked) });
    } else {
      appState.set({ selection: selection.length >= 2 ? [item] : [...selection, item] });
    }
    return;
  }
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
