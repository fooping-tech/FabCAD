import type {
  EntityId,
  Sketch,
  SketchConstraint,
  SketchDimension,
} from "@fabcad/sketch/src/model";
import { type VariableLayout, entityVariables } from "./variables";

/**
 * The constraint graph: every constraint, driving dimension and implicit rule (arc radius,
 * projected geometry) is turned into one or more scalar residual equations `f(x) = 0` over the
 * variable vector.
 *
 * All residuals are expressed in millimetres so that they are comparable: distances are used
 * as-is, angular residuals are multiplied by a characteristic length (the size of the geometry
 * involved when the equations are built), which turns them into an arc length.
 *
 * Choices that depend on the geometry (inner / outer tangency, the side a dimension is
 * measured on, the orientation of a horizontal distance, ...) are taken once from the starting
 * geometry and then frozen, so that solving never flips the sketch.
 */
export interface Equation {
  /** Id of the constraint / dimension / projection that produced the equation. */
  source: string;
  /** Implicit equations (arc radius, projected geometry) are never reported to the user. */
  implicit: boolean;
  /** Indices of the variables the residual depends on. */
  vars: number[];
  /**
   * Set for angular residuals, which are only defined modulo this period. Differences of two
   * evaluations must be wrapped into `(-period / 2, period / 2]`.
   */
  period?: number;
  /**
   * Largest residual that is handed to a single solver step. Large rotations are taken in
   * several small steps because a linearized rotation stretches the geometry.
   */
  stepLimit?: number;
  /**
   * Hold equations `x[i] = constant` (fix, projections). The solver satisfies them exactly by
   * never moving the variable; they only take part in the rank analysis.
   */
  hold?: boolean;
  evaluate(x: Float64Array): number;
}

export interface EquationSystem {
  equations: Equation[];
  /** Variables held by `fix` constraints or projections; drags must not move them. */
  fixed: Set<number>;
}

type Residual = (x: Float64Array) => number;

interface LineRef {
  a: number;
  b: number;
  p1: EntityId;
  p2: EntityId;
}

/** A circle or an arc: something with a center and a radius. */
interface RoundRef {
  id: EntityId;
  c: number;
  /** Variables the radius depends on: one scalar for circles, center and start for arcs. */
  radiusVars: number[];
  radius: Residual;
}

const TINY = 1e-12;
/** Largest rotation taken in one solver step, in radians. */
const MAX_ROTATION = Math.PI / 18;
const TWO_PI = 2 * Math.PI;

const at = (x: Float64Array, i: number): number => x[i] as number;

/** Wrap into `(-period / 2, period / 2]`. */
export const wrapPeriodic = (v: number, period: number): number =>
  v - period * Math.round(v / period);

const safe = (v: number): number => (v > TINY ? v : TINY);

/** `+1` or `-1`; zero counts as positive. */
const signOf = (v: number): number => (v < 0 ? -1 : 1);

export function buildEquations(
  sketch: Sketch,
  layout: VariableLayout,
  x0: Float64Array,
  dimensionValues: Record<string, number>,
): EquationSystem {
  return new EquationBuilder(sketch, layout, x0).build(dimensionValues);
}

class EquationBuilder {
  private readonly equations: Equation[] = [];
  private readonly fixed = new Set<number>();
  private source = "";
  private implicit = false;
  /** Union-find parent over points merged by point–point coincident constraints. */
  private readonly parent = new Map<EntityId, EntityId>();
  /** Per circle / arc: points known to lie on it, keyed by coincidence class. */
  private readonly onCurve = new Map<EntityId, Map<EntityId, EntityId>>();

  constructor(
    private readonly sketch: Sketch,
    private readonly layout: VariableLayout,
    private readonly x0: Float64Array,
  ) {}

  build(dimensionValues: Record<string, number>): EquationSystem {
    this.indexCoincidences();

    // An arc has one radius: |end − center| = |start − center|.
    this.implicit = true;
    for (const e of Object.values(this.sketch.entities)) {
      if (e.type !== "arc") continue;
      const c = this.point(e.center);
      const s = this.point(e.start);
      const en = this.point(e.end);
      if (c === undefined || s === undefined || en === undefined) continue;
      this.source = `arc:${e.id}`;
      this.push([c, s, en], (x) => dist(x, en, c) - dist(x, s, c));
    }
    // Projected geometry is recomputed upstream and held in place here.
    for (const proj of this.sketch.projections) {
      this.source = proj.id;
      for (const id of proj.entityIds) this.hold(id);
    }

    this.implicit = false;
    for (const c of Object.values(this.sketch.constraints)) {
      this.source = c.id;
      this.constraint(c);
    }
    for (const d of Object.values(this.sketch.dimensions)) {
      if (!d.driving) continue;
      const value = dimensionValues[d.id];
      if (value === undefined || !Number.isFinite(value)) continue;
      this.source = d.id;
      this.dimension(d, value);
    }
    return { equations: this.equations, fixed: this.fixed };
  }

