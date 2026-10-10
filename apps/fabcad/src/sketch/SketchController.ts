import {
  applySketchEdit,
  type CadDocument,
  type SketchFeature,
  validComponentId,
} from "@fabcad/cad-document";
import { resolveSketchPlane } from "@fabcad/features";
import {
  type Vec2,
  add2,
  cross2,
  curvePointAt,
  dist2,
  formatMeasure,
  flattenCurve,
  planeToWorld,
  pointInPolygon,
  sub2,
} from "@fabcad/geometry";
import {
  type EntityId,
  type Sketch,
  type SketchEntity,
  type SketchRegion,
  type SnapResult,
  type WindowItem,
  breakCurve,
  editSketch,
  expandNodeDrag,
  releaseSharpOnHandleDrag,
  entityPointIds,
  entityToCurves,
  extendCurve,
  getPoint,
  insertNodeOnCurve,
  hitTestSketch,
  hitTestText,
  isCurve,
  resolveProfileRefs,
  measureDimension,
  offsetEntities,
  profileRefOf,
  projectedEntityIds,
  sketchChamfer,
  sketchTexts,
  textBox,
  sketchFillet,
  alignPoint,
  alignmentReferences,
  snapPoint,
  trimCurve,
  windowBounds,
  windowMode,
  windowSelect,
} from "@fabcad/sketch";
import {
  type Selection,
  appState,
  isAdditiveClick,
  isSelected,
  lastViewportPoint,
  select,
  selectionKey,
  setSelection,
  toast,
} from "../app/appState";
import {
  documentStore,
  editSketchSolved,
  sketchView,
  solveDrag,
} from "../app/session";
import {
  dialogReferences,
  dialogSketches,
  dialogWants,
  freePoints,
  isSolidDialog,
} from "../app/solidDialogs";
import { currentMeasurement } from "../measure/MeasurePanel";
import { beginText, editText, pickTextPath } from "../text/textCommands";
import { textState } from "../text/typography";
import type { ViewportScene } from "../viewport/scene";
import { SKETCH_COLORS } from "../viewport/theme";
import { CONSTRAINT_TOOLS, constraintRefs, formatDimensionValue, planDimension } from "./constraintTools";
import { offsetSideAt, offsetSketch, offsetThrough, onOffsetPreview } from "./offsetGeometry";
import { cancelOffset, commitOffset, patchOffset } from "./offsetTool";
import { editableNodes } from "./nodeEdit";
import { setTool } from "../app/actions";
import { TOOLS_WITH_WINDOW } from "./toolWindows";
import { shapeAnchor, shapeDimensions } from "./shapeDimensions";
import {
  type SketchTransform,
  type TransformTool,
  TRANSFORM_TITLES,
  TRANSFORM_TOOLS,
  pickInto,
  startTransform,
  transformResult,
} from "./transformDialog";
import { commitTransform, transformEvaluate } from "./transformTool";
import { dragStep } from "../viewport/extrudeManipulator";
import {
  type BuiltShape,
  type ToolPick,
  buildFromPicks,
  createTool,
  inferAxis,
  lastPointOf,
} from "./createTools";
import {
  type LabelHit,
  Projector,
  type SketchDrawState,
  connectedChain,
  drawConstraints,
  drawDimensions,
  drawGrid,
  drawSketchGeometry,
  drawAlignmentGuides,
  drawSnapMarker,
  fillRegion,
  labelPositionOf,
} from "./render";

/**
 * Sketch environment controller: draws all sketches on the overlay canvas and turns pointer
 * input into sketch commands. Command state (picks, drags, previews) lives here and is reset
 * explicitly through `cancel()`, so there is always exactly one active command.
 */

/** Grid that free positions snap to, in mm. */
const GRID = 1;
const toGrid = (v: number): number => {
  const r = Math.round(v / GRID) * GRID;
  return Object.is(r, -0) ? 0 : r;
};
const snapToGrid = (p: Vec2): Vec2 => ({ x: toGrid(p.x), y: toGrid(p.y) });

/** Reach of the horizontal / vertical inference, in pixels. */
const ALIGN_PX = 6;
/**
 * A finger reaches further than a mouse, but less so for lining up than for picking: every
 * point of the sketch pulls along two lines, and a wide band around each would make the
 * cursor stick.
 */
const ALIGN_REACH_MAX = 1.5;

const HIT_PX = 7;
const SNAP_PX = 9;
const DRAG_START_PX = 4;

/** Move, Copy, Scale, Mirror and the patterns: commands with a window (`transformDialog.ts`). */
const SELECTION_TOOLS = TRANSFORM_TOOLS;

interface PointerInfo {
  x: number;
  y: number;
  shift: boolean;
  meta: boolean;
}

type Drag =
  | {
      kind: "entities";
      startScreen: Vec2;
      startSketch: Vec2;
      /** Points moved by the drag with their start positions. */
      points: { id: EntityId; start: Vec2 }[];
      /** Circle whose radius is being dragged. */
      circle: EntityId | null;
      base: Sketch;
      started: boolean;
      hit: Selection | null;
    }
  | {
      kind: "label";
      startScreen: Vec2;
      dimensionId: string;
      started: boolean;
    }
  | {
      /** Rectangle dragged over empty space: left → right window, right → left crossing. */
      kind: "window";
      startScreen: Vec2;
      current: Vec2;
      started: boolean;
      additive: boolean;
      /** What a click without movement selects. */
      click: Selection | null;
    };

export interface HoverProfile {
  sketchId: string;
  region: SketchRegion;
}

