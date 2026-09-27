import type { Sketch, SolveStatus } from "@fabcad/sketch/src/model";
import { type Equation, buildEquations, wrapPeriodic } from "./equations";
import {
  type ColumnIndex,
  RankTracker,
  type SparseRows,
  buildColumnIndex,
  choleskyFactor,
  choleskySolve,
  weightedGram,
  weightedTransposeApply,
} from "./linalg";
import type { SketchSolver, SolveOptions, SolveResult } from "./types";
import { applyVariables, buildVariables } from "./variables";

const DEFAULT_TOLERANCE = 1e-8;
const DEFAULT_MAX_ITERATIONS = 100;
/** Step used for central differences, in mm. */
const DIFF_STEP = 1e-5;
/** Weight of dragged variables; everything else has weight 1. */
const DRAG_WEIGHT = 1e-6;
/** Number of sub-steps used when a drag cannot be solved in one go. */
const DRAG_SUBSTEPS = 8;
const LAMBDA_START = 1e-8;
const LAMBDA_MIN = 1e-12;
const LAMBDA_MAX = 1e8;

/** Residual vector and sparse Jacobian of a set of equations. */
class EquationSet {
  readonly count: number;
  readonly jacobian: SparseRows;
  readonly index: ColumnIndex;

  constructor(
    readonly equations: Equation[],
    readonly variables: number,
  ) {
    this.count = equations.length;
    const rowStart = new Int32Array(this.count + 1);
    let nnz = 0;
    equations.forEach((eq, i) => {
      nnz += eq.vars.length;
      rowStart[i + 1] = nnz;
    });
    const cols = new Int32Array(nnz);
    let k = 0;
    for (const eq of equations) for (const v of eq.vars) cols[k++] = v;
    this.jacobian = {
      rows: this.count,
      columns: variables,
      rowStart,
      cols,
      values: new Float64Array(nnz),
    };
    this.index = buildColumnIndex(this.jacobian);
  }

  residuals(x: Float64Array, out: Float64Array): void {
    const eqs = this.equations;
    for (let i = 0; i < eqs.length; i++) out[i] = (eqs[i] as Equation).evaluate(x);
  }

  /**
   * Jacobian by central differences. Each residual depends on a handful of variables only, so
   * this costs a few evaluations per equation. `x` is perturbed in place and restored.
   */
  updateJacobian(x: Float64Array): void {
    const values = this.jacobian.values;
    let k = 0;
    for (const eq of this.equations) {
      for (const v of eq.vars) {
        const keep = x[v] as number;
        x[v] = keep + DIFF_STEP;
        const plus = eq.evaluate(x);
        x[v] = keep - DIFF_STEP;
        const minus = eq.evaluate(x);
        x[v] = keep;
        let d = plus - minus;
        if (eq.period !== undefined) d = wrapPeriodic(d, eq.period);
        values[k++] = Number.isFinite(d) ? d / (2 * DIFF_STEP) : 0;
      }
    }
  }
}

interface IterationResult {
  x: Float64Array;
  residuals: Float64Array;
  converged: boolean;
  iterations: number;
}

const maxAbs = (v: Float64Array): number => {
  let m = 0;
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i] as number);
    if (!(a <= m)) m = a;
  }
  return m;
};

const sumSquares = (v: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] as number) * (v[i] as number);
  return s;
};

/**
 * Levenberg–Marquardt in its minimum-norm ("dual") form. Every step solves
 *
 *     (J·W·Jᵀ + λ·I)·y = −r,     Δ = W·Jᵀ·y
 *
 * For λ → 0 this is the step of smallest weighted norm `Δᵀ·W⁻¹·Δ` that satisfies the linearized
 * equations, so geometry that is not forced to move stays where it is, and variables with a
 * small weight (dragged points) move least of all. The damping λ keeps the system solvable
 * when equations are redundant or contradictory; with contradictory equations the iteration
 * settles in a least-squares compromise.
 */
