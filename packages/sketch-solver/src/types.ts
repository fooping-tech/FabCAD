import type { EntityId, Sketch, SolveStatus } from "@fabcad/sketch";
import type { Vec2 } from "@fabcad/geometry";

/** A point the user is dragging: the solver pulls it towards `target` while honouring constraints. */
export interface DragTarget {
  pointId: EntityId;
  target: Vec2;
}

export interface SolveOptions {
  /**
   * Evaluated values of driving dimensions by dimension id, in mm or degrees. Dimension
   * expressions are evaluated by the caller; the solver never sees parameters. Driving
   * dimensions without a value here are ignored.
   */
  dimensionValues?: Record<string, number>;
  drag?: DragTarget[];
  maxIterations?: number;
  /** Residual tolerance in mm. */
  tolerance?: number;
}

export interface SolveResult {
  /** Solved copy of the input sketch. When the solve fails this is the best attempt. */
  sketch: Sketch;
  converged: boolean;
  status: SolveStatus;
  /** Remaining degrees of freedom (0 when fully constrained). */
  degreesOfFreedom: number;
  /** Ids of constraints and dimensions that could not be satisfied. */
  conflicting: string[];
  /** Ids of constraints and dimensions that are redundant but consistent. */
  redundant: string[];
  /** Final root-mean-square residual. */
  residual: number;
  iterations: number;
}

/** Implemented by every solver backend so that the solver can be swapped out. */
export interface SketchSolver {
  readonly name: string;
  solve(sketch: Sketch, options?: SolveOptions): SolveResult;
}
