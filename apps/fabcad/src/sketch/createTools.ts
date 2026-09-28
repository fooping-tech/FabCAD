import { type Vec2, dist2, sub2, cross2, norm2 } from "@fabcad/geometry";
import {
  type CreateResult,
  type EntityId,
  type PointInput,
  type Sketch,
  type SketchBuilder,
  type SnapResult,
  SKETCH_CREATE_TOOLS,
  createArc3Point,
  createArcCenter,
  createCircle,
  createCircle3Point,
  createEllipse,
  createLine,
  createPoint,
  createPolygon,
  createPolyline,
  createRectangle2Point,
  createRectangle3Point,
  createRectangleCenter,
  createSlot,
  createSpline,
  editSketch,
  getPoint,
} from "@fabcad/sketch";
import type { ToolOptions } from "../app/appState";

/**
 * Sketch Create tools as data: how many picks each tool needs, what it asks the user at every
 * step, and how picks turn into geometry. The viewport drives all of them through one generic
 * pick → preview → commit loop, so adding a tool means adding one entry here.
 */

export interface ToolPick {
  /** Snapped position in sketch coordinates. */
  position: Vec2;
  snap: SnapResult;
  /** Direction inferred from the previous pick while drawing lines. */
  inferred?: "horizontal" | "vertical";
  /** Points the position was lined up with: the one above or below it, the one beside it. */
  aligned?: { vertical?: Vec2; horizontal?: Vec2 };
}

export interface CreateToolDef {
  id: string;
  label: string;
  description: string;
  /** Number of picks, or "many" for tools finished with Enter / double-click. */
  clicks: number | "many";
  minPicks: number;
  /** Status bar hint for each step (the last one repeats). */
  hints: string[];
  /** Indices of picks that become real sketch points (the others only supply a position). */
  pointPicks: "all" | number[];
  /** After a commit, start the next shape from the last point (line chains). */
  chain?: boolean;
  /** Infer horizontal / vertical constraints between consecutive picks. */
  inferAxis?: boolean;
  build(b: SketchBuilder, picks: PointInput[], positions: Vec2[], options: ToolOptions): CreateResult;
}

const distanceToLine = (p: Vec2, a: Vec2, b: Vec2): number => {
  const d = sub2(b, a);
  const l = Math.hypot(d.x, d.y);
  return l < 1e-12 ? dist2(p, a) : Math.abs(cross2(d, sub2(p, a))) / l;
};

const descriptions = new Map(SKETCH_CREATE_TOOLS.map((t) => [t.id, t]));
const describe = (id: string): { label: string; description: string } => {
  const d = descriptions.get(id);
  return { label: d?.label ?? id, description: d?.description ?? "" };
};

const def = (
  id: string,
  spec: Omit<CreateToolDef, "id" | "label" | "description" | "minPicks"> & { minPicks?: number },
): CreateToolDef => ({
  id,
  ...describe(id),
  minPicks: spec.minPicks ?? (typeof spec.clicks === "number" ? spec.clicks : 2),
  ...spec,
});