  // ---------------------------------------------------------------- lookup

  private point(id: EntityId | undefined): number | undefined {
    return id === undefined ? undefined : this.layout.pointIndex.get(id);
  }

  private line(id: EntityId | undefined): LineRef | undefined {
    const e = id === undefined ? undefined : this.sketch.entities[id];
    if (e?.type !== "line") return undefined;
    const a = this.point(e.p1);
    const b = this.point(e.p2);
    if (a === undefined || b === undefined) return undefined;
    return { a, b, p1: e.p1, p2: e.p2 };
  }

  private round(id: EntityId | undefined): RoundRef | undefined {
    const e = id === undefined ? undefined : this.sketch.entities[id];
    if (e?.type === "circle") {
      const c = this.point(e.center);
      const r = this.layout.scalarIndex.get(e.id);
      if (c === undefined || r === undefined) return undefined;
      return { id: e.id, c, radiusVars: [r], radius: (x) => at(x, r) };
    }
    if (e?.type === "arc") {
      const c = this.point(e.center);
      const s = this.point(e.start);
      if (c === undefined || s === undefined) return undefined;
      return { id: e.id, c, radiusVars: [c, c + 1, s, s + 1], radius: (x) => dist(x, s, c) };
    }
    return undefined;
  }

  private root(id: EntityId): EntityId {
    let r = id;
    for (let p = this.parent.get(r); p !== undefined && p !== r; p = this.parent.get(r)) r = p;
    return r;
  }

  /**
   * Record which points are known to lie on which circle / arc (arc end points and
   * point-on-curve constraints). Tangency through such a point needs a different equation.
   */
  private indexCoincidences(): void {
    const constraints = Object.values(this.sketch.constraints).filter(
      (c) => c.type === "coincident",
    );
    for (const c of constraints) {
      const [a, b] = c.refs;
      if (a === undefined || b === undefined) continue;
      if (this.point(a) === undefined || this.point(b) === undefined) continue;
      const ra = this.root(a);
      const rb = this.root(b);
      if (ra !== rb) this.parent.set(ra, rb);
    }
    const note = (curve: EntityId, pointId: EntityId): void => {
      let set = this.onCurve.get(curve);
      if (!set) {
        set = new Map();
        this.onCurve.set(curve, set);
      }
      set.set(this.root(pointId), pointId);
    };
    for (const e of Object.values(this.sketch.entities)) {
      if (e.type !== "arc") continue;
      note(e.id, e.start);
      note(e.id, e.end);
    }
    for (const c of constraints) {
      const [a, b] = c.refs;
      if (a === undefined || b === undefined) continue;
      if (this.point(a) !== undefined && this.round(b)) note(b, a);
    }
  }

  // ---------------------------------------------------------------- emit

  private push(pointsOrVars: number[], evaluate: Residual, extra: number[] = []): Equation {
    const vars = new Set<number>();
    for (const p of pointsOrVars) {
      vars.add(p);
      vars.add(p + 1);
    }
    for (const v of extra) vars.add(v);
    const eq: Equation = {
      source: this.source,
      implicit: this.implicit,
      vars: [...vars].sort((a, b) => a - b),
      evaluate,
    };
    this.equations.push(eq);
    return eq;
  }

  /** Angular residual `wrap(angle − target) · scale`, in millimetres of arc length. */
  private pushAngle(
    points: number[],
    angle: Residual,
    target: number,
    period: number,
    scale: number,
  ): void {
    const eq = this.push(points, (x) => wrapPeriodic(angle(x) - target, period) * scale);
    eq.period = period * scale;
    eq.stepLimit = MAX_ROTATION * scale;
  }

  /** Hold every variable of an entity at its starting value. */
  private hold(id: EntityId): void {
    for (const v of entityVariables(this.sketch, this.layout, id)) {
      if (this.fixed.has(v)) continue;
      this.fixed.add(v);
      const value = at(this.x0, v);
      this.push([], (x) => at(x, v) - value, [v]).hold = true;
    }
  }

