import {
  type CadDocument,
  type ParameterEvaluation,
  type Scope,
  type SketchFeature,
  evaluateAs,
  evaluateParameters,
  parameterScope,
} from "@fabcad/cad-document";
import { type Plane3, ORIGIN_PLANES } from "@fabcad/geometry";
import type { Sketch, SketchPlaneRef, SolveStatus } from "@fabcad/sketch";
import type { DragTarget, SketchSolver, SolveResult } from "@fabcad/sketch-solver";

export interface SketchSolveInfo {
  sketch: Sketch;
  status: SolveStatus;
  converged: boolean;
  degreesOfFreedom: number;
  conflicting: string[];
  redundant: string[];
  /** Evaluated driving dimension values by dimension id. */
  dimensionValues: Record<string, number>;
  /** Dimension ids whose expression could not be evaluated, with the reason. */
  dimensionErrors: Record<string, string>;
}

/** Evaluate the driving dimension expressions of a sketch against the parameters. */
export function evaluateDimensions(
  sketch: Sketch,
  scope: Scope,
): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const d of Object.values(sketch.dimensions)) {
    if (!d.driving) continue;
    try {
      const v = evaluateAs(d.expression, d.type === "angle" ? "angle" : "length", scope);
      if (d.type !== "angle" && d.type !== "hdistance" && d.type !== "vdistance" && v < 0) {
        throw new Error("Must not be negative");
      }
      values[d.id] = v;
    } catch (err) {
      errors[d.id] = err instanceof Error ? err.message : String(err);
    }
  }
  return { values, errors };
}

/** Solve a sketch with its dimension expressions evaluated in `scope`. */
export function solveSketchWithParameters(
  sketch: Sketch,
  solver: SketchSolver,
  scope: Scope,
  drag?: DragTarget[],
): SketchSolveInfo {
  const { values, errors } = evaluateDimensions(sketch, scope);
  const options = drag ? { dimensionValues: values, drag } : { dimensionValues: values };
  const result: SolveResult = solver.solve(sketch, options);
  return {
    sketch: result.sketch,
    status: result.status,
    converged: result.converged,
    degreesOfFreedom: result.degreesOfFreedom,
    conflicting: result.conflicting,
    redundant: result.redundant,
    dimensionValues: values,
    dimensionErrors: errors,
  };
}

/**
 * Re-solve every sketch of a document, e.g. after a parameter changed. The document always
 * stores solved sketch geometry; this keeps that invariant. Sketches that fail to converge are
 * left untouched. Returns the same document object when nothing moved.
 */
export function resolveDocumentSketches(
  doc: CadDocument,
  solver: SketchSolver,
  evaluation: ParameterEvaluation = evaluateParameters(doc.parameters),
): CadDocument {
  const scope = parameterScope(evaluation);
  let features = doc.features;
  for (const f of Object.values(doc.features)) {
    if (f.type !== "sketch") continue;
    const info = solveSketchWithParameters(f.sketch, solver, scope);
    if (!info.converged || sameGeometry(info.sketch, f.sketch)) continue;
    if (features === doc.features) features = { ...doc.features };
    const next: SketchFeature = { ...f, sketch: info.sketch };
    features[f.id] = next;
  }
  return features === doc.features ? doc : { ...doc, features };
}

function sameGeometry(a: Sketch, b: Sketch, tol = 1e-9): boolean {
  for (const [id, ea] of Object.entries(a.entities)) {
    const eb = b.entities[id];
    if (!eb || ea.type !== eb.type) return false;
    if (ea.type === "point" && eb.type === "point") {
      if (Math.abs(ea.x - eb.x) > tol || Math.abs(ea.y - eb.y) > tol) return false;
    } else if (ea.type === "circle" && eb.type === "circle") {
      if (Math.abs(ea.radius - eb.radius) > tol) return false;
    } else if (ea.type === "ellipse" && eb.type === "ellipse") {
      if (Math.abs(ea.minorRadius - eb.minorRadius) > tol) return false;
    }
  }
  return true;
}

export function resolveSketchPlane(ref: SketchPlaneRef): Plane3 {
  return ref.type === "origin" ? ORIGIN_PLANES[ref.plane] : ref.plane;
}