export const CREATE_TOOLS: CreateToolDef[] = [
  def("line", {
    clicks: 2,
    hints: ["Pick the start point", "Pick the end point"],
    pointPicks: "all",
    chain: true,
    inferAxis: true,
    build: (b, p, _pos, o) => createLine(b, p[0]!, p[1]!, o.construction),
  }),
  def("polyline", {
    clicks: "many",
    hints: ["Pick the first point", "Pick the next point — Enter or double-click to finish"],
    pointPicks: "all",
    inferAxis: true,
    build: (b, p, _pos, o) => {
      // Picking the first point again closes the polyline.
      const closed = p.length > 2 && p[p.length - 1] === p[0];
      return createPolyline(b, closed ? p.slice(0, -1) : p, closed, o.construction);
    },
  }),
  def("construction-line", {
    clicks: 2,
    hints: ["Pick the start point", "Pick the end point"],
    pointPicks: "all",
    inferAxis: true,
    build: (b, p) => createLine(b, p[0]!, p[1]!, true),
  }),
  def("rectangle-2point", {
    clicks: 2,
    hints: ["Pick the first corner", "Pick the opposite corner"],
    pointPicks: "all",
    build: (b, p, _pos, o) => createRectangle2Point(b, p[0]!, p[1]!, o.construction),
  }),
  def("rectangle-3point", {
    clicks: 3,
    hints: ["Pick the first corner", "Pick the end of the first edge", "Pick the height"],
    pointPicks: [0, 1],
    build: (b, p, pos, o) => createRectangle3Point(b, p[0]!, p[1]!, pos[2]!, o.construction),
  }),
  def("rectangle-center", {
    clicks: 2,
    hints: ["Pick the center", "Pick a corner"],
    pointPicks: "all",
    build: (b, p, _pos, o) => createRectangleCenter(b, p[0]!, p[1]!, o.construction),
  }),
  def("circle", {
    clicks: 2,
    hints: ["Pick the center", "Pick a point on the circle"],
    pointPicks: [0],
    build: (b, p, pos, o) => createCircle(b, p[0]!, dist2(pos[0]!, pos[1]!), o.construction),
  }),
  def("circle-3point", {
    clicks: 3,
    hints: ["Pick the first point", "Pick the second point", "Pick the third point"],
    pointPicks: "all",
    build: (b, p, _pos, o) => createCircle3Point(b, p[0]!, p[1]!, p[2]!, o.construction),
  }),
  def("arc-center", {
    clicks: 3,
    hints: ["Pick the center", "Pick the start point", "Pick the end point"],
    pointPicks: "all",
    build: (b, p, pos, o) => {
      // The arc follows the side on which the end point was picked.
      const ccw = cross2(sub2(pos[1]!, pos[0]!), sub2(pos[2]!, pos[0]!)) >= 0;
      return createArcCenter(b, p[0]!, p[1]!, p[2]!, ccw, o.construction);
    },
  }),
  def("arc-3point", {
    clicks: 3,
    hints: ["Pick the start point", "Pick the end point", "Pick a point on the arc"],
    pointPicks: [0, 1],
    build: (b, p, pos, o) => createArc3Point(b, p[0]!, p[1]!, pos[2]!, o.construction),
  }),
  def("ellipse", {
    clicks: 3,
    hints: ["Pick the center", "Pick the end of the major axis", "Pick the minor radius"],
    pointPicks: [0, 1],
    build: (b, p, pos, o) =>
      createEllipse(b, p[0]!, p[1]!, distanceToLine(pos[2]!, pos[0]!, pos[1]!), o.construction),
  }),
  def("polygon-inscribed", {
    clicks: 2,
    hints: ["Pick the center", "Pick a vertex"],
    pointPicks: "all",
    build: (b, p, _pos, o) =>
      createPolygon(b, p[0]!, p[1]!, o.polygonSides, "inscribed", o.construction),
  }),
  def("polygon-circumscribed", {
    clicks: 2,
    hints: ["Pick the center", "Pick the middle of an edge"],
    pointPicks: [0],
    build: (b, p, pos, o) =>
      createPolygon(b, p[0]!, pos[1]!, o.polygonSides, "circumscribed", o.construction),
  }),
  def("slot", {
    clicks: 3,
    hints: ["Pick the first center", "Pick the second center", "Pick the width"],
    pointPicks: [0, 1],
    build: (b, p, pos, o) =>
      createSlot(b, p[0]!, p[1]!, 2 * distanceToLine(pos[2]!, pos[0]!, pos[1]!), o.construction),
  }),
  def("point", {
    clicks: 1,
    hints: ["Pick the position"],
    pointPicks: "all",
    build: (b, p, _pos, o) => createPoint(b, p[0]!, o.construction),
  }),
  def("spline-fit", {
    clicks: "many",
    hints: ["Pick the first point", "Pick the next point — Enter or double-click to finish"],
    pointPicks: "all",
    build: (b, p, _pos, o) => {
      const closed = p.length > 2 && p[p.length - 1] === p[0];
      return createSpline(b, "fit", closed ? p.slice(0, -1) : p, closed, o.construction);
    },
  }),
  def("spline-control", {
    clicks: "many",
    minPicks: 3,
    hints: ["Pick the first control point", "Pick the next control point — Enter to finish"],
    pointPicks: "all",
    build: (b, p, _pos, o) => createSpline(b, "control", p, false, o.construction),
  }),
];

