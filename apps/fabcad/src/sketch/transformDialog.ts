import type { Vec2 } from "@fabcad/geometry";
import {
  type EntityId,
  type Sketch,
  circularPattern,
  copyEntities,
  mirrorEntities,
  moveEntities,
  rectangularPattern,
  scaleEntities,
} from "@fabcad/sketch";

/**
 * Move, Copy, Scale, Mirror and the patterns of the sketch as commands with a window, as in
 * Fusion: the window holds every input (the objects, the points or line they need, the
 * numbers), the result is previewed while they change, and OK applies it. Pure functions; the
 * state is `appState.sketchTransform`.
 */

export type TransformTool = "move" | "copy" | "scale" | "mirror" | "rectangular-pattern" | "circular-pattern";

export const TRANSFORM_TOOLS: ReadonlySet<string> = new Set<TransformTool>([
  "move",
  "copy",
  "scale",
  "mirror",
  "rectangular-pattern",
  "circular-pattern",
]);

/** Inputs picked in the view. */
export type PickField = "objects" | "center" | "base" | "target" | "axis";

export interface PickedPoint {
  position: Vec2;
  pointId?: EntityId;
}

export interface SketchTransform {
  tool: TransformTool;
  sketchId: string;
  objects: EntityId[];
  /** The input that clicks in the view go to; null when nothing is being picked. */
  picking: PickField | null;
  center: PickedPoint | null;
  base: PickedPoint | null;
  target: PickedPoint | null;
  axis: EntityId | null;
  /** Expressions of the number fields, by field id. */
  values: Record<string, string>;
  symmetry: boolean;
}

export interface ValueField {
  id: string;
  label: string;
  kind: "length" | "angle" | "count" | "factor";
}

export const TRANSFORM_TITLES: Record<TransformTool, string> = {
  move: "Move",
  copy: "Copy",
  scale: "Scale",
  mirror: "Mirror",
  "rectangular-pattern": "Rectangular Pattern",
  "circular-pattern": "Circular Pattern",
};

/** The inputs picked in the view, in the order they are asked for, with their labels. */
export const PICKS: Record<TransformTool, { field: PickField; label: string }[]> = {
  move: [
    { field: "objects", label: "Objects" },
    { field: "base", label: "From point" },
    { field: "target", label: "To point" },
  ],
  copy: [
    { field: "objects", label: "Objects" },
    { field: "base", label: "From point" },
    { field: "target", label: "To point" },
  ],
  scale: [
    { field: "objects", label: "Objects" },
    { field: "center", label: "Fixed point" },
  ],
  mirror: [
    { field: "objects", label: "Objects" },
    { field: "axis", label: "Mirror line" },
  ],
  "rectangular-pattern": [{ field: "objects", label: "Objects" }],
  "circular-pattern": [
    { field: "objects", label: "Objects" },
    { field: "center", label: "Center point" },
  ],
};

export const VALUES: Record<TransformTool, ValueField[]> = {
  move: [
    { id: "dx", label: "X distance", kind: "length" },
    { id: "dy", label: "Y distance", kind: "length" },
  ],
  copy: [
    { id: "dx", label: "X distance", kind: "length" },
    { id: "dy", label: "Y distance", kind: "length" },
  ],
  scale: [{ id: "factor", label: "Factor", kind: "factor" }],
  mirror: [],
  "rectangular-pattern": [
    { id: "countX", label: "Count", kind: "count" },
    { id: "spacingX", label: "Spacing", kind: "length" },
    { id: "countY", label: "Rows", kind: "count" },
    { id: "spacingY", label: "Row spacing", kind: "length" },
    { id: "direction", label: "Direction", kind: "angle" },
  ],
  "circular-pattern": [
    { id: "count", label: "Count", kind: "count" },
    { id: "angle", label: "Total angle", kind: "angle" },
  ],
};

export interface TransformDefaults {
  patternCount: number;
  patternCountY: number;
  patternSpacing: number;
  scaleFactor: number;
  mirrorSymmetry: boolean;
}

/** The input to ask for after `done`, or null when everything is there. */
export function nextPick(t: SketchTransform, after?: PickField): PickField | null {
  const order = PICKS[t.tool].map((p) => p.field);
  const start = after ? order.indexOf(after) + 1 : 0;
  for (const f of order.slice(start)) {
    if (f === "objects" ? t.objects.length === 0 : t[f] === null) return f;
  }
  return null;
}