function iterate(
  set: EquationSet,
  start: Float64Array,
  weights: Float64Array,
  tolerance: number,
  maxIterations: number,
): IterationResult {
  const m = set.count;
  const n = set.variables;
  const x = start.slice();
  let r = new Float64Array(m);
  set.residuals(x, r);
  if (m === 0 || n === 0) {
    return { x, residuals: r, converged: maxAbs(r) <= tolerance, iterations: 0 };
  }

  const limits = Float64Array.from(set.equations, (eq) => eq.stepLimit ?? Infinity);
  const gram = new Float64Array(m * m);
  const factor = new Float64Array(m * m);
  const y = new Float64Array(m);
  const step = new Float64Array(n);
  const trial = new Float64Array(n);
  let trialResiduals = new Float64Array(m);
  let cost = sumSquares(r);
  let lambda = LAMBDA_START;
  let stalls = 0;
  let iterations = 0;

  while (iterations < maxIterations && maxAbs(r) > tolerance) {
    iterations++;
    set.updateJacobian(x);
    weightedGram(set.jacobian, set.index, weights, gram);
    let scale = 0;
    for (let i = 0; i < m; i++) scale = Math.max(scale, gram[i * m + i] as number);
    if (!(scale > 0)) break;

    let accepted = false;
    let stepSize = 0;
    let trialCost = cost;
    while (lambda <= LAMBDA_MAX) {
      factor.set(gram);
      const damping = lambda * scale;
      for (let i = 0; i < m; i++) factor[i * m + i] = (factor[i * m + i] as number) + damping;
      if (choleskyFactor(factor, m)) {
        for (let i = 0; i < m; i++) {
          const limit = limits[i] as number;
          y[i] = -Math.max(-limit, Math.min(limit, r[i] as number));
        }
        choleskySolve(factor, m, y);
        weightedTransposeApply(set.jacobian, weights, y, step);
        stepSize = 0;
        for (let i = 0; i < n; i++) {
          const d = step[i] as number;
          trial[i] = (x[i] as number) + d;
          stepSize = Math.max(stepSize, Math.abs(d));
        }
        set.residuals(trial, trialResiduals);
        trialCost = sumSquares(trialResiduals);
        if (Number.isFinite(trialCost) && trialCost < cost) {
          accepted = true;
          break;
        }
      }
      lambda *= 10;
    }
    if (!accepted) break;

    const improvement = (cost - trialCost) / cost;
    x.set(trial);
    [r, trialResiduals] = [trialResiduals, r];
    cost = trialCost;
    lambda = Math.max(lambda * 0.1, LAMBDA_MIN);

    // Contradictory systems creep towards their least-squares compromise; stop early.
    stalls = improvement < 1e-9 ? stalls + 1 : 0;
    if (stalls >= 2 || stepSize < 1e-13) break;
  }

  return { x, residuals: r, converged: maxAbs(r) <= tolerance, iterations };
}

interface RankAnalysis {
  rank: number;
  /** Sources owning at least one equation that added no information. */
  dependent: Set<string>;
}

/**
 * Rank of the Jacobian at `x`. Equations are added in order (implicit rules, constraints,
 * dimensions), so an equation is flagged as dependent when everything it asks for already
 * follows from the equations before it.
 */
function analyseRank(set: EquationSet, x: Float64Array): RankAnalysis {
  const dependent = new Set<string>();
  if (set.count === 0 || set.variables === 0) return { rank: 0, dependent };
  set.updateJacobian(x);
  const tracker = new RankTracker(set.variables);
  set.equations.forEach((eq, i) => {
    if (!tracker.addRow(set.jacobian, i) && !eq.implicit) dependent.add(eq.source);
  });
  return { rank: tracker.rank, dependent };
}

