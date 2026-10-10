import type { Vec2 } from "@fabcad/geometry";
import type {
  ArcEntity,
  CircleEntity,
  ConstraintType,
  CurveEntity,
  DimensionType,
  EllipseEntity,
  EntityId,
  LineEntity,
  PointEntity,
  Sketch,
  SketchConstraint,
  SketchDimension,
  SketchEntity,
  SketchText,
  SplineEntity,
} from "./model";

/**
 * Immutable editing primitives. Every function returns a new sketch and leaves its input
 * untouched, which is what makes undo / redo and live previews cheap.
 */

export class SketchBuilder {
  private sketch: Sketch;

  constructor(sketch: Sketch) {
    this.sketch = {
      ...sketch,
      entities: { ...sketch.entities },
      constraints: { ...sketch.constraints },
      dimensions: { ...sketch.dimensions },
    };
  }

  private allocate(prefix: string): string {
    const id = `${prefix}${this.sketch.nextId}`;
    this.sketch.nextId += 1;
    return id;
  }

  get current(): Sketch {
    return this.sketch;
  }

  /** Continue with a sketch that was changed outside the builder (it must derive from `current`). */
  replace(sketch: Sketch): void {
    this.sketch = {
      ...sketch,
      entities: { ...sketch.entities },
      constraints: { ...sketch.constraints },
      dimensions: { ...sketch.dimensions },
    };
  }

  build(): Sketch {
    return this.sketch;
  }

  point(x: number, y: number, construction = false): EntityId {
    const id = this.allocate("p");
    const p: PointEntity = { id, type: "point", x, y };
    if (construction) p.construction = true;
    this.sketch.entities[id] = p;
    return id;
  }

  /** Accept either an existing point id or coordinates for a new point. */
  resolvePoint(p: EntityId | Vec2): EntityId {
    return typeof p === "string" ? p : this.point(p.x, p.y);
  }

  line(a: EntityId | Vec2, b: EntityId | Vec2, construction = false): EntityId {
    const id = this.allocate("l");
    const e: LineEntity = { id, type: "line", p1: this.resolvePoint(a), p2: this.resolvePoint(b) };
    if (construction) e.construction = true;
    this.sketch.entities[id] = e;
    return id;
  }

  circle(center: EntityId | Vec2, radius: number, construction = false): EntityId {
    const id = this.allocate("c");
    const e: CircleEntity = { id, type: "circle", center: this.resolvePoint(center), radius };
    if (construction) e.construction = true;
    this.sketch.entities[id] = e;
    return id;
  }

  /** Counter-clockwise arc from `start` to `end`. */
  arc(
    center: EntityId | Vec2,
    start: EntityId | Vec2,
    end: EntityId | Vec2,
    construction = false,
  ): EntityId {
    const id = this.allocate("a");
    const e: ArcEntity = {
      id,
      type: "arc",
      center: this.resolvePoint(center),
      start: this.resolvePoint(start),
      end: this.resolvePoint(end),
    };
    if (construction) e.construction = true;
    this.sketch.entities[id] = e;
    return id;
  }

  ellipse(
    center: EntityId | Vec2,
    majorPoint: EntityId | Vec2,
    minorRadius: number,
    construction = false,
  ): EntityId {
    const id = this.allocate("e");
    const e: EllipseEntity = {
      id,
      type: "ellipse",
      center: this.resolvePoint(center),
      majorPoint: this.resolvePoint(majorPoint),
      minorRadius,
    };
    if (construction) e.construction = true;
    this.sketch.entities[id] = e;
    return id;
  }

  spline(
    kind: "fit" | "control",
    points: (EntityId | Vec2)[],
    closed = false,
    construction = false,
  ): EntityId {
    const id = this.allocate("s");
    const e: SplineEntity = {
      id,
      type: "spline",
      kind,
      points: points.map((p) => this.resolvePoint(p)),
      closed,
    };
    if (construction) e.construction = true;
    this.sketch.entities[id] = e;
    return id;
  }

  constrain(type: ConstraintType, ...refs: EntityId[]): string {
    const id = this.allocate("k");
    const c: SketchConstraint = { id, type, refs };
    this.sketch.constraints[id] = c;
    return id;
  }

  dimension(
    type: DimensionType,
    refs: EntityId[],
    expression: string,
    options: { driving?: boolean; labelPosition?: Vec2 } = {},
  ): string {
    const id = this.allocate("d");
    const d: SketchDimension = {
      id,
      type,
      refs,
      expression,
      driving: options.driving ?? true,
    };
    if (options.labelPosition) d.labelPosition = options.labelPosition;
    this.sketch.dimensions[id] = d;
    return id;
  }

