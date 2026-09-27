import type { EntityId, Sketch, SketchEntity } from "@fabcad/sketch/src/model";

/**
 * Mapping between sketch geometry and the solver's flat variable vector.
 *
 * Variables are: `x, y` of every point, `radius` of every circle and `minorRadius` of every
 * ellipse. Arcs contribute no radius variable; their radius is `|start − center|`.
 */
export interface VariableLayout {
  /** Total number of variables. */
  count: number;
  /** Index of a point's `x`; its `y` lives at `index + 1`. */
  pointIndex: Map<EntityId, number>;
  /** Index of a circle's `radius` or an ellipse's `minorRadius`. */
  scalarIndex: Map<EntityId, number>;
}

export interface VariableSet {
  layout: VariableLayout;
  /** Current values taken from the sketch. */
  values: Float64Array;
}

export function buildVariables(sketch: Sketch): VariableSet {
  const pointIndex = new Map<EntityId, number>();
  const scalarIndex = new Map<EntityId, number>();
  const values: number[] = [];
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point") {
      pointIndex.set(e.id, values.length);
      values.push(e.x, e.y);
    } else if (e.type === "circle") {
      scalarIndex.set(e.id, values.length);
      values.push(e.radius);
    } else if (e.type === "ellipse") {
      scalarIndex.set(e.id, values.length);
      values.push(e.minorRadius);
    }
  }
  return {
    layout: { count: values.length, pointIndex, scalarIndex },
    values: Float64Array.from(values),
  };
}

/** Build a new sketch carrying the solved variable values. The input is never touched. */
export function applyVariables(sketch: Sketch, layout: VariableLayout, x: Float64Array): Sketch {
  const entities: Record<EntityId, SketchEntity> = {};
  for (const [id, e] of Object.entries(sketch.entities)) {
    if (e.type === "point") {
      const i = layout.pointIndex.get(e.id);
      entities[id] = i === undefined ? { ...e } : { ...e, x: x[i] as number, y: x[i + 1] as number };
    } else if (e.type === "circle") {
      const i = layout.scalarIndex.get(e.id);
      entities[id] = i === undefined ? { ...e } : { ...e, radius: x[i] as number };
    } else if (e.type === "ellipse") {
      const i = layout.scalarIndex.get(e.id);
      entities[id] = i === undefined ? { ...e } : { ...e, minorRadius: x[i] as number };
    } else if (e.type === "spline") {
      entities[id] = { ...e, points: e.points.slice() };
    } else {
      entities[id] = { ...e };
    }
  }
  return {
    ...sketch,
    entities,
    constraints: { ...sketch.constraints },
    dimensions: { ...sketch.dimensions },
    projections: sketch.projections.slice(),
  };
}

/** Indices of all variables that define an entity (its points and its own radius). */
export function entityVariables(
  sketch: Sketch,
  layout: VariableLayout,
  id: EntityId,
): number[] {
  const e = sketch.entities[id];
  if (!e) return [];
  const out: number[] = [];
  const addPoint = (pid: EntityId): void => {
    const i = layout.pointIndex.get(pid);
    if (i !== undefined) out.push(i, i + 1);
  };
  switch (e.type) {
    case "point":
      addPoint(e.id);
      break;
    case "line":
      addPoint(e.p1);
      addPoint(e.p2);
      break;
    case "circle":
      addPoint(e.center);
      break;
    case "arc":
      addPoint(e.center);
      addPoint(e.start);
      addPoint(e.end);
      break;
    case "ellipse":
      addPoint(e.center);
      addPoint(e.majorPoint);
      break;
    case "spline":
      for (const p of e.points) addPoint(p);
      break;
  }
  const s = layout.scalarIndex.get(id);
  if (s !== undefined) out.push(s);
  return out;
}