export class SketchController {
  private ctx: CanvasRenderingContext2D;
  private picks: ToolPick[] = [];
  private entityPicks: EntityId[] = [];
  private cursor: ToolPick | null = null;
  /** What the point being dragged is lined up with, for the guides. */
  private dragAlignment: { at: Vec2; aligned: NonNullable<ToolPick["aligned"]> } | null = null;
  private preview: BuiltShape | null = null;
  private previewSketch: Sketch | null = null;
  private drag: Drag | null = null;
  /** The previewed Offset curve is being dragged. */
  private offsetDrag = false;
  private labelHits: LabelHit[] = [];
  private hoverProfile: HoverProfile | null = null;
  private raf = 0;
  /** Tolerance multiplier: fingers are less precise than a mouse. */
  private reach = 1;
  /** Drawn on top of everything, after the sketches (e.g. the extrude manipulator). */
  overlayPainter: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private scene: ViewportScene,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
  }

  /** Touch input gets larger pick and snap tolerances. */
  setCoarse(coarse: boolean): void {
    this.reach = coarse ? 2.4 : 1;
  }

  // ------------------------------------------------------------------ helpers

  private get doc(): CadDocument {
    return documentStore.document;
  }

  private activeFeature(): SketchFeature | null {
    const id = appState.get().activeSketchId;
    const f = id ? this.doc.features[id] : undefined;
    return f && f.type === "sketch" ? f : null;
  }

  private projectorFor(sketch: Sketch): Projector {
    return new Projector(this.scene, resolveSketchPlane(sketch.plane));
  }

  private pickAt(sketch: Sketch, p: PointerInfo, exclude: EntityId[] = []): ToolPick | null {
    const projector = this.projectorFor(sketch);
    const raw = projector.toSketch(p.x, p.y);
    if (!raw) return null;
    const px = projector.pixel(raw);
    const snap: SnapResult = p.meta
      ? { point: raw, kind: "none" }
      : snapPoint(sketch, raw, px * SNAP_PX * this.reach, exclude);
    if (snap.kind !== "none") return { position: snap.point, snap };
    // Nothing to snap to: line up with other points, and land on whole millimetres along the
    // axes that are left (Ctrl / Cmd switches all snapping off).
    const free = this.freePosition(sketch, raw, p, px, exclude);
    const pick: ToolPick = { position: free.position, snap: { point: free.position, kind: "none" } };
    if (free.aligned) pick.aligned = free.aligned;
    return pick;
  }

  private gridSnap(p: PointerInfo): boolean {
    return !p.meta && appState.get().toolOptions.gridSnap;
  }

  private alignSnap(p: PointerInfo): boolean {
    return !p.meta && appState.get().toolOptions.alignSnap;
  }

  /**
   * Where a position that snapped to nothing goes. Horizontal / vertical inference comes
   * first: above, below or beside a point of the sketch or a pick of the running command the
   * position takes the coordinate of that point. The other coordinate, or both, fall on the
   * grid. `px` is the size of a pixel in the sketch, so the reach is the same at every zoom.
   */
  private freePosition(
    sketch: Sketch,
    raw: Vec2,
    p: PointerInfo,
    px: number,
    exclude: EntityId[] = [],
  ): { position: Vec2; aligned?: NonNullable<ToolPick["aligned"]> } {
    const grid = this.gridSnap(p);
    const onGrid = grid ? snapToGrid(raw) : raw;
    if (!this.alignSnap(p)) return { position: onGrid };
    const references = [
      ...alignmentReferences(sketch, exclude),
      ...this.picks.map((pick) => pick.position),
    ];
    const tolerance = px * ALIGN_PX * Math.min(this.reach, ALIGN_REACH_MAX);
    const found = alignPoint(raw, references, tolerance);
    if (!found.vertical && !found.horizontal) return { position: onGrid };
    const aligned: NonNullable<ToolPick["aligned"]> = {};
    if (found.vertical) aligned.vertical = found.vertical;
    if (found.horizontal) aligned.horizontal = found.horizontal;
    return {
      position: {
        x: found.vertical ? found.point.x : onGrid.x,
        y: found.horizontal ? found.point.y : onGrid.y,
      },
      aligned,
    };
  }

  private hitEntity(sketch: Sketch, p: PointerInfo, options?: { points?: boolean; curves?: boolean }): SketchEntity | null {
    const projector = this.projectorFor(sketch);
    const raw = projector.toSketch(p.x, p.y);
    if (!raw) return null;
    const hit = hitTestSketch(sketch, raw, projector.pixel(raw) * HIT_PX * this.reach, options);
    return hit ? (sketch.entities[hit.id] ?? null) : null;
  }

  /** Pick the nearest *visible, editable* node, ignoring other sketch points. */
  private hitEditableNode(sketch: Sketch, p: PointerInfo): SketchEntity | null {
    const projector = this.projectorFor(sketch);
    const raw = projector.toSketch(p.x, p.y);
    if (!raw) return null;
    const threshold = projector.pixel(raw) * HIT_PX * this.reach;
    let closest: SketchEntity | null = null;
    let best = threshold;
    for (const id of editableNodes(sketch).keys()) {
      const node = sketch.entities[id];
      if (node?.type !== "point") continue;
      const d = dist2(node, raw);
      if (d <= best) { closest = node; best = d; }
    }
    return closest;
  }

  private hitText(sketch: Sketch, p: PointerInfo): string | null {
    if (!sketch.texts) return null;
    const projector = this.projectorFor(sketch);
    const raw = projector.toSketch(p.x, p.y);
    if (!raw) return null;
    return hitTestText(sketch, raw, projector.pixel(raw) * 4 * this.reach)?.id ?? null;
  }

  private hitLabel(p: PointerInfo): LabelHit | null {
    for (let i = this.labelHits.length - 1; i >= 0; i--) {
      const h = this.labelHits[i]!;
      const pad = (this.reach - 1) * 6;
      if (
        p.x >= h.x - pad &&
        p.x <= h.x + h.w + pad &&
        p.y >= h.y - pad &&
        p.y <= h.y + h.h + pad
      ) {
        return h;
      }
    }
    return null;
  }

  private setHint(text: string): void {
    appState.set({ hint: text });
  }

  /** Hint for the current tool and step. */
  refreshHint(): void {
    const { tool, activeSketchId } = appState.get();
    if (!activeSketchId) return;
    const create = createTool(tool);
    if (create) {
      const step = create.hints[Math.min(this.picks.length, create.hints.length - 1)] ?? "";
      this.setHint(`${step} · or type x, y (@dx, dy) for an exact point`);
      return;
    }
    const transform = appState.get().sketchTransform;
    if (transform) {
      const title = TRANSFORM_TITLES[transform.tool];
      const step: Record<string, string> = {
        objects: "click the curves and points to include (click again to leave one out), then the next field in the window",
        center: "click the point to turn or scale about",
        base: "click the point to move from",
        target: "click the point to move to",
        axis: "click the line to mirror across",
      };
      this.setHint(
        transform.picking
          ? `${title}: ${step[transform.picking]}`
          : `${title}: check the preview and the values, then OK (Enter)`,
      );
      return;
    }
    if (tool.startsWith("constraint:")) {
      const def = CONSTRAINT_TOOLS.find((c) => `constraint:${c.type}` === tool);
      this.setHint(def ? `${def.label}: ${def.hint}` : "");
      return;
    }
    const hints: Record<string, string> = {
      select: "Click to select, drag geometry to move it. Double-click a dimension to edit it.",
      "node-edit": "Node Edit: drag an anchor or handle; choose Add Node to tap on an outline segment.",
      "node-add": "Add Node: tap a line or Bézier curve to insert an anchor. Drag the new point in Node Edit.",
      dimension:
        this.entityPicks.length === 0
          ? "Dimension: pick a line, circle, arc or point"
          : "Pick a second entity, or click empty space to place the dimension",
      trim: "Trim: click the part of a curve to remove",
      extend: "Extend: click near the end of a curve to extend",
      break: "Break: click a curve where it should be split",
      fillet: this.entityPicks.length === 0 ? "Fillet: pick the first line" : "Fillet: pick the second line",
      chamfer: this.entityPicks.length === 0 ? "Chamfer: pick the first line" : "Chamfer: pick the second line",
      offset: appState.get().sketchOffset
        ? "Offset: drag the preview or type the distance, then OK (Enter). Click another curve to offset it too"
        : "Offset: click a curve on the side to offset to",
      text: "Text: click where the text starts",
      project: "Project: click edges, faces or vertices of a body to project them onto the sketch",
      mirror: "Mirror: select the geometry first, then click the mirror line",
      move: this.picks.length === 0 ? "Move: pick the base point" : "Move: pick the destination",
      copy: this.picks.length === 0 ? "Copy: pick the base point" : "Copy: pick the destination",
      scale: "Scale: pick the fixed point",
      "rectangular-pattern":
        this.picks.length === 0 ? "Pattern: pick the base point" : "Pattern: pick the direction and spacing",
      "circular-pattern": "Pattern: pick the center",
    };
    this.setHint(hints[tool] ?? "");
  }

  /** Cancel the running command. Returns true when there was something to cancel. */
  cancel(): boolean {
    this.offsetDrag = false;
    if (appState.get().sketchTransform) {
      // Esc in a transform command leaves it without changing anything.
      appState.set({ sketchTransform: null, tool: "select" });
      this.requestDraw();
      return true;
    }
    const had =
      cancelOffset() || this.picks.length > 0 || this.entityPicks.length > 0 || this.drag !== null;
    if (this.drag) {
      if (documentStore.inTransaction) documentStore.cancel();
      this.drag = null;
    }
    this.picks = [];
    this.entityPicks = [];
    this.preview = null;
    this.previewSketch = null;
    this.refreshHint();
    this.requestDraw();
    return had;
  }

  /**
   * What a right-click refers to: the dimension, constraint, entity or profile under the
   * pointer of the active sketch.
   */
  pickForMenu(p: PointerInfo): Selection | null {
    const feature = this.activeFeature();
    if (!feature) return null;
    const onPoint = this.hitEntity(feature.sketch, p, { curves: false });
    if (onPoint) return { kind: "entity", sketchId: feature.id, entityId: onPoint.id };
    const label = this.hitLabel(p);
    if (label) return { kind: label.kind, sketchId: feature.id, id: label.id };
    const e = this.hitEntity(feature.sketch, p);
    if (e) return { kind: "entity", sketchId: feature.id, entityId: e.id };
    const text = this.hitText(feature.sketch, p);
    if (text) return { kind: "text", sketchId: feature.id, textId: text };
    const at = this.projectorFor(feature.sketch).toSketch(p.x, p.y);
    const region = at ? this.regionAt(feature.sketch, at) : null;
    return region
      ? { kind: "profile", sketchId: feature.id, regionId: region.id, ref: profileRefOf(region) }
      : null;
  }

  editDimension(dimensionId: string): void {
    const feature = this.activeFeature();
    if (feature) this.openDimensionEditor(feature, dimensionId, false);
  }

  /** True when the pointer is on sketch geometry, a dimension or a constraint glyph. */
  hitsSomething(p: PointerInfo): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    if (appState.get().tool === "node-edit") {
      return this.hitEditableNode(feature.sketch, p) !== null;
    }
    return (
      this.hitLabel(p) !== null ||
      this.hitEntity(feature.sketch, p) !== null ||
      this.hitText(feature.sketch, p) !== null
    );
  }

  /** Forget the pointer position (a lifted finger leaves no cursor behind). */
  clearCursor(): void {
    this.cursor = null;
    this.preview = null;
    this.previewSketch = null;
    appState.set({ cursor: null, hover: null });
    this.requestDraw();
  }

  /** Screen polylines of the entities of a sketch, for window selection. */
  private windowItems(sketch: Sketch): WindowItem<EntityId>[] {
    const projector = this.projectorFor(sketch);
    const items: WindowItem<EntityId>[] = [];
    for (const e of Object.values(sketch.entities)) {
      // The origin is part of every sketch and cannot be edited: a window never picks it.
      if (e.id === sketch.originId) continue;
      if (e.type === "point") {
        items.push({ id: e.id, points: [projector.toScreen(e)] });
        continue;
      }
      const points: Vec2[] = [];
      for (const curve of entityToCurves(sketch, e)) {
        const flat = flattenCurve(curve, Math.max(projector.pixel(curvePointAt(curve, 0)) * 0.5, 1e-3));
        for (const q of flat) points.push(projector.toScreen(q));
      }
      if (points.length > 0) items.push({ id: e.id, points });
    }
    for (const text of sketchTexts(sketch)) {
      const box = textBox(sketch, text);
      if (box) items.push({ id: text.id, points: [...box, box[0]!].map((q) => projector.toScreen(q)) });
    }
    return items;
  }

  private selectWindow(feature: SketchFeature, from: Vec2, to: Vec2, additive: boolean): void {
    const ids = windowSelect(
      this.windowItems(feature.sketch),
      windowBounds(from, to),
      windowMode(from, to),
    );
    const picked: Selection[] = ids.map((entityId) =>
      feature.sketch.texts?.[entityId]
        ? { kind: "text", sketchId: feature.id, textId: entityId }
        : { kind: "entity", sketchId: feature.id, entityId },
    );
    if (!additive) {
      appState.set({ selection: picked });
      return;
    }
    const current = appState.get().selection;
    const keys = new Set(current.map(selectionKey));
    appState.set({ selection: [...current, ...picked.filter((s) => !keys.has(selectionKey(s)))] });
  }

  /** Abort a drag in progress without touching the picks of the running command. */
  cancelDrag(): void {
    if (!this.drag) return;
    if (documentStore.inTransaction) documentStore.cancel();
    this.drag = null;
    this.requestDraw();
  }

  /** Called when the tool changes. */
  toolChanged(): void {
    this.picks = [];
    this.entityPicks = [];
    this.preview = null;
    this.previewSketch = null;
    this.cursor = null;
    this.offsetDrag = false;
    appState.set({ sketchOffset: null, toolPanel: null, pointEntry: null, shapeDimensions: null });
    const { tool, activeSketchId, toolOptions } = appState.get();
    // Move, Copy, Scale, Mirror and the patterns open their window with the selection as the
    // objects; what is missing is picked from there.
    appState.set({
      sketchTransform:
        SELECTION_TOOLS.has(tool) && activeSketchId
          ? startTransform(tool as TransformTool, activeSketchId, this.selectedEntityIds(activeSketchId), toolOptions)
          : null,
    });
    this.refreshHint();
    this.requestDraw();
  }

  /**
   * Open the options window of the running command beside the click at `p` (canvas
   * coordinates), or beside the last click in the view.
   */
  private openToolPanel(p: PointerInfo | null): void {
    const r = this.canvas.getBoundingClientRect();
    const at = p ? { x: p.x + r.left, y: p.y + r.top } : (lastViewportPoint() ?? { x: r.left + 16, y: r.top + 16 });
    appState.set({ toolPanel: at });
  }

  private selectedEntityIds(sketchId: string): EntityId[] {
    return appState
      .get()
      .selection.flatMap((s) => (s.kind === "entity" && s.sketchId === sketchId ? [s.entityId] : []));
  }

  get hoveredProfile(): HoverProfile | null {
    return this.hoverProfile;
  }

  // --------------------------------------------------------------- pointer I/O

  /** Returns true when the event was consumed by the sketch environment. */
  pointerMove(p: PointerInfo): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    const sketch = feature.sketch;
    const { tool } = appState.get();

    if (this.drag) {
      this.continueDrag(feature, p);
      return true;
    }
    if (this.offsetDrag) {
      this.dragOffset(feature, p);
      return true;
    }

    const create = createTool(tool);
    if (create) {
      this.cursor = this.resolveCreatePick(sketch, create.inferAxis ?? false, p);
      this.updateCreatePreview(sketch);
      appState.set({ cursor: this.cursor?.position ?? null, hover: null });
      this.requestDraw();
      return true;
    }

    if (SELECTION_TOOLS.has(tool)) {
      // Points snap like a Create tool; objects and the mirror line are hovered like a selection.
      const picking = appState.get().sketchTransform?.picking;
      const pointPick = picking === "center" || picking === "base" || picking === "target";
      this.cursor = pointPick ? this.pickAt(sketch, p) : null;
      const e = !pointPick && picking ? this.hitEntity(sketch, p, picking === "axis" ? { points: false } : undefined) : null;
      const hover: Selection | null = e ? { kind: "entity", sketchId: feature.id, entityId: e.id } : null;
      appState.set({ cursor: this.projectorFor(sketch).toSketch(p.x, p.y), hover });
      this.requestDraw();
      return true;
    }

    const raw = this.projectorFor(sketch).toSketch(p.x, p.y);
    const label = tool === "select" ? this.hitLabel(p) : null;
    let hover: Selection | null = null;
    if (label) {
      hover =
        label.kind === "dimension"
          ? { kind: "dimension", sketchId: feature.id, id: label.id }
          : { kind: "constraint", sketchId: feature.id, id: label.id };
    } else {
      const curvesOnly = tool === "trim" || tool === "extend" || tool === "break" || tool === "offset" || tool === "node-add";
      const e = tool === "node-edit"
        ? this.hitEditableNode(sketch, p)
        : this.hitEntity(sketch, p, curvesOnly ? { points: false } : undefined);
      if (e) hover = { kind: "entity", sketchId: feature.id, entityId: e.id };
      else if (tool === "select") {
        const text = this.hitText(sketch, p);
        if (text) hover = { kind: "text", sketchId: feature.id, textId: text };
      }
    }
    const prev = appState.get().hover;
    if ((prev ? selectionKey(prev) : "") !== (hover ? selectionKey(hover) : "")) {
      appState.set({ hover });
    }
    appState.set({ cursor: raw });
    this.cursor = raw ? { position: raw, snap: { point: raw, kind: "none" } } : null;
    this.requestDraw();
    return true;
  }

  private resolveCreatePick(sketch: Sketch, infer: boolean, p: PointerInfo): ToolPick | null {
    const pick = this.pickAt(sketch, p);
    if (!pick) return null;
    const previous = this.picks[this.picks.length - 1];
    if (infer && previous && pick.snap.kind === "none" && !p.meta) {
      const px = this.projectorFor(sketch).pixel(pick.position);
      const inferred = inferAxis(previous.position, pick.position, px * 6 * this.reach);
      pick.position = inferred.position;
      if (inferred.inferred) pick.inferred = inferred.inferred;
      // The guides show what the position is lined up with now.
      if (pick.aligned) {
        const { vertical, horizontal } = pick.aligned;
        const kept: NonNullable<ToolPick["aligned"]> = {};
        if (vertical && Math.abs(vertical.x - pick.position.x) < 1e-9) kept.vertical = vertical;
        if (horizontal && Math.abs(horizontal.y - pick.position.y) < 1e-9) {
          kept.horizontal = horizontal;
        }
        if (kept.vertical || kept.horizontal) pick.aligned = kept;
        else delete pick.aligned;
      }
    }
    return pick;
  }

  private updateCreatePreview(sketch: Sketch): void {
    const { tool, toolOptions } = appState.get();
    const create = createTool(tool);
    this.preview = null;
    if (!create || !this.cursor || this.picks.length === 0) return;
    const picks = [...this.picks, this.cursor];
    this.preview = buildFromPicks(sketch, { ...create, minPicks: Math.min(create.minPicks, 2) }, picks, toolOptions);
    if (!this.preview && typeof create.clicks === "number" && picks.length < create.clicks) {
      // Not enough picks for the real shape yet: show a guide line instead.
      this.preview = null;
    }
  }

  pointerDown(p: PointerInfo): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    const sketch = feature.sketch;
    const { tool } = appState.get();
    if (appState.get().dimensionEdit) return true;

    const dialog = appState.get().dialog;
    if (dialog?.type === "text") {
      // While a text is written, the only thing to pick is the curve it follows.
      if (dialog.picking === "path") {
        const e = this.hitEntity(sketch, p, { points: false });
        if (e) pickTextPath(e.id);
      }
      return true;
    }
    if (tool === "text") {
      const pick = this.pickAt(sketch, p);
      if (pick) beginText(feature.id, pick.snap.pointId ?? pick.position);
      return true;
    }

    const create = createTool(tool);
    if (create) {
      const pick = this.resolveCreatePick(sketch, create.inferAxis ?? false, p);
      if (!pick) return true;
      this.addCreatePick(feature, pick);
      return true;
    }

    if (tool === "select" || tool === "node-edit") {
      this.beginDrag(feature, p);
      return true;
    }

    if (this.grabsOffset(p)) {
      this.offsetDrag = true;
      return true;
    }

    if (SELECTION_TOOLS.has(tool)) {
      this.transformClick(feature, p);
      return true;
    }

    if (tool.startsWith("constraint:")) {
      this.constraintClick(feature, tool.slice("constraint:".length), p);
      return true;
    }

    if (tool === "dimension") {
      this.dimensionClick(feature, p);
      return true;
    }

    this.modifyClick(feature, tool, p);
    return true;
  }

  pointerUp(p: PointerInfo): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    if (this.offsetDrag) {
      this.offsetDrag = false;
      return true;
    }
    const drag = this.drag;
    if (!drag) return true;
    this.drag = null;
    if (drag.kind === "window") {
      if (drag.started) this.selectWindow(feature, drag.startScreen, { x: p.x, y: p.y }, drag.additive);
      else select(drag.click, drag.additive);
      this.requestDraw();
      return true;
    }
    if (drag.started) {
      documentStore.commit();
      this.requestDraw();
      return true;
    }
    if (documentStore.inTransaction) documentStore.cancel();
    // A click without movement selects.
    if (drag.kind === "label") {
      const item: Selection = { kind: "dimension", sketchId: feature.id, id: drag.dimensionId };
      const { selection } = appState.get();
      const already = selection.length === 1 && selectionKey(selection[0]!) === selectionKey(item);
      // Clicking a dimension that is already selected edits it (double-click works as well).
      if (already && !p.shift && !p.meta) this.openDimensionEditor(feature, drag.dimensionId, false);
      else select(item, p.shift || p.meta);
    } else {
      select(drag.hit, p.shift || p.meta);
    }
    this.requestDraw();
    return true;
  }

  doubleClick(p: PointerInfo): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    const { tool } = appState.get();
    const create = createTool(tool);
    // Double-clicking a dimension edits it whatever the tool, unless a shape is being drawn.
    // The first click of the double-click may have placed the first point of a shape.
    if (this.picks.length <= 1 && this.entityPicks.length === 0) {
      const label = this.hitLabel(p);
      if (label?.kind === "dimension") {
        this.picks = [];
        this.preview = null;
        this.openDimensionEditor(feature, label.id, false);
        return true;
      }
    }
    if (create && create.clicks === "many") {
      // The second click of the double-click added a duplicate pick.
      const n = this.picks.length;
      if (n >= 2 && dist2(this.picks[n - 1]!.position, this.picks[n - 2]!.position) < 1e-9) {
        this.picks.pop();
      }
      this.finishCreate(feature);
      return true;
    }
    if (tool === "select") {
      const label = this.hitLabel(p);
      if (label?.kind === "dimension") {
        this.openDimensionEditor(feature, label.id, false);
        return true;
      }
      const hit = this.hitEntity(feature.sketch, p, { points: false });
      if (hit && isCurve(hit)) {
        // A curve: the chain it belongs to, as in Fusion (a rectangle: its four sides).
        const chain = connectedChain(feature.sketch, hit.id);
        const items: Selection[] = chain.map((entityId) => ({ kind: "entity", sketchId: feature.id, entityId }));
        const additive = isAdditiveClick({ shiftKey: p.shift, metaKey: p.meta, ctrlKey: false });
        const keep = additive
          ? appState.get().selection.filter((s) => !items.some((i) => isSelected([i], s)))
          : [];
        appState.set({ selection: [...keep, ...items] });
        this.requestDraw();
        return true;
      }
      if (!hit) {
        const text = this.hitText(feature.sketch, p);
        if (text) editText(feature.id, text);
      }
    }
    return true;
  }

  /** A point typed for the running Create tool, as if it had been clicked there. */
  typePoint(point: Vec2): boolean {
    const feature = this.activeFeature();
    const create = createTool(appState.get().tool);
    if (!feature || !create) return false;
    // A typed point on an existing point is that point, so that shapes join up.
    const existing = Object.values(feature.sketch.entities).find(
      (e) => e.type === "point" && Math.hypot(e.x - point.x, e.y - point.y) < 1e-6,
    );
    const pick: ToolPick = {
      position: { x: point.x, y: point.y },
      snap: existing ? { point, pointId: existing.id, kind: "point" } : { point, kind: "none" },
    };
    this.cursor = pick;
    this.addCreatePick(feature, pick);
    const current = this.activeFeature();
    if (current) this.updateCreatePreview(current.sketch);
    this.requestDraw();
    return true;
  }

  lastPick(): Vec2 | null {
    const last = this.picks[this.picks.length - 1];
    return last ? { ...last.position } : null;
  }

  /** Enter: finish open-ended tools. */
  confirm(): boolean {
    const feature = this.activeFeature();
    if (!feature) return false;
    if (appState.get().sketchOffset) {
      commitOffset();
      this.requestDraw();
      return true;
    }
    if (appState.get().sketchTransform) {
      commitTransform();
      this.requestDraw();
      return true;
    }
    const create = createTool(appState.get().tool);
    if (create && create.clicks === "many" && this.picks.length >= create.minPicks) {
      this.finishCreate(feature);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- create tools

  private addCreatePick(feature: SketchFeature, pick: ToolPick): void {
    const { tool } = appState.get();
    const create = createTool(tool);
    if (!create) return;
    const last = this.picks[this.picks.length - 1];
    if (last && dist2(last.position, pick.position) < 1e-9) return;
    this.picks.push(pick);
    // A new shape is started: the dimensions of the previous one are left as drawn.
    if (this.picks.length === 1 && appState.get().shapeDimensions) appState.set({ shapeDimensions: null });
    if (this.picks.length === 1 && TOOLS_WITH_WINDOW.has(tool) && !appState.get().toolPanel) {
      const s = this.projectorFor(feature.sketch).toScreen(pick.position);
      this.openToolPanel({ x: s.x, y: s.y, shift: false, meta: false });
    }

    if (create.clicks === "many") {
      // Clicking the first point again closes the shape.
      const first = this.picks[0]!;
      const closes =
        this.picks.length > 3 &&
        dist2(first.position, pick.position) < 1e-9 &&
        create.id !== "spline-control";
      if (closes) {
        this.finishCreate(feature);
        return;
      }
    } else if (this.picks.length >= create.clicks) {
      this.finishCreate(feature);
      return;
    }
    this.refreshHint();
    this.updateCreatePreview(feature.sketch);
    this.requestDraw();
  }

  private finishCreate(feature: SketchFeature): void {
    const { tool, toolOptions } = appState.get();
    const create = createTool(tool);
    if (!create) return;
    const picks = this.picks;
    this.picks = [];
    this.preview = null;
    if (picks.length < create.minPicks) {
      this.refreshHint();
      this.requestDraw();
      return;
    }
    let built: BuiltShape | null = null;
    const ok = editSketchSolved(feature.id, create.label, (sketch) => {
      built = buildFromPicks(sketch, create, picks, toolOptions);
      return built ? built.sketch : sketch;
    });
    const result = built as BuiltShape | null;
    if (ok && result) this.offerDimensions(create.id, create.label, result);
    if (!ok || !result) {
      if (!result) toast(`${create.label}: the picked points do not form a valid shape.`, "warning");
    } else if (create.chain) {
      // Continue the chain from the end of the line just drawn.
      const sketch = this.activeFeature()?.sketch;
      const end = sketch ? lastPointOf(sketch, result.result) : null;
      if (sketch && end && sketch.entities[end]) {
        const position = getPoint(sketch, end);
        this.picks = [{ position, snap: { point: position, pointId: end, kind: "point" } }];
      }
    }
    this.refreshHint();
    this.requestDraw();
  }

  /** Open the window with the dimensions that size the shape just drawn, beside it. */
  private offerDimensions(tool: string, label: string, built: BuiltShape): void {
    const feature = this.activeFeature();
    if (!feature) return;
    const fields = shapeDimensions(feature.sketch, tool, built.result);
    const at = shapeAnchor(feature.sketch, built.result);
    if (fields.length === 0 || !at) {
      appState.set({ shapeDimensions: null });
      return;
    }
    const s = this.projectorFor(feature.sketch).toScreen(at);
    const r = this.canvas.getBoundingClientRect();
    appState.set({
      shapeDimensions: { sketchId: feature.id, title: label, anchor: { x: s.x + r.left, y: s.y + r.top }, fields },
    });
  }

  // -------------------------------------------------------- selection / drag

  private beginDrag(feature: SketchFeature, p: PointerInfo): void {
    // A point under the pointer wins over the glyphs and labels drawn next to it.
    const onPoint = (appState.get().tool === "node-edit"
      ? this.hitEditableNode(feature.sketch, p)
      : this.hitEntity(feature.sketch, p, { curves: false })) !== null;
    const label = onPoint ? null : this.hitLabel(p);
    if (label?.kind === "dimension") {
      this.drag = {
        kind: "label",
        startScreen: { x: p.x, y: p.y },
        dimensionId: label.id,
        started: false,
      };
      return;
    }
    if (label?.kind === "constraint") {
      select({ kind: "constraint", sketchId: feature.id, id: label.id }, p.shift || p.meta);
      return;
    }
    const sketch = feature.sketch;
    const editingNodes = appState.get().tool === "node-edit";
    const e = editingNodes ? this.hitEditableNode(sketch, p) : this.hitEntity(sketch, p);
    const start = this.projectorFor(sketch).toSketch(p.x, p.y);
    const textId = !editingNodes && !e && start ? this.hitText(sketch, p) : null;
    const text = textId ? sketch.texts?.[textId] : undefined;
    if (text && start) {
      // A text is moved by its origin point.
      const free = text.origin !== sketch.originId && !text.path;
      this.drag = {
        kind: "entities",
        startScreen: { x: p.x, y: p.y },
        startSketch: start,
        points: free ? [{ id: text.origin, start: getPoint(sketch, text.origin) }] : [],
        circle: null,
        base: sketch,
        started: false,
        hit: { kind: "text", sketchId: feature.id, textId: text.id },
      };
      return;
    }
    if (!e || !start) {
      // Empty space: a profile can still be selected.
      const region = start && !editingNodes ? this.regionAt(sketch, start) : null;
      this.drag = {
        kind: "window",
        startScreen: { x: p.x, y: p.y },
        current: { x: p.x, y: p.y },
        started: false,
        additive: p.shift || p.meta,
        click: region
          ? { kind: "profile", sketchId: feature.id, regionId: region.id, ref: profileRefOf(region) }
          : null,
      };
      return;
    }
    // Dragging a selected entity moves the whole selection.
    const hit: Selection = { kind: "entity", sketchId: feature.id, entityId: e.id };
    const selected = this.selectedEntityIds(feature.id);
    const moving = editingNodes
      ? (selected.includes(e.id)
        ? selected.filter((id) => editableNodes(sketch).has(id))
        : [e.id])
      : (selected.includes(e.id) ? selected : [e.id]);
    const ids = new Set<EntityId>();
    for (const id of moving) {
      const ent = sketch.entities[id];
      if (ent) for (const pid of entityPointIds(ent)) ids.add(pid);
    }
    // Dragging the rim of a circle changes its radius instead of moving it.
    const circle = e.type === "circle" && moving.length === 1 ? e.id : null;
    this.drag = {
      kind: "entities",
      startScreen: { x: p.x, y: p.y },
      startSketch: start,
      points: circle ? [] : [...ids].map((id) => ({ id, start: getPoint(sketch, id) })),
      circle,
      base: sketch,
      started: false,
      hit,
    };
  }

  private continueDrag(feature: SketchFeature, p: PointerInfo): void {
    const drag = this.drag;
    if (!drag) return;
    // While measuring, geometry is looked at, not moved.
    if (drag.kind === "entities" && appState.get().measuring) return;
    if (!drag.started) {
      if (Math.hypot(p.x - drag.startScreen.x, p.y - drag.startScreen.y) < DRAG_START_PX * this.reach) return;
      drag.started = true;
      if (drag.kind !== "window") documentStore.begin(drag.kind === "label" ? "Move dimension" : "Drag sketch");
    }
    if (drag.kind === "window") {
      drag.current = { x: p.x, y: p.y };
      if (appState.get().hover) appState.set({ hover: null });
      this.requestDraw();
      return;
    }
    const base = drag.kind === "entities" ? drag.base : feature.sketch;
    const now = this.projectorFor(base).toSketch(p.x, p.y);
    if (!now) return;

    if (drag.kind === "label") {
      documentStore.update((doc) =>
        applySketchEdit(doc, feature.id, (s) => {
          const d = s.dimensions[drag.dimensionId];
          if (!d) return s;
          return {
            ...s,
            dimensions: { ...s.dimensions, [d.id]: { ...d, labelPosition: now } },
          };
        }),
      );
      this.requestDraw();
      return;
    }

    this.dragAlignment = null;
    let next: Sketch | null;
    if (drag.circle) {
      const c = drag.base.entities[drag.circle];
      if (!c || c.type !== "circle") return;
      const measured = dist2(now, getPoint(drag.base, c.center));
      const radius = Math.max(this.gridSnap(p) ? toGrid(measured) : measured, 1e-3);
      const resized = editSketch(drag.base, (b) => b.updateEntity(c.id, { radius }));
      next = solveDrag(resized, []);
    } else {
      const free = sub2(now, drag.startSketch);
      // Lettering often uses sub-millimetre control handles. Node Edit intentionally moves
      // them without the sketch's default 1 mm grid or alignment snapping.
      const preciseNode = appState.get().tool === "node-edit";
      const grid = !preciseNode && this.gridSnap(p);
      // One point lands on the grid itself; several points move together by whole millimetres.
      const delta = grid && drag.points.length > 1 ? snapToGrid(free) : free;
      let targets = drag.points.map((pt) => {
        const target = add2(pt.start, delta);
        return {
          pointId: pt.id,
          target: grid && drag.points.length === 1 ? snapToGrid(target) : target,
        };
      });
      // A single dragged point snaps to other geometry, and lines up with other points.
      if (targets.length === 1 && !p.meta && !preciseNode) {
        const only = targets[0]!;
        const at = add2(drag.points[0]!.start, free);
        const px = this.projectorFor(drag.base).pixel(at);
        const snap = snapPoint(drag.base, at, px * SNAP_PX * this.reach, [only.pointId]);
        if (snap.kind === "point" || snap.kind === "center") {
          targets = [{ pointId: only.pointId, target: snap.point }];
        } else {
          const lined = this.freePosition(drag.base, at, p, px, [only.pointId]);
          targets = [{ pointId: only.pointId, target: lined.position }];
          if (lined.aligned) this.dragAlignment = { at: lined.position, aligned: lined.aligned };
        }
      }
      next = solveDrag(drag.base, preciseNode ? expandNodeDrag(drag.base, targets) : targets);
      if (next && preciseNode) next = releaseSharpOnHandleDrag(next, targets);
      // Constraints may have kept the point from getting there: no guide to where it is not.
      if (this.dragAlignment && next) {
        const moved = next.entities[drag.points[0]!.id];
        const at = this.dragAlignment.at;
        if (moved?.type !== "point" || dist2(moved, at) > 1e-6) this.dragAlignment = null;
      }
    }
    if (!next) return;
    const solved = next;
    // Keep dimension labels where the user put them; only geometry follows the drag.
    documentStore.update((doc) => applySketchEdit(doc, feature.id, () => solved));
    this.requestDraw();
  }

  private regionAt(sketch: Sketch, p: Vec2): SketchRegion | null {
    const regions = sketchView(sketch).regions.filter(
      (r) =>
        pointInPolygon(p, r.polygon) && !r.holePolygons.some((h) => pointInPolygon(p, h)),
    );
    regions.sort((a, b) => a.area - b.area);
    return regions[0] ?? null;
  }

  // ------------------------------------------------------------- constraints

  private constraintClick(feature: SketchFeature, type: string, p: PointerInfo): void {
    const def = CONSTRAINT_TOOLS.find((c) => c.type === type);
    if (!def) return;
    const e = this.hitEntity(feature.sketch, p);
    if (!e) {
      this.entityPicks = [];
      this.syncPickSelection(feature.id);
      return;
    }
    this.entityPicks.push(e.id);
    const entities = this.entityPicks.flatMap((id) => {
      const ent = feature.sketch.entities[id];
      return ent ? [ent] : [];
    });
    const state = constraintRefs(def.type, entities);
    if (state.state === "invalid") {
      toast(`${def.label}: ${def.hint}.`, "warning");
      // Keep the latest pick as the start of a new attempt.
      const single = constraintRefs(def.type, [e]);
      this.entityPicks = single.state === "invalid" ? [] : [e.id];
      if (single.state === "ready") this.applyConstraint(feature.id, def.type, single.refs);
    } else if (state.state === "ready") {
      this.applyConstraint(feature.id, def.type, state.refs);
    }
    this.syncPickSelection(feature.id);
  }

  private syncPickSelection(sketchId: string): void {
    setSelection(this.entityPicks.map((entityId) => ({ kind: "entity", sketchId, entityId })));
    this.refreshHint();
    this.requestDraw();
  }

  /** Apply a constraint; `fix` toggles. Returns false when it was refused. */
  applyConstraint(sketchId: string, type: (typeof CONSTRAINT_TOOLS)[number]["type"], refs: EntityId[]): boolean {
    this.entityPicks = [];
    const def = CONSTRAINT_TOOLS.find((c) => c.type === type);
    return editSketchSolved(
      sketchId,
      def?.label ?? "Constraint",
      (sketch) => {
        const existing = Object.values(sketch.constraints).find(
          (c) =>
            c.type === type &&
            c.refs.length === refs.length &&
            c.refs.every((r) => refs.includes(r)),
        );
        if (existing) {
          if (type !== "fix") return sketch;
          return editSketch(sketch, (b) => b.removeConstraint(existing.id));
        }
        return editSketch(sketch, (b) => {
          b.constrain(type, ...refs);
        });
      },
      { rejectOverConstrained: true },
    );
  }

  // --------------------------------------------------------------- dimensions

  private dimensionClick(feature: SketchFeature, p: PointerInfo): void {
    const sketch = feature.sketch;
    // With nothing picked yet, clicking an existing dimension edits it (as in Fusion).
    if (this.entityPicks.length === 0) {
      const label = this.hitLabel(p);
      if (label?.kind === "dimension") {
        this.openDimensionEditor(feature, label.id, false);
        return;
      }
    }
    const e = this.entityPicks.length < 2 ? this.hitEntity(sketch, p) : null;
    if (e && !this.entityPicks.includes(e.id)) {
      if (e.type === "ellipse" || e.type === "spline") {
        toast("Dimensions on ellipses and splines are not supported yet.", "warning");
        return;
      }
      this.entityPicks.push(e.id);
      this.syncPickSelection(feature.id);
      return;
    }
    if (this.entityPicks.length === 0) return;
    const label = this.projectorFor(sketch).toSketch(p.x, p.y);
    if (!label) return;
    const entities = this.entityPicks.flatMap((id) => {
      const ent = sketch.entities[id];
      return ent ? [ent] : [];
    });
    const plan = planDimension(sketch, entities, label);
    this.entityPicks = [];
    if (!plan) {
      toast("These entities cannot be dimensioned together.", "warning");
      this.syncPickSelection(feature.id);
      return;
    }
    let createdId = "";
    const ok = editSketchSolved(
      feature.id,
      "Dimension",
      (s) =>
        editSketch(s, (b) => {
          const probe = {
            id: "probe",
            type: plan.type,
            refs: plan.refs,
            expression: "0",
            driving: true,
          };
          const value = measureDimension(b.current, probe) ?? 0;
          createdId = b.dimension(plan.type, plan.refs, formatDimensionValue(value), {
            labelPosition: label,
          });
        }),
      { rejectOverConstrained: true },
    );
    setSelection([]);
    this.refreshHint();
    if (ok && createdId) this.openDimensionEditor(this.activeFeature() ?? feature, createdId, true);
    this.requestDraw();
  }

  openDimensionEditor(feature: SketchFeature, dimensionId: string, fresh: boolean): void {
    const dim = feature.sketch.dimensions[dimensionId];
    if (!dim) return;
    const at = this.projectorFor(feature.sketch).toScreen(labelPositionOf(feature.sketch, dim));
    appState.set({
      dimensionEdit: {
        sketchId: feature.id,
        dimensionId,
        x: at.x,
        y: at.y,
        value: dim.expression,
        fresh,
      },
    });
  }

  // ----------------------------------------------------------- modify tools

  private modifyClick(feature: SketchFeature, tool: string, p: PointerInfo): void {
    const sketch = feature.sketch;
    const at = this.projectorFor(sketch).toSketch(p.x, p.y);
    if (!at) return;
    const options = appState.get().toolOptions;
    const curve = this.hitEntity(sketch, p, { points: false });

    const apply = (label: string, fn: (s: Sketch) => Sketch): void => {
      editSketchSolved(feature.id, label, fn);
      appState.set({ hover: null });
      this.requestDraw();
    };

    switch (tool) {
      case "node-add": {
        if (!curve) return;
        const result = insertNodeOnCurve(sketch, curve.id, at);
        if (!result.nodeId) {
          toast("Pick an unconstrained line or cubic Bézier away from its endpoints.", "warning");
          return;
        }
        if (editSketchSolved(feature.id, "Add Node", () => result.sketch)) {
          appState.set({
            selection: [{ kind: "entity", sketchId: feature.id, entityId: result.nodeId }],
            hover: null,
          });
          // Return to editing the inserted point, including on touch screens.
          setTool("node-edit");
          this.requestDraw();
        }
        return;
      }
      case "trim":
        if (curve) apply("Trim", (s) => trimCurve(s, curve.id, at));
        return;
      case "extend":
        if (curve) apply("Extend", (s) => extendCurve(s, curve.id, at));
        return;
      case "break":
        if (curve) apply("Break", (s) => breakCurve(s, curve.id, at).sketch);
        return;
      case "offset": {
        if (!curve) return;
        // Another curve: the offset that was waiting is kept, and the new one starts.
        if (appState.get().sketchOffset) commitOffset();
        const current = this.activeFeature() ?? feature;
        // Curves selected together (a chain picked by double-click, or several picked by hand)
        // are offset together when one of them is clicked; otherwise the chain of the curve.
        const selected = appState
          .get()
          .selection.flatMap((s) =>
            s.kind === "entity" && s.sketchId === feature.id && isCurve(current.sketch.entities[s.entityId])
              ? [s.entityId]
              : [],
          );
        const chain =
          selected.length > 1 && selected.includes(curve.id)
            ? selected
            : connectedChain(current.sketch, curve.id);
        const distance = options.offsetDistance;
        const side = offsetSideAt(current.sketch, chain, distance, at);
        if (side === null) {
          toast("This chain cannot be offset.", "warning");
          return;
        }
        appState.set({ sketchOffset: { sketchId: feature.id, chain, distance, side }, hover: null });
        this.openToolPanel(p);
        this.refreshHint();
        this.requestDraw();
        return;
      }
      case "fillet":
      case "chamfer": {
        if (!curve || curve.type !== "line") {
          if (curve) toast("Pick a line.", "warning");
          return;
        }
        if (this.entityPicks.includes(curve.id)) return;
        this.entityPicks.push(curve.id);
        if (this.entityPicks.length < 2) {
          if (!appState.get().toolPanel) this.openToolPanel(p);
          this.syncPickSelection(feature.id);
          return;
        }
        const [a, b] = this.entityPicks as [string, string];
        this.entityPicks = [];
        setSelection([]);
        if (tool === "fillet") {
          apply("Sketch fillet", (s) => sketchFillet(s, a, b, options.filletRadius).sketch);
        } else {
          apply("Sketch chamfer", (s) => sketchChamfer(s, a, b, options.chamferDistance).sketch);
        }
        this.refreshHint();
        return;
      }
      default:
        return;
    }
  }

  /** Whether a pointer going down at `p` grabs something of the running command. */
  grabs(p: PointerInfo): boolean {
    return this.grabsOffset(p);
  }

  /** Whether `p` is on the previewed Offset curve, which can be dragged to a distance. */
  private grabsOffset(p: PointerInfo): boolean {
    const offset = appState.get().sketchOffset;
    const feature = this.activeFeature();
    if (!offset || !feature || feature.id !== offset.sketchId) return false;
    const projector = this.projectorFor(feature.sketch);
    const at = projector.toSketch(p.x, p.y);
    if (!at) return false;
    return onOffsetPreview(feature.sketch, offset, at, projector.pixel(at) * HIT_PX * this.reach);
  }

  private dragOffset(feature: SketchFeature, p: PointerInfo): void {
    const offset = appState.get().sketchOffset;
    if (!offset) return;
    const projector = this.projectorFor(feature.sketch);
    const at = projector.toSketch(p.x, p.y);
    if (!at) return;
    // Whole millimetres with the grid snap, otherwise a step that suits the zoom.
    const step = this.gridSnap(p) ? 1 : p.meta ? 0.01 : dragStep(projector.pixel(at)) / 10;
    const next = offsetThrough(feature.sketch, offset.chain, at, step);
    if (next && (next.distance !== offset.distance || next.side !== offset.side)) patchOffset(next);
    appState.set({ cursor: at });
    this.requestDraw();
  }

  /** A click for the input of the transform command that is being picked. */
  private transformClick(feature: SketchFeature, p: PointerInfo): void {
    const t = appState.get().sketchTransform;
    if (!t || t.sketchId !== feature.id || !t.picking) return;
    let next: SketchTransform;
    if (t.picking === "objects" || t.picking === "axis") {
      const e = this.hitEntity(feature.sketch, p, t.picking === "axis" ? { points: false } : undefined);
      if (!e) return;
      next = pickInto(t, { entity: e.id, entityType: e.type });
    } else {
      const pick = this.pickAt(feature.sketch, p);
      if (!pick) return;
      next = pickInto(t, {
        point: { position: pick.position, ...(pick.snap.pointId ? { pointId: pick.snap.pointId } : {}) },
      });
    }
    // The objects are shown as the selection.
    appState.set({
      sketchTransform: next,
      selection: next.objects.map((entityId) => ({ kind: "entity", sketchId: feature.id, entityId })),
    });
    this.requestDraw();
  }

  private transformCache: { sketch: Sketch; t: SketchTransform; preview: Sketch | null } | null = null;

  /** The preview of the transform command, kept while neither the sketch nor the inputs change. */
  private transformPreview(sketch: Sketch, t: SketchTransform): Sketch | null {
    const c = this.transformCache;
    if (c && c.sketch === sketch && c.t === t) return c.preview;
    const r = transformResult(sketch, t, transformEvaluate);
    const preview = r.ok ? r.preview : null;
    this.transformCache = { sketch, t, preview };
    return preview;
  }

  // ----------------------------------------------------- profiles in 3D mode

  /**
   * Sketches that the open feature dialog refers to. They are shown and can be picked while
   * it is open, although a sketch is hidden once a feature has been built from it.
   */
  private dialogSketches(): Set<string> {
    const dialog = appState.get().dialog;
    return isSolidDialog(dialog) ? dialogSketches(dialog) : new Set();
  }

  /**
   * Whether a sketch belongs to the component being edited. Sketches lie in the coordinates of
   * their component, so those of other components are neither drawn nor picked.
   */
  private inContext(f: SketchFeature): boolean {
    return f.componentId === validComponentId(this.doc, appState.get().activeComponentId);
  }

  /** Closed profile of any visible sketch under the pointer (for Extrude / Revolve). */
  profileAt(
    x: number,
    y: number,
    options: { onlySketch?: string | null; visibleOnly?: boolean } = {},
  ): HoverProfile | null {
    let best: HoverProfile | null = null;
    const used = this.dialogSketches();
    for (const f of Object.values(this.doc.features)) {
      if (f.type !== "sketch" || (!f.visible && !used.has(f.id)) || f.suppressed) continue;
      if (!this.inContext(f)) continue;
      if (options.onlySketch && f.id !== options.onlySketch) continue;
      const projector = this.projectorFor(f.sketch);
      const at = projector.toSketch(x, y);
      if (!at) continue;
      const region = this.regionAt(f.sketch, at);
      if (!region) continue;
      // Profiles hidden behind a body are not what the user is pointing at.
      if (
        options.visibleOnly &&
        !this.scene.isPointVisible(x, y, planeToWorld(projector.plane, at))
      ) {
        continue;
      }
      if (!best || region.area < best.region.area) best = { sketchId: f.id, region };
    }
    return best;
  }

  /**
   * Geometry of a visible sketch under the pointer, seen from the solid environment. Geometry
   * hidden behind a body is skipped, unless `through` is set: sketches are drawn on top of the
   * bodies, and a command that asks for sketch geometry takes what can be seen.
   */
  entityAt(
    x: number,
    y: number,
    options: {
      points?: boolean;
      curves?: boolean;
      /** The sketch origin counts as a point. */
      origin?: boolean;
      through?: boolean;
      accept?: (e: SketchEntity) => boolean;
    } = {},
  ): { sketchId: string; entityId: EntityId } | null {
    let best: { sketchId: string; entityId: EntityId; distance: number } | null = null;
    const used = this.dialogSketches();
    const { accept } = options;
    for (const f of Object.values(this.doc.features)) {
      if (f.type !== "sketch" || (!f.visible && !used.has(f.id)) || f.suppressed) continue;
      if (!this.inContext(f)) continue;
      const projector = this.projectorFor(f.sketch);
      const at = projector.toSketch(x, y);
      if (!at) continue;
      const px = projector.pixel(at);
      // Points stay: the curves that are left are defined by them.
      const sketch: Sketch = accept
        ? {
            ...f.sketch,
            entities: Object.fromEntries(
              Object.entries(f.sketch.entities).filter(([, e]) => e.type === "point" || accept(e)),
            ),
          }
        : f.sketch;
      const hit = hitTestSketch(sketch, at, px * HIT_PX * this.reach, {
        points: options.points,
        curves: options.curves,
      });
      if (!hit || (hit.id === f.sketch.originId && !options.origin)) continue;
      if (
        !options.through &&
        !this.scene.isPointVisible(x, y, planeToWorld(projector.plane, at))
      ) {
        continue;
      }
      const distance = hit.distance / Math.max(px, 1e-12);
      if (!best || distance < best.distance) best = { sketchId: f.id, entityId: hit.id, distance };
    }
    return best ? { sketchId: best.sketchId, entityId: best.entityId } : null;
  }

  /** Sketch line of a visible sketch under the pointer (revolve axis). */
  lineAt(x: number, y: number, sketchId: string): EntityId | null {
    const f = this.doc.features[sketchId];
    if (!f || f.type !== "sketch") return null;
    const e = this.hitEntity(f.sketch, { x, y, shift: false, meta: false }, { points: false });
    return e && e.type === "line" ? e.id : null;
  }

  setHoverProfile(profile: HoverProfile | null): void {
    const a = this.hoverProfile;
    if (a?.sketchId === profile?.sketchId && a?.region.id === profile?.region.id) return;
    this.hoverProfile = profile;
    this.requestDraw();
  }

  // ------------------------------------------------------------------ drawing

  requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width, height } = this.scene.size;
    ctx.clearRect(0, 0, width, height);
    this.labelHits = [];
    const state = appState.get();
    const doc = this.doc;
    const dialog = state.dialog;
    const pickingProfiles =
      !state.activeSketchId &&
      dialog !== null &&
      (dialog.type === "extrude" || dialog.type === "revolve");
    const dialogProfiles =
      dialog && (dialog.type === "extrude" || dialog.type === "revolve") ? dialog : null;
    // The dialogs that pick through `dialogWants`: what they hold and what they ask for.
    const solid = !state.activeSketchId && isSolidDialog(dialog) ? dialog : null;
    const references = solid ? dialogReferences(solid) : null;
    const wants = solid ? dialogWants(solid) : null;
    const used = solid ? dialogSketches(solid) : new Set<string>();

    for (const id of doc.timeline) {
      const f = doc.features[id];
      if (!f || f.type !== "sketch") continue;
      const active = f.id === state.activeSketchId;
      const visible = (f.visible || used.has(f.id)) && this.inContext(f);
      if (!active && (!visible || state.workspace !== "design")) continue;
      if (state.activeSketchId && !active && !f.visible) continue;

      const sketch = f.sketch;
      const projector = this.projectorFor(sketch);
      const view = sketchView(sketch, doc);

      if (active) drawGrid(ctx, projector, width, height);

      // Closed profiles.
      const selectedRegions = new Set<string>();
      for (const s of state.selection) {
        if (s.kind === "profile" && s.sketchId === f.id) selectedRegions.add(s.regionId);
      }
      if (dialogProfiles && dialogProfiles.sketchId === f.id) {
        for (const ref of dialogProfiles.profiles) {
          if (ref.textId !== undefined) {
            for (const r of resolveProfileRefs(view.regions, ref)) selectedRegions.add(r.id);
            continue;
          }
          const hit = view.regions.find(
            (r) =>
              r.entityIds.length === ref.entityIds.length &&
              r.entityIds.every((e) => ref.entityIds.includes(e)) &&
              pointInPolygon(ref.point, r.polygon),
          );
          const fallback = hit ?? this.regionAt(sketch, ref.point);
          if (fallback) selectedRegions.add(fallback.id);
        }
      }
      for (const p of references?.profiles ?? []) {
        if (p.sketchId !== f.id) continue;
        for (const r of resolveProfileRefs(view.regions, p.ref)) selectedRegions.add(r.id);
      }
      const offered = pickingProfiles || wants?.profiles === true;
      if (active || offered || selectedRegions.size > 0) {
        for (const region of view.regions) {
          const hovered =
            this.hoverProfile?.sketchId === f.id && this.hoverProfile.region.id === region.id;
          const color = selectedRegions.has(region.id)
            ? SKETCH_COLORS.profileSelected
            : hovered
              ? SKETCH_COLORS.profileHover
              : active || offered
                ? SKETCH_COLORS.profile
                : null;
          if (color) fillRegion(ctx, projector, region, color);
        }
      }

      const selectedEntities = new Set<string>();
      const selectedLabels = new Set<string>();
      const selectedTexts = new Set<string>();
      for (const s of state.selection) {
        if (s.kind === "text" && s.sketchId === f.id) selectedTexts.add(s.textId);
        if (s.kind === "entity" && s.sketchId === f.id) selectedEntities.add(s.entityId);
        if (s.kind === "dimension" && s.sketchId === f.id) selectedLabels.add(`dimension:${s.id}`);
        if (s.kind === "constraint" && s.sketchId === f.id) selectedLabels.add(`constraint:${s.id}`);
        if (s.kind === "feature" && s.featureId === f.id && !active) {
          // The curves stand for the sketch; of its points only the ones that stand by
          // themselves are drawn out here.
          for (const e of Object.values(sketch.entities)) {
            if (e.type !== "point") selectedEntities.add(e.id);
          }
          for (const e of freePoints(sketch)) selectedEntities.add(e);
        }
      }
      for (const e of references?.entities ?? []) {
        if (e.sketchId === f.id) selectedEntities.add(e.entityId);
      }
      if (dialog?.type === "revolve" && dialog.sketchId === f.id && dialog.axis?.type === "sketch-line") {
        selectedEntities.add(dialog.axis.entityId);
      }
      const hover = state.hover;
      const drawState: SketchDrawState = {
        active,
        nodeEdit: active && state.tool === "node-edit",
        fullyConstrained: view.status === "fully-constrained",
        selectedEntities,
        selectedLabels,
        hoverEntity: hover?.kind === "entity" && hover.sketchId === f.id ? hover.entityId : null,
        hoverLabel:
          hover && (hover.kind === "dimension" || hover.kind === "constraint") && hover.sketchId === f.id
            ? `${hover.kind}:${hover.id}`
            : null,
        conflicting: new Set(view.status === "over-constrained" ? view.conflicting : []),
        projected: projectedEntityIds(sketch),
        selectedTexts,
        hoverText: hover?.kind === "text" && hover.sketchId === f.id ? hover.textId : null,
        problemTexts: new Set(
          (textState.get().problems[f.id] ?? [])
            .filter((p) => p.kind !== "font-loading")
            .map((p) => p.textId),
        ),
        previewEntities: new Set(),
        shownPoints: wants?.sketchPoints ? "all" : new Set(freePoints(sketch)),
        showConstraints: state.showConstraints,
        showDimensions: state.showDimensions,
        dimensionValues: view.dimensionValues,
        dimensionErrors: view.dimensionErrors,
      };
      drawSketchGeometry(ctx, projector, sketch, drawState);

      if (!active) continue;
      if (state.showDimensions) drawDimensions(ctx, projector, sketch, drawState, this.labelHits);
      if (state.showConstraints) drawConstraints(ctx, projector, sketch, drawState, this.labelHits);

      // Preview of the shape being created or transformed.
      const offset = state.sketchOffset;
      const offsetPreview =
        offset && offset.sketchId === f.id ? offsetSketch(sketch, offset) : null;
      const transform = state.sketchTransform;
      const transformPreview =
        transform && transform.sketchId === f.id ? this.transformPreview(sketch, transform) : null;
      const previewSketch = this.preview?.sketch ?? this.previewSketch ?? offsetPreview ?? transformPreview;
      if (previewSketch) {
        const fresh = new Set(
          Object.keys(previewSketch.entities).filter((e) => !sketch.entities[e]),
        );
        const only: Sketch = {
          ...previewSketch,
          entities: Object.fromEntries(
            Object.entries(previewSketch.entities).filter(
              ([eid, e]) =>
                fresh.has(eid) ||
                (e.type === "point" &&
                  Object.values(previewSketch.entities).some(
                    (o) => fresh.has(o.id) && o.type !== "point" && entityPointIds(o).includes(eid),
                  )),
            ),
          ),
        };
        drawSketchGeometry(ctx, projector, only, {
          ...drawState,
          selectedEntities: new Set(),
          hoverEntity: null,
          previewEntities: new Set(Object.keys(only.entities)),
        });
      } else if (this.cursor && this.picks.length > 0) {
        // Guide from the last pick to the cursor.
        const a = projector.toScreen(this.picks[this.picks.length - 1]!.position);
        const b = projector.toScreen(this.cursor.position);
        ctx.strokeStyle = SKETCH_COLORS.preview;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const pick of this.picks) {
        drawSnapMarker(ctx, projector.toScreen(pick.position), "point");
      }
      if (transform && transform.sketchId === f.id) {
        for (const picked of [transform.center, transform.base, transform.target]) {
          if (picked) drawSnapMarker(ctx, projector.toScreen(picked.position), "center");
        }
      }
      const toolUsesSnap =
        createTool(state.tool) !== undefined ||
        SELECTION_TOOLS.has(state.tool) ||
        state.tool === "text";
      const lined =
        this.drag?.kind === "entities" && this.drag.started
          ? this.dragAlignment
          : this.cursor?.aligned && toolUsesSnap
            ? { at: this.cursor.position, aligned: this.cursor.aligned }
            : null;
      if (lined) {
        drawAlignmentGuides(
          ctx,
          projector.toScreen(lined.at),
          [lined.aligned.vertical, lined.aligned.horizontal].flatMap((ref) =>
            ref ? [projector.toScreen(ref)] : [],
          ),
        );
      }
      if (this.cursor && toolUsesSnap) {
        drawSnapMarker(
          ctx,
          projector.toScreen(this.cursor.position),
          this.cursor.snap.kind,
          this.cursor.inferred,
        );
      }
    }
    if (this.drag?.kind === "window" && this.drag.started) {
      const { startScreen: a, current: b } = this.drag;
      const crossing = windowMode(a, b) === "crossing";
      ctx.fillStyle = crossing ? SKETCH_COLORS.windowCrossingFill : SKETCH_COLORS.windowFill;
      ctx.strokeStyle = crossing ? SKETCH_COLORS.windowCrossing : SKETCH_COLORS.window;
      ctx.lineWidth = 1;
      // Crossing is dashed, as in every CAD, so that the two modes can be told apart.
      ctx.setLineDash(crossing ? [5, 4] : []);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    const between = currentMeasurement()?.between;
    if (between?.line) {
      const a = this.scene.project(between.line.from);
      const b = this.scene.project(between.line.to);
      ctx.strokeStyle = SKETCH_COLORS.selected;
      ctx.fillStyle = SKETCH_COLORS.selected;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const q of [a, b]) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
      const main = between.values.find((v) => v.id === "distance");
      if (main && Math.hypot(a.x - b.x, a.y - b.y) > 24) {
        const text = formatMeasure(main);
        ctx.font = "600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
        const w = ctx.measureText(text).width + 10;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
        ctx.fillRect(cx - w / 2, cy - 9, w, 18);
        ctx.strokeRect(cx - w / 2 + 0.5, cy - 8.5, w - 1, 17);
        ctx.fillStyle = "#1d2b38";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cx, cy + 0.5);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
    }
    this.overlayPainter?.(ctx);
  }

  /** True while a command has picks that Enter could finish or Esc would cancel. */
  get hasPicks(): boolean {
    return this.picks.length > 0 || this.entityPicks.length > 0;
  }
}

/** Signed side of point `p` relative to the directed line a→b (positive = left). */
export const sideOf = (p: Vec2, a: Vec2, b: Vec2): number => cross2(sub2(b, a), sub2(p, a));
