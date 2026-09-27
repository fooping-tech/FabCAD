import {
  type Quantity,
  type Scope,
  type UnitKind,
  ExpressionError,
  collectReferences,
  evaluateAst,
  isValidParameterName,
  parseExpression,
} from "./expression";

/** Unit a parameter is declared in. The empty string means dimensionless. */
export type ParameterUnit = "mm" | "deg" | "";

export interface Parameter {
  id: string;
  name: string;
  /** Expression source, e.g. "100", "width * 0.6", "material + 0.1 mm". */
  expression: string;
  unit: ParameterUnit;
  comment?: string;
}

export interface ParameterEvaluation {
  /** Evaluated values by parameter name (only parameters that evaluated successfully). */
  values: Record<string, Quantity>;
  /** Error messages by parameter id. */
  errors: Record<string, string>;
  /** Parameter names in evaluation order. */
  order: string[];
  /** Direct dependencies by parameter name. */
  dependencies: Record<string, string[]>;
}

const unitKind = (unit: ParameterUnit): UnitKind =>
  unit === "mm" ? "length" : unit === "deg" ? "angle" : "none";

/** Evaluate all parameters in dependency order, detecting cycles and unit mismatches. */
export function evaluateParameters(parameters: readonly Parameter[]): ParameterEvaluation {
  const result: ParameterEvaluation = { values: {}, errors: {}, order: [], dependencies: {} };
  const byName = new Map<string, Parameter>();
  for (const p of parameters) {
    if (!isValidParameterName(p.name)) {
      result.errors[p.id] = `Invalid parameter name "${p.name}"`;
      continue;
    }
    if (byName.has(p.name)) {
      result.errors[p.id] = `Duplicate parameter name "${p.name}"`;
      continue;
    }
    byName.set(p.name, p);
  }

  const state = new Map<string, "visiting" | "done" | "failed">();
  const scope: Scope = (name) => result.values[name];

  const visit = (p: Parameter, chain: string[]): boolean => {
    const s = state.get(p.name);
    if (s === "done") return true;
    if (s === "failed") return false;
    if (s === "visiting") {
      result.errors[p.id] = `Circular reference: ${[...chain, p.name].join(" → ")}`;
      state.set(p.name, "failed");
      return false;
    }
    state.set(p.name, "visiting");
    try {
      const ast = parseExpression(p.expression);
      const refs = [...collectReferences(ast)];
      result.dependencies[p.name] = refs;
      for (const ref of refs) {
        const dep = byName.get(ref);
        if (!dep) throw new ExpressionError(`Unknown parameter "${ref}"`);
        if (!visit(dep, [...chain, p.name])) {
          if (state.get(p.name) === "failed") return false;
          throw new ExpressionError(`Depends on invalid parameter "${ref}"`);
        }
      }
      const q = evaluateAst(ast, scope);
      if (!Number.isFinite(q.value)) throw new ExpressionError("Result is not a finite number");
      const expected = unitKind(p.unit);
      if (q.kind !== "none" && expected !== "none" && q.kind !== expected) {
        throw new ExpressionError(
          `Unit mismatch: expected ${p.unit}, got ${q.kind === "length" ? "a length" : "an angle"}`,
        );
      }
      result.values[p.name] = { value: q.value, kind: expected === "none" ? q.kind : expected };
      result.order.push(p.name);
      state.set(p.name, "done");
      return true;
    } catch (err) {
      if (!result.errors[p.id]) {
        result.errors[p.id] = err instanceof Error ? err.message : String(err);
      }
      state.set(p.name, "failed");
      return false;
    }
  };

  for (const p of byName.values()) visit(p, []);
  return result;
}

export function parameterScope(evaluation: ParameterEvaluation): Scope {
  return (name) => evaluation.values[name];
}

/** Rewrite references to a renamed parameter inside an expression, leaving the rest intact. */
export function renameInExpression(expression: string, from: string, to: string): string {
  return expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id, offset: number) => {
    if (id !== from) return id;
    // Skip function calls with the same name.
    const rest = expression.slice(offset + id.length);
    return /^\s*\(/.test(rest) ? id : to;
  });
}

const trimNumber = (v: number, digits: number): string => {
  const s = v.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

export function formatQuantity(q: Quantity, digits = 3): string {
  const n = trimNumber(q.value, digits);
  if (q.kind === "length") return `${n} mm`;
  if (q.kind === "angle") return `${n}°`;
  return n;
}