  private coincidentPoints(a: number, b: number): void {
    this.push([a, b], (x) => at(x, b) - at(x, a));
    this.push([a, b], (x) => at(x, b + 1) - at(x, a + 1));
  }

  /** Mirror images: the midpoint lies on the axis and the connection is normal to it. */
  private symmetricPoints(a: number, b: number, axis: LineRef): void {
    this.push([a, b, axis.a, axis.b], (x) =>
      signedDistance(
        x,
        axis,
        (at(x, a) + at(x, b)) / 2,
        (at(x, a + 1) + at(x, b + 1)) / 2,
      ),
    );
    this.push([a, b, axis.a, axis.b], (x) => {
      const dx = at(x, axis.b) - at(x, axis.a);
      const dy = at(x, axis.b + 1) - at(x, axis.a + 1);
      return (
        ((at(x, b) - at(x, a)) * dx + (at(x, b + 1) - at(x, a + 1)) * dy) /
        safe(Math.hypot(dx, dy))
      );
    });
  }

  /** Length scale that converts an angle between two lines into a distance. */
  private lineScale(l1: LineRef, l2: LineRef): number {
    const s = (dist(this.x0, l1.a, l1.b) + dist(this.x0, l2.a, l2.b)) / 2;
    return s > 1 ? s : 1;
  }

  // ---------------------------------------------------------------- constraints

  private constraint(c: SketchConstraint): void {
    const [r0, r1, r2] = c.refs;
    const x0 = this.x0;
    switch (c.type) {
      case "coincident": {
        const p = this.point(r0);
        if (p === undefined) return;
        const q = this.point(r1);
        if (q !== undefined) {
          this.coincidentPoints(p, q);
          return;
        }
        const l = this.line(r1);
        if (l) {
          this.push([p, l.a, l.b], (x) => signedDistance(x, l, at(x, p), at(x, p + 1)));
          return;
        }
        const r = this.round(r1);
        if (r) this.push([p, r.c], (x) => dist(x, p, r.c) - r.radius(x), r.radiusVars);
        return;
      }
      case "horizontal":
      case "vertical": {
        const l = this.line(r0);
        const a = l ? l.a : this.point(r0);
        const b = l ? l.b : this.point(r1);
        if (a === undefined || b === undefined) return;
        const o = c.type === "horizontal" ? 1 : 0;
        this.push([a, b], (x) => at(x, b + o) - at(x, a + o));
        return;
      }
      case "parallel":
      case "perpendicular": {
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        if (!l1 || !l2) return;
        // Lines are undirected here, so the angle between them only matters modulo π.
        this.pushAngle(
          [l1.a, l1.b, l2.a, l2.b],
          (x) => angleBetween(x, l1, l2),
          c.type === "parallel" ? 0 : Math.PI / 2,
          Math.PI,
          this.lineScale(l1, l2),
        );
        return;
      }
      case "tangent": {
        const l = this.line(r0) ?? this.line(r1);
        if (l) {
          const r = this.round(this.line(r0) ? r1 : r0);
          if (r) this.tangentLine(l, r);
          return;
        }
        const a = this.round(r0);
        const b = this.round(r1);
        if (a && b) this.tangentRounds(a, b);
        return;
      }
      case "equal": {
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        if (l1 && l2) {
          this.push([l1.a, l1.b, l2.a, l2.b], (x) => dist(x, l1.a, l1.b) - dist(x, l2.a, l2.b));
          return;
        }
        const a = this.round(r0);
        const b = this.round(r1);
        if (a && b) {
          this.push([], (x) => a.radius(x) - b.radius(x), [...a.radiusVars, ...b.radiusVars]);
        }
        return;
      }
      case "concentric": {
        const a = this.round(r0);
        const b = this.round(r1);
        if (a && b && a.c !== b.c) this.coincidentPoints(a.c, b.c);
        return;
      }
      case "collinear": {
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        if (!l1 || !l2) return;
        for (const p of [l2.a, l2.b]) {
          this.push([l1.a, l1.b, p], (x) => signedDistance(x, l1, at(x, p), at(x, p + 1)));
        }
        return;
      }
      case "midpoint": {
        const p = this.point(r0);
        const l = this.line(r1);
        if (p === undefined || !l) return;
        for (const o of [0, 1]) {
          this.push(
            [p, l.a, l.b],
            (x) => at(x, p + o) - (at(x, l.a + o) + at(x, l.b + o)) / 2,
          );
        }
        return;
      }
      case "fix": {
        for (const ref of c.refs) this.hold(ref);
        return;
      }
      case "symmetry": {
        const axis = this.line(r2);
        if (!axis) return;
        const p = this.point(r0);
        const q = this.point(r1);
        if (p !== undefined && q !== undefined) {
          this.symmetricPoints(p, q, axis);
          return;
        }
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        if (!l1 || !l2) return;
        // Pair up the end points the way the current geometry suggests.
        const m = mirror(x0, axis, at(x0, l1.a), at(x0, l1.a + 1));
        const straight = Math.hypot(m.x - at(x0, l2.a), m.y - at(x0, l2.a + 1));
        const crossed = Math.hypot(m.x - at(x0, l2.b), m.y - at(x0, l2.b + 1));
        const swap = crossed < straight;
        this.symmetricPoints(l1.a, swap ? l2.b : l2.a, axis);
        this.symmetricPoints(l1.b, swap ? l2.a : l2.b, axis);
        return;
      }
    }
  }