export const createTool = (id: string): CreateToolDef | undefined =>
  CREATE_TOOLS.find((t) => t.id === id);

export interface BuiltShape {
  sketch: Sketch;
  result: CreateResult;
}

/**
 * Turn picks into geometry. Picks that snapped onto an existing point reuse it, so shapes share
 * points; picks that snapped onto a curve or a midpoint get the matching constraint.
 */
export function buildFromPicks(
  sketch: Sketch,
  tool: CreateToolDef,
  picks: ToolPick[],
  options: ToolOptions,
): BuiltShape | null {
  if (picks.length < tool.minPicks) return null;
  const positions = picks.map((p) => p.position);
  for (let i = 1; i < positions.length; i++) {
    if (tool.clicks !== "many" && dist2(positions[i]!, positions[i - 1]!) < 1e-9) return null;
  }
  try {
    let result: CreateResult | null = null;
    const next = editSketch(sketch, (b) => {
      const made = new Map<number, EntityId>();
      const inputs: PointInput[] = picks.map((pick, i) => {
        const real = tool.pointPicks === "all" || tool.pointPicks.includes(i);
        if (!real) return pick.position;
        if (pick.snap.pointId && b.current.entities[pick.snap.pointId]) return pick.snap.pointId;
        // Closing a polyline: the last pick coincides with the first one.
        for (const [j, id] of made) {
          if (dist2(positions[j]!, pick.position) < 1e-9) return id;
        }
        const id = b.point(pick.position.x, pick.position.y);
        made.set(i, id);
        return id;
      });
      result = tool.build(b, inputs, positions, options);
      for (const [i, id] of made) {
        const pick = picks[i]!;
        if (!b.current.entities[id]) continue;
        if (pick.snap.kind === "curve" && pick.snap.curveId) {
          const curve = b.current.entities[pick.snap.curveId];
          if (curve && (curve.type === "line" || curve.type === "circle" || curve.type === "arc")) {
            b.constrain("coincident", id, curve.id);
          }
        } else if (pick.snap.kind === "midpoint" && pick.snap.curveId) {
          b.constrain("midpoint", id, pick.snap.curveId);
        }
      }
      if (tool.inferAxis) {
        const lines = result.entities.filter((e) => b.current.entities[e]?.type === "line");
        lines.forEach((lineId, i) => {
          const inferred = picks[i + 1]?.inferred;
          if (inferred) b.constrain(inferred, lineId);
        });
      }
    });
    return result ? { sketch: next, result } : null;
  } catch {
    return null;
  }
}

/**
 * While drawing lines, snap the cursor onto the horizontal or vertical through the previous
 * pick when it is within a few pixels of it.
 */
export function inferAxis(
  previous: Vec2,
  position: Vec2,
  tolerance: number,
): { position: Vec2; inferred?: "horizontal" | "vertical" } {
  const dx = Math.abs(position.x - previous.x);
  const dy = Math.abs(position.y - previous.y);
  if (dy <= tolerance && dx > tolerance * 3) {
    return { position: { x: position.x, y: previous.y }, inferred: "horizontal" };
  }
  if (dx <= tolerance && dy > tolerance * 3) {
    return { position: { x: previous.x, y: position.y }, inferred: "vertical" };
  }
  return { position };
}

/** Last real point of a committed shape, used to chain the line tool. */
export function lastPointOf(sketch: Sketch, result: CreateResult): EntityId | null {
  const last = result.entities[result.entities.length - 1];
  const e = last ? sketch.entities[last] : undefined;
  if (e?.type === "line") return e.p2;
  return null;
}

export const pointPosition = (sketch: Sketch, id: EntityId): Vec2 => getPoint(sketch, id);

export const unit = (v: Vec2): Vec2 => norm2(v);