  updateEntity<T extends SketchEntity>(id: EntityId, patch: Partial<T>): void {
    const e = this.sketch.entities[id];
    if (!e) return;
    this.sketch.entities[id] = { ...e, ...patch } as SketchEntity;
  }

  movePoint(id: EntityId, to: Vec2): void {
    const e = this.sketch.entities[id];
    if (e?.type === "point") this.sketch.entities[id] = { ...e, x: to.x, y: to.y };
  }

  removeConstraint(id: string): void {
    delete this.sketch.constraints[id];
  }

  removeDimension(id: string): void {
    delete this.sketch.dimensions[id];
  }

  /**
   * Delete entities together with everything that depends on them: curves using a deleted
   * point, constraints and dimensions referencing deleted entities, and points left orphaned by
   * the deleted curves.
   */
  remove(ids: Iterable<EntityId>): void {
    const doomed = new Set<EntityId>();
    const candidates = new Set<EntityId>();
    for (const id of ids) {
      const e = this.sketch.entities[id];
      if (!e) continue;
      doomed.add(id);
      if (e.type !== "point") for (const p of entityPointIds(e)) candidates.add(p);
    }
    // Curves that lose one of their points go too.
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of Object.values(this.sketch.entities)) {
        if (e.type === "point" || doomed.has(e.id)) continue;
        if (entityPointIds(e).some((p) => doomed.has(p))) {
          doomed.add(e.id);
          for (const p of entityPointIds(e)) candidates.add(p);
          grew = true;
        }
      }
    }
    // Points used only by deleted curves are removed as well.
    const texts = Object.values(this.sketch.texts ?? {});
    for (const p of candidates) {
      if (doomed.has(p)) continue;
      const stillUsed =
        Object.values(this.sketch.entities).some(
          (e) => e.type !== "point" && !doomed.has(e.id) && entityPointIds(e).includes(p),
        ) || texts.some((t) => t.origin === p);
      if (!stillUsed) doomed.add(p);
    }
    // A text goes with its origin; a text whose path is deleted returns to its origin.
    if (texts.some((t) => doomed.has(t.origin) || (t.path && doomed.has(t.path.entityId)))) {
      const kept: Record<string, SketchText> = {};
      for (const t of texts) {
        if (doomed.has(t.origin)) continue;
        if (t.path && doomed.has(t.path.entityId)) {
          const { path: _path, outline: _outline, ...rest } = t;
          kept[t.id] = rest;
        } else {
          kept[t.id] = t;
        }
      }
      this.sketch.texts = kept;
    }
    for (const id of doomed) delete this.sketch.entities[id];
    // Modes refer to anchor point IDs; never leave settings for deleted geometry behind.
    if (this.sketch.nodeModes) {
      const modes = { ...this.sketch.nodeModes };
      for (const id of doomed) delete modes[id];
      this.sketch.nodeModes = modes;
    }
    // A projection that lost one of its entities is released: what remains is plain geometry.
    if (this.sketch.projections.some((r) => r.entityIds.some((id) => doomed.has(id)))) {
      this.sketch.projections = this.sketch.projections.filter(
        (r) => !r.entityIds.some((id) => doomed.has(id)),
      );
    }
    for (const c of Object.values(this.sketch.constraints)) {
      if (c.refs.some((r) => doomed.has(r))) delete this.sketch.constraints[c.id];
    }
    for (const d of Object.values(this.sketch.dimensions)) {
      if (d.refs.some((r) => doomed.has(r))) delete this.sketch.dimensions[d.id];
    }
  }
}

export const editSketch = (sketch: Sketch, fn: (b: SketchBuilder) => void): Sketch => {
  const b = new SketchBuilder(sketch);
  fn(b);
  return b.build();
};

export function entityPointIds(e: SketchEntity): EntityId[] {
  switch (e.type) {
    case "point":
      return [e.id];
    case "line":
      return [e.p1, e.p2];
    case "circle":
      return [e.center];
    case "arc":
      return [e.center, e.start, e.end];
    case "ellipse":
      return [e.center, e.majorPoint];
    case "spline":
      return e.points.slice();
  }
}

export function getPoint(sketch: Sketch, id: EntityId): Vec2 {
  const e = sketch.entities[id];
  if (!e || e.type !== "point") throw new Error(`Sketch point not found: ${id}`);
  return { x: e.x, y: e.y };
}

export function isCurve(e: SketchEntity | undefined): e is CurveEntity {
  return !!e && e.type !== "point";
}

export function listEntities(sketch: Sketch): SketchEntity[] {
  return Object.values(sketch.entities);
}

export function listCurves(sketch: Sketch): CurveEntity[] {
  return Object.values(sketch.entities).filter(isCurve);
}

export function listPoints(sketch: Sketch): PointEntity[] {
  return Object.values(sketch.entities).filter((e): e is PointEntity => e.type === "point");
}