  /** First point of `candidates` that is known to lie on the circle / arc. */
  private sharedPoint(candidates: EntityId[], r: RoundRef): number | undefined {
    const known = this.onCurve.get(r.id);
    if (!known) return undefined;
    for (const id of candidates) {
      if (known.has(this.root(id))) return this.point(id);
    }
    return undefined;
  }

  private tangentLine(l: LineRef, r: RoundRef): void {
    const shared = this.sharedPoint([l.p1, l.p2], r);
    if (shared !== undefined && shared !== r.c) {
      // The line passes through a point P of the curve (e.g. a fillet): tangency means the
      // radius to P is normal to the line. The distance formulation below would have a
      // vanishing gradient at the solution in this configuration.
      this.push([l.a, l.b, shared, r.c], (x) => {
        const dx = at(x, l.b) - at(x, l.a);
        const dy = at(x, l.b + 1) - at(x, l.a + 1);
        return (
          ((at(x, shared) - at(x, r.c)) * dx + (at(x, shared + 1) - at(x, r.c + 1)) * dy) /
          safe(Math.hypot(dx, dy))
        );
      });
      return;
    }
    // Distance from the center to the line equals the radius; the center stays on its side.
    const side = signOf(signedDistance(this.x0, l, at(this.x0, r.c), at(this.x0, r.c + 1)));
    this.push(
      [l.a, l.b, r.c],
      (x) => side * signedDistance(x, l, at(x, r.c), at(x, r.c + 1)) - r.radius(x),
      r.radiusVars,
    );
  }

  private tangentRounds(a: RoundRef, b: RoundRef): void {
    const x0 = this.x0;
    const ra = a.radius(x0);
    const rb = b.radius(x0);
    const known = this.onCurve.get(a.id);
    let shared: number | undefined;
    if (known) shared = this.sharedPoint([...known.values()], b);
    if (shared !== undefined && shared !== a.c && shared !== b.c) {
      // Both curves pass through P: they are tangent when P and the two centers are
      // collinear; centers on opposite sides of P for outer tangency, same side for inner.
      const p = shared;
      const angle: Residual = (x) => {
        const ux = at(x, p) - at(x, a.c);
        const uy = at(x, p + 1) - at(x, a.c + 1);
        const vx = at(x, p) - at(x, b.c);
        const vy = at(x, p + 1) - at(x, b.c + 1);
        return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      };
      const target = Math.abs(angle(x0)) > Math.PI / 2 ? Math.PI : 0;
      const scale = Math.max((ra + rb) / 2, 1);
      this.pushAngle([p, a.c, b.c], angle, target, TWO_PI, scale);
      return;
    }
    const d = dist(x0, a.c, b.c);
    const outer = Math.abs(d - (ra + rb));
    const inner = Math.abs(d - Math.abs(ra - rb));
    const vars = [...a.radiusVars, ...b.radiusVars];
    if (outer <= inner) {
      this.push([a.c, b.c], (x) => dist(x, a.c, b.c) - (a.radius(x) + b.radius(x)), vars);
    } else {
      const bigger = signOf(ra - rb);
      this.push(
        [a.c, b.c],
        (x) => dist(x, a.c, b.c) - bigger * (a.radius(x) - b.radius(x)),
        vars,
      );
    }
  }

