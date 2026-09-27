import {
  type ConstraintType,
  type DimensionType,
  type EntityId,
  type Sketch,
  type SketchEntity,
  getPoint,
} from "@fabcad/sketch";
import { type Vec2, cross2, dot2, norm2, sub2 } from "@fabcad/geometry";

export interface ConstraintToolDef {
  type: ConstraintType;
  label: string;
  /** Glyph drawn next to constrained geometry. */
  glyph: string;
  hint: string;
}

export const CONSTRAINT_TOOLS: ConstraintToolDef[] = [
  { type: "coincident", label: "Coincident", glyph: "◦", hint: "Pick a point, then a point or curve" },
  { type: "collinear", label: "Collinear", glyph: "⫽", hint: "Pick two lines" },
  { type: "concentric", label: "Concentric", glyph: "◎", hint: "Pick two circles or arcs" },
  { type: "midpoint", label: "Midpoint", glyph: "△", hint: "Pick a point and a line" },
  { type: "fix", label: "Fix / Unfix", glyph: "⚓", hint: "Pick the geometry to fix" },
  { type: "parallel", label: "Parallel", glyph: "∥", hint: "Pick two lines" },
  { type: "perpendicular", label: "Perpendicular", glyph: "⊥", hint: "Pick two lines" },
  { type: "horizontal", label: "Horizontal", glyph: "H", hint: "Pick a line or two points" },
  { type: "vertical", label: "Vertical", glyph: "V", hint: "Pick a line or two points" },
  { type: "tangent", label: "Tangent", glyph: "T", hint: "Pick a line or arc, then a circle or arc" },
  { type: "equal", label: "Equal", glyph: "=", hint: "Pick two lines, or two circles or arcs" },
  { type: "symmetry", label: "Symmetry", glyph: "⋈", hint: "Pick two points or lines, then the mirror line" },
];

export const constraintGlyph = (type: ConstraintType): string =>
  CONSTRAINT_TOOLS.find((t) => t.type === type)?.glyph ?? "?";

const isRound = (e: SketchEntity): boolean => e.type === "circle" || e.type === "arc";
const isPointOnCurveTarget = (e: SketchEntity): boolean => e.type === "line" || isRound(e);

export type PickState =
  /** The picks form a valid constraint. */
  | { state: "ready"; refs: EntityId[] }
  /** Valid so far, more picks are needed. */
  | { state: "incomplete" }
  | { state: "invalid" };

/**
 * Decide whether picked entities form a constraint of the given type, and in which order the
 * solver expects the references.
 */
