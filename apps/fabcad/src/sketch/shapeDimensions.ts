import type { Vec2 } from "@fabcad/geometry";
import {
  type CreateResult,
  type DimensionType,
  type EntityId,
  type Sketch,
  getPoint,
  measureDimension,
} from "@fabcad/sketch";
import { formatDimensionValue } from "./constraintTools";

/**
 * The dimensions that size a shape just drawn with a Create tool: the length of a line, the
 * width and height of a rectangle, the diameter of a circle … They are offered in a window
 * beside the shape (`panels/ShapeDimensionsPanel.tsx`); a value typed there becomes a driving
 * dimension. Pure functions.
 */

export interface ShapeDimension {
  label: string;
  type: DimensionType;
  refs: EntityId[];
  /** The value as drawn, formatted like a dimension. */
  value: string;
  unit: "mm" | "deg";
}

/** Width for the more horizontal side, Height for the other. */
function sideLabel(sketch: Sketch, line: EntityId, fallback: string): string {
  const e = sketch.entities[line];
  if (e?.type !== "line") return fallback;
  const a = getPoint(sketch, e.p1);
  const b = getPoint(sketch, e.p2);
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "Width" : "Height";
}

export function shapeDimensions(sketch: Sketch, tool: string, result: CreateResult): ShapeDimension[] {
  const [e0, e1] = result.entities;
  const plan: { label: string; type: DimensionType; refs: EntityId[] }[] = [];
  switch (tool) {
    case "line":
    case "construction-line":
      if (e0) plan.push({ label: "Length", type: "distance", refs: [e0] });
      break;
    case "rectangle-2point":
    case "rectangle-center":
      if (e0 && e1) {
        const first = sideLabel(sketch, e0, "Width");
        plan.push({ label: first, type: "distance", refs: [e0] });
        plan.push({ label: first === "Width" ? "Height" : "Width", type: "distance", refs: [e1] });
      }
      break;
    case "rectangle-3point":
      if (e0 && e1) {
        plan.push({ label: "Length", type: "distance", refs: [e0] });
        plan.push({ label: "Height", type: "distance", refs: [e1] });
      }
      break;
    case "circle":
    case "circle-3point":
      if (e0) plan.push({ label: "Diameter", type: "diameter", refs: [e0] });
      break;
    case "arc-center":
    case "arc-3point":
      if (e0) plan.push({ label: "Radius", type: "radius", refs: [e0] });
      break;
    case "polygon-inscribed":
    case "polygon-circumscribed": {
      // The construction circle through the corners, or touching the sides.
      const circle = result.entities[result.entities.length - 1];
      if (circle) {
        plan.push({
          label: tool === "polygon-inscribed" ? "Diameter (corners)" : "Across flats",
          type: "diameter",
          refs: [circle],
        });
      }
      break;
    }
    case "slot": {
      const [c1, c2] = result.points;
      if (c1 && c2) plan.push({ label: "Length", type: "distance", refs: [c1, c2] });
      if (e1) plan.push({ label: "Width", type: "diameter", refs: [e1] });
      break;
    }
    default:
      break;
  }
  return plan.flatMap((d) => {
    if (d.refs.some((r) => !sketch.entities[r])) return [];
    const value = measureDimension(sketch, { id: "probe", type: d.type, refs: d.refs, expression: "0", driving: true });
    if (value === null) return [];
    return [{ ...d, value: formatDimensionValue(value), unit: d.type === "angle" ? "deg" : "mm" }];
  });
}

/** Where the window goes: beside the last point of the shape (sketch coordinates). */
export function shapeAnchor(sketch: Sketch, result: CreateResult): Vec2 | null {
  const last = result.points[result.points.length - 1];
  return last && sketch.entities[last] ? getPoint(sketch, last) : null;
}