  // ---------------------------------------------------------------- dimensions

  private dimension(d: SketchDimension, value: number): void {
    const [r0, r1] = d.refs;
    const x0 = this.x0;
    switch (d.type) {
      case "distance": {
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        const p = this.point(r0);
        const q = this.point(r1);
        if (l1 && r1 === undefined) {
          this.length(l1.a, l1.b, value);
        } else if (p !== undefined && q !== undefined) {
          this.length(p, q, value);
        } else if (p !== undefined && l2) {
          const side = signOf(signedDistance(x0, l2, at(x0, p), at(x0, p + 1)));
          this.push(
            [p, l2.a, l2.b],
            (x) => side * signedDistance(x, l2, at(x, p), at(x, p + 1)) - value,
          );
        } else if (l1 && l2) {
          // Offset between (parallel) lines, measured from the middle of the second line.
          const mid = (x: Float64Array): number =>
            signedDistance(
              x,
              l1,
              (at(x, l2.a) + at(x, l2.b)) / 2,
              (at(x, l2.a + 1) + at(x, l2.b + 1)) / 2,
            );
          const side = signOf(mid(x0));
          this.push([l1.a, l1.b, l2.a, l2.b], (x) => side * mid(x) - value);
        }
        return;
      }
      case "hdistance":
      case "vdistance": {
        const l = this.line(r0);
        const a = l ? l.a : this.point(r0);
        const b = l ? l.b : this.point(r1);
        if (a === undefined || b === undefined) return;
        const o = d.type === "hdistance" ? 0 : 1;
        // Keep the current left/right (up/down) order of the two points.
        const dir = signOf(at(x0, b + o) - at(x0, a + o));
        this.push([a, b], (x) => dir * (at(x, b + o) - at(x, a + o)) - value);
        return;
      }
      case "angle": {
        const l1 = this.line(r0);
        const l2 = this.line(r1);
        if (!l1 || !l2) return;
        this.pushAngle(
          [l1.a, l1.b, l2.a, l2.b],
          (x) => angleBetween(x, l1, l2),
          (value * Math.PI) / 180,
          TWO_PI,
          this.lineScale(l1, l2),
        );
        return;
      }
      case "radius":
      case "diameter": {
        const r = this.round(r0);
        if (!r) return;
        const target = d.type === "radius" ? value : value / 2;
        this.push([], (x) => r.radius(x) - target, r.radiusVars);
        return;
      }
    }
  }

  private length(a: number, b: number, value: number): void {
    if (Math.abs(value) < TINY) {
      // |b − a| is not differentiable at zero; a zero distance is a coincidence.
      this.coincidentPoints(a, b);
      return;
    }
    this.push([a, b], (x) => dist(x, a, b) - value);
  }
}

// ------------------------------------------------------------------ geometry helpers

function dist(x: Float64Array, a: number, b: number): number {
  return Math.hypot(at(x, b) - at(x, a), at(x, b + 1) - at(x, a + 1));
}

/** Signed distance of `(px, py)` from the line; positive on the left of `a → b`. */
function signedDistance(x: Float64Array, l: { a: number; b: number }, px: number, py: number): number {
  const ax = at(x, l.a);
  const ay = at(x, l.a + 1);
  const dx = at(x, l.b) - ax;
  const dy = at(x, l.b + 1) - ay;
  return (dx * (py - ay) - dy * (px - ax)) / safe(Math.hypot(dx, dy));
}

/** Counter-clockwise angle from the direction of `l1` to the direction of `l2`, in `(-π, π]`. */
function angleBetween(x: Float64Array, l1: LineRef, l2: LineRef): number {
  const ux = at(x, l1.b) - at(x, l1.a);
  const uy = at(x, l1.b + 1) - at(x, l1.a + 1);
  const vx = at(x, l2.b) - at(x, l2.a);
  const vy = at(x, l2.b + 1) - at(x, l2.a + 1);
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

function mirror(
  x: Float64Array,
  axis: LineRef,
  px: number,
  py: number,
): { x: number; y: number } {
  const ax = at(x, axis.a);
  const ay = at(x, axis.a + 1);
  const dx = at(x, axis.b) - ax;
  const dy = at(x, axis.b + 1) - ay;
  const len2 = safe(dx * dx + dy * dy);
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const fx = ax + t * dx;
  const fy = ay + t * dy;
  return { x: 2 * fx - px, y: 2 * fy - py };
}