/** Sources with the largest residuals, worst first. */
function findConflicts(set: EquationSet, residuals: Float64Array, tolerance: number): string[] {
  const worst = new Map<string, number>();
  set.equations.forEach((eq, i) => {
    if (eq.implicit) return;
    const v = Math.abs(residuals[i] as number);
    const value = Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
    if (value > (worst.get(eq.source) ?? -1)) worst.set(eq.source, value);
  });
  let max = 0;
  for (const v of worst.values()) max = Math.max(max, v);
  const threshold = Math.max(tolerance, 0.1 * max);
  return [...worst.entries()]
    .filter(([, v]) => v > threshold || v === max)
    .filter(([, v]) => v > tolerance)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * Sketch solver based on damped Gauss–Newton iterations.
 *
 * Pipeline: sketch geometry → variables and residual equations → minimum-norm
 * Levenberg–Marquardt → solved copy of the sketch, plus a rank analysis of the Jacobian that
 * yields the remaining degrees of freedom and the redundant constraints.
 */
export class NumericSketchSolver implements SketchSolver {
  readonly name = "numeric-lm";

  solve(sketch: Sketch, options: SolveOptions = {}): SolveResult {
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const { layout, values } = buildVariables(sketch);
    const system = buildEquations(sketch, layout, values, options.dimensionValues ?? {});
    // Held variables get weight 0 and therefore never move; their equations are trivially
    // satisfied and only matter for the rank analysis.
    const set = new EquationSet(
      system.equations.filter((eq) => !eq.hold),
      layout.count,
    );
    const weights = new Float64Array(layout.count).fill(1);
    for (const v of system.fixed) weights[v] = 0;

    // 1. Solve the sketch as it is.
    const base = iterate(set, values, weights, tolerance, maxIterations);
    let final = base;
    let converged = base.converged;
    let iterations = base.iterations;

    // 2. Follow the drag from the solved state.
    const targets = new Map<number, number>();
    if (base.converged) {
      for (const drag of options.drag ?? []) {
        const i = layout.pointIndex.get(drag.pointId);
        if (i === undefined) continue;
        if (!Number.isFinite(drag.target.x) || !Number.isFinite(drag.target.y)) continue;
        if (!system.fixed.has(i)) targets.set(i, drag.target.x);
        if (!system.fixed.has(i + 1)) targets.set(i + 1, drag.target.y);
      }
    }
    if (targets.size > 0) {
      for (const i of targets.keys()) weights[i] = DRAG_WEIGHT;
      const dragTo = (from: Float64Array, fraction: number): IterationResult => {
        const start = from.slice();
        for (const [i, target] of targets) {
          const origin = base.x[i] as number;
          start[i] = origin + (target - origin) * fraction;
        }
        const result = iterate(set, start, weights, tolerance, maxIterations);
        iterations += result.iterations;
        return result;
      };
      let dragged = dragTo(base.x, 1);
      if (!dragged.converged) {
        // Too far for one step: walk towards the target.
        dragged = base;
        for (let s = 1; s <= DRAG_SUBSTEPS; s++) {
          dragged = dragTo(dragged.x, s / DRAG_SUBSTEPS);
          if (!dragged.converged) break;
        }
      }
      // Dragged variables are heavy, not immovable: they end up a hair short of a reachable
      // target. Aim again from the solved state to close the gap.
      for (let pass = 0; pass < 2 && dragged.converged; pass++) {
        let gap = 0;
        let travel = 0;
        for (const [i, target] of targets) {
          gap = Math.max(gap, Math.abs((dragged.x[i] as number) - target));
          travel = Math.max(travel, Math.abs((base.x[i] as number) - target));
        }
        if (gap < 1e-9 || gap > 0.01 * travel) break;
        const again = dragTo(dragged.x, 1);
        if (!again.converged) break;
        dragged = again;
      }
      if (dragged.converged) final = dragged;
      else converged = false;
    }

    // 3. Degrees of freedom, redundancy and conflicts at the result.
    const analysis = analyseRank(new EquationSet(system.equations, layout.count), final.x);
    const degreesOfFreedom = Math.max(0, layout.count - analysis.rank);
    const conflicting = final.converged ? [] : findConflicts(set, final.residuals, tolerance);
    const conflictSet = new Set(conflicting);
    const redundant = [...analysis.dependent].filter((id) => !conflictSet.has(id));
    const status: SolveStatus = !final.converged
      ? "over-constrained"
      : degreesOfFreedom === 0
        ? "fully-constrained"
        : "under-constrained";

    return {
      sketch: applyVariables(sketch, layout, final.x),
      converged,
      status,
      degreesOfFreedom,
      conflicting,
      redundant,
      residual: set.count === 0 ? 0 : Math.sqrt(sumSquares(final.residuals) / set.count),
      iterations,
    };
  }
}

export function createDefaultSolver(): SketchSolver {
  return new NumericSketchSolver();
}

/** Solve a sketch with the default solver. */
export function solveSketch(sketch: Sketch, options?: SolveOptions): SolveResult {
  return createDefaultSolver().solve(sketch, options);
}