export function constraintRefs(type: ConstraintType, picks: SketchEntity[]): PickState {
  const [a, b, c] = picks;
  const n = picks.length;
  if (n === 0 || !a) return { state: "incomplete" };
  const two = (ok: (x: SketchEntity, y: SketchEntity) => EntityId[] | null): PickState => {
    if (n === 1) return { state: "incomplete" };
    if (n > 2 || !b || a.id === b.id) return { state: "invalid" };
    const refs = ok(a, b);
    return refs ? { state: "ready", refs } : { state: "invalid" };
  };
  switch (type) {
    case "horizontal":
    case "vertical":
      if (a.type === "line") return n === 1 ? { state: "ready", refs: [a.id] } : { state: "invalid" };
      if (a.type !== "point") return { state: "invalid" };
      return two((x, y) => (y.type === "point" ? [x.id, y.id] : null));
    case "fix":
      return n === 1 ? { state: "ready", refs: [a.id] } : { state: "invalid" };
    case "coincident":
      if (a.type !== "point" && !isPointOnCurveTarget(a)) return { state: "invalid" };
      return two((x, y) => {
        if (x.type === "point" && y.type === "point") return [x.id, y.id];
        if (x.type === "point" && isPointOnCurveTarget(y)) return [x.id, y.id];
        if (y.type === "point" && isPointOnCurveTarget(x)) return [y.id, x.id];
        return null;
      });
    case "parallel":
    case "perpendicular":
    case "collinear":
      if (a.type !== "line") return { state: "invalid" };
      return two((x, y) => (y.type === "line" ? [x.id, y.id] : null));
    case "equal":
      if (a.type !== "line" && !isRound(a)) return { state: "invalid" };
      return two((x, y) => {
        if (x.type === "line" && y.type === "line") return [x.id, y.id];
        if (isRound(x) && isRound(y)) return [x.id, y.id];
        return null;
      });
    case "concentric":
      if (!isRound(a)) return { state: "invalid" };
      return two((x, y) => (isRound(y) ? [x.id, y.id] : null));
    case "tangent":
      if (a.type !== "line" && !isRound(a)) return { state: "invalid" };
      return two((x, y) => {
        if (x.type === "line" && isRound(y)) return [x.id, y.id];
        if (y.type === "line" && isRound(x)) return [y.id, x.id];
        if (isRound(x) && isRound(y)) return [x.id, y.id];
        return null;
      });
    case "midpoint":
      if (a.type !== "point" && a.type !== "line") return { state: "invalid" };
      return two((x, y) => {
        if (x.type === "point" && y.type === "line") return [x.id, y.id];
        if (y.type === "point" && x.type === "line") return [y.id, x.id];
        return null;
      });
    case "symmetry": {
      if (a.type !== "point" && a.type !== "line") return { state: "invalid" };
      if (n === 1) return { state: "incomplete" };
      if (!b || b.type !== a.type || b.id === a.id) return { state: "invalid" };
      if (n === 2) return { state: "incomplete" };
      if (n > 3 || !c || c.type !== "line" || c.id === a.id || c.id === b.id) {
        return { state: "invalid" };
      }
      return { state: "ready", refs: [a.id, b.id, c.id] };
    }
  }
}

export interface DimensionPlan {
  type: DimensionType;
  refs: EntityId[];
}

const lineDirection = (sketch: Sketch, e: Extract<SketchEntity, { type: "line" }>): Vec2 =>
  norm2(sub2(getPoint(sketch, e.p2), getPoint(sketch, e.p1)));

/** Choose aligned / horizontal / vertical from where the label is placed, like Fusion does. */
function distanceKind(a: Vec2, b: Vec2, label: Vec2): DimensionType {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx < 1e-6 || dy < 1e-6) return "distance";
  const insideX = label.x >= minX && label.x <= maxX;
  const insideY = label.y >= minY && label.y <= maxY;
  if (insideX && !insideY) return "hdistance";
  if (insideY && !insideX) return "vdistance";
  return "distance";
}

/** Work out which dimension the picked entities and the label position describe. */
export function planDimension(
  sketch: Sketch,
  picks: SketchEntity[],
  label: Vec2,
): DimensionPlan | null {
  const [a, b] = picks;
  if (!a) return null;
  if (picks.length === 1) {
    if (a.type === "circle") return { type: "diameter", refs: [a.id] };
    if (a.type === "arc") return { type: "radius", refs: [a.id] };
    if (a.type === "line") {
      const kind = distanceKind(getPoint(sketch, a.p1), getPoint(sketch, a.p2), label);
      return { type: kind, refs: [a.id] };
    }
    return null;
  }
  if (!b || a.id === b.id) return null;
  if (a.type === "point" && b.type === "point") {
    return { type: distanceKind(a, b, label), refs: [a.id, b.id] };
  }
  if (a.type === "point" && b.type === "line") return { type: "distance", refs: [a.id, b.id] };
  if (a.type === "line" && b.type === "point") return { type: "distance", refs: [b.id, a.id] };
  if (a.type === "line" && b.type === "line") {
    const da = lineDirection(sketch, a);
    const db = lineDirection(sketch, b);
    if (Math.abs(cross2(da, db)) < 1e-6) return { type: "distance", refs: [a.id, b.id] };
    // Angles are measured counter-clockwise from the first line; keep the value below 180°.
    const ccw = Math.atan2(cross2(da, db), dot2(da, db));
    return { type: "angle", refs: ccw >= 0 ? [a.id, b.id] : [b.id, a.id] };
  }
  return null;
}

/** Number shown in a freshly created dimension: short but exact enough to round-trip. */
export function formatDimensionValue(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}