/** A new command: the selection becomes its objects, and it asks for what is missing. */
export function startTransform(
  tool: TransformTool,
  sketchId: string,
  selection: EntityId[],
  d: TransformDefaults,
): SketchTransform {
  const values: Record<string, string> = {
    dx: "0",
    dy: "0",
    factor: String(d.scaleFactor),
    countX: String(Math.max(2, d.patternCount)),
    spacingX: String(d.patternSpacing),
    countY: String(Math.max(1, d.patternCountY)),
    spacingY: String(d.patternSpacing),
    direction: "0",
    count: String(Math.max(2, d.patternCount)),
    angle: "360",
  };
  const t: SketchTransform = {
    tool,
    sketchId,
    objects: [...selection],
    picking: null,
    center: null,
    base: null,
    target: null,
    axis: null,
    values,
    symmetry: d.mirrorSymmetry,
  };
  return { ...t, picking: nextPick(t) };
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * A click for the input being picked: an entity (objects, mirror line) or a position (points).
 * Objects are toggled and stay the input; a point or the line is set and the next missing input
 * is asked for. From and To fill the X and Y distances.
 */
export function pickInto(
  t: SketchTransform,
  pick: { entity?: EntityId; entityType?: string; point?: PickedPoint },
): SketchTransform {
  switch (t.picking) {
    case "objects": {
      if (!pick.entity) return t;
      const has = t.objects.includes(pick.entity);
      return { ...t, objects: has ? t.objects.filter((id) => id !== pick.entity) : [...t.objects, pick.entity] };
    }
    case "axis": {
      if (!pick.entity || pick.entityType !== "line") return t;
      const next = { ...t, axis: pick.entity, objects: t.objects.filter((id) => id !== pick.entity) };
      return { ...next, picking: nextPick(next, "axis") };
    }
    case "center":
    case "base":
    case "target": {
      if (!pick.point) return t;
      const next: SketchTransform = { ...t, [t.picking]: pick.point };
      if (next.base && next.target) {
        next.values = {
          ...next.values,
          dx: fmt(next.target.position.x - next.base.position.x),
          dy: fmt(next.target.position.y - next.base.position.y),
        };
      }
      return { ...next, picking: nextPick(next, t.picking) };
    }
    default:
      return t;
  }
}

export type TransformResult =
  | { ok: true; sketch: Sketch; preview: Sketch }
  | { ok: false; problem: string };

/** The sketch with the command applied, the sketch to preview, or what is still missing. */
export function transformResult(
  sketch: Sketch,
  t: SketchTransform,
  evaluate: (expression: string, kind: "length" | "angle" | "none") => number,
): TransformResult {
  const objects = t.objects.filter((id) => sketch.entities[id] && id !== t.axis);
  if (objects.length === 0) return { ok: false, problem: "Select the objects" };
  const num = (id: string, kind: "length" | "angle" | "none", name: string): number => {
    const v = evaluate(t.values[id] ?? "", kind);
    if (!Number.isFinite(v)) throw new Error(`${name} is not a number`);
    return v;
  };
  const count = (id: string, name: string, min: number): number => {
    const v = num(id, "none", name);
    if (!Number.isInteger(v) || v < min) throw new Error(`${name} must be a whole number of at least ${min}`);
    return v;
  };
  try {
    switch (t.tool) {
      case "move":
      case "copy": {
        const delta = { x: num("dx", "length", "X distance"), y: num("dy", "length", "Y distance") };
        if (Math.hypot(delta.x, delta.y) < 1e-9) return { ok: false, problem: "Pick From and To, or type a distance" };
        const copy = copyEntities(sketch, objects, delta).sketch;
        if (t.tool === "copy") return { ok: true, sketch: copy, preview: copy };
        // A move is previewed as where the objects go.
        return { ok: true, sketch: moveEntities(sketch, objects, delta), preview: copy };
      }
      case "scale": {
        if (!t.center) return { ok: false, problem: "Pick the fixed point" };
        const factor = num("factor", "none", "Factor");
        if (!(factor > 0)) return { ok: false, problem: "Factor must be greater than zero" };
        const result = scaleEntities(sketch, objects, t.center.position, factor);
        // Shown as a scaled copy, so that the original stays visible for comparison.
        const ghost = copyEntities(sketch, objects, { x: 0, y: 0 }).sketch;
        return { ok: true, sketch: result, preview: scaleCopy(ghost, sketch, t.center.position, factor) };
      }
      case "mirror": {
        if (!t.axis) return { ok: false, problem: "Pick the mirror line" };
        const result = mirrorEntities(sketch, objects, t.axis, { symmetryConstraints: t.symmetry }).sketch;
        return { ok: true, sketch: result, preview: result };
      }
      case "rectangular-pattern": {
        const countX = count("countX", "Count", 1);
        const countY = count("countY", "Rows", 1);
        if (countX * countY < 2) return { ok: false, problem: "Count or Rows must be at least 2" };
        const angle = (num("direction", "angle", "Direction") * Math.PI) / 180;
        const sx = num("spacingX", "length", "Spacing");
        const sy = num("spacingY", "length", "Row spacing");
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const result = rectangularPattern(sketch, objects, {
          dx: { x: dir.x * sx, y: dir.y * sx },
          countX,
          dy: { x: -dir.y * sy, y: dir.x * sy },
          countY,
        }).sketch;
        return { ok: true, sketch: result, preview: result };
      }
      case "circular-pattern": {
        if (!t.center) return { ok: false, problem: "Pick the center point" };
        const n = count("count", "Count", 2);
        const total = (num("angle", "angle", "Total angle") * Math.PI) / 180;
        if (Math.abs(total) < 1e-9) return { ok: false, problem: "Total angle must not be zero" };
        const result = circularPattern(sketch, objects, { center: t.center.position, count: n, totalAngle: total }).sketch;
        return { ok: true, sketch: result, preview: result };
      }
    }
  } catch (err) {
    return { ok: false, problem: err instanceof Error ? err.message : String(err) };
  }
}

/** Scale the entities that `ghost` added to `base` about `origin` (the preview of Scale). */
function scaleCopy(ghost: Sketch, base: Sketch, origin: Vec2, factor: number): Sketch {
  const fresh = Object.keys(ghost.entities).filter((id) => !base.entities[id]);
  return scaleEntities(ghost, fresh, origin, factor);
}
