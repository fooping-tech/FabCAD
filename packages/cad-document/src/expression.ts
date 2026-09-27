/**
 * Parameter expression language.
 *
 *   width * 0.6        material + 0.1 mm        sqrt(a^2 + b^2)        sin(30 deg) * r
 *
 * Internal base units are millimetres and degrees. Bare numbers are dimensionless and adopt the
 * unit of whatever they are combined with or assigned to.
 */

export type UnitKind = "length" | "angle" | "none";

export interface Quantity {
  /** Value in base units: mm for lengths, degrees for angles. */
  value: number;
  kind: UnitKind;
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position = 0,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

interface UnitDef {
  kind: Exclude<UnitKind, "none">;
  /** Multiply by this to convert to the base unit. */
  factor: number;
}

export const UNITS: Record<string, UnitDef> = {
  mm: { kind: "length", factor: 1 },
  cm: { kind: "length", factor: 10 },
  m: { kind: "length", factor: 1000 },
  in: { kind: "length", factor: 25.4 },
  ft: { kind: "length", factor: 304.8 },
  deg: { kind: "angle", factor: 1 },
  rad: { kind: "angle", factor: 180 / Math.PI },
};

export type Ast =
  | { type: "num"; value: number }
  | { type: "ref"; name: string; position: number }
  | { type: "unit"; unit: string; arg: Ast }
  | { type: "neg"; arg: Ast }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Ast; right: Ast; position: number }
  | { type: "call"; name: string; args: Ast[]; position: number };

type Token =
  | { t: "num"; value: number; pos: number }
  | { t: "id"; value: string; pos: number }
  | { t: "op"; value: string; pos: number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`Invalid number at ${i + 1}`, i);
      tokens.push({ t: "num", value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ t: "id", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push({ t: "op", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "°") {
      tokens.push({ t: "id", value: "deg", pos: i });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${ch}"`, i);
  }
  return tokens;
}

export const FUNCTION_NAMES = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sqrt",
  "abs",
  "min",
  "max",
  "floor",
  "ceil",
  "round",
  "pow",
] as const;

const CONSTANTS: Record<string, number> = { pi: Math.PI, PI: Math.PI };

export const RESERVED_NAMES = new Set<string>([
  ...Object.keys(UNITS),
  ...FUNCTION_NAMES,
  ...Object.keys(CONSTANTS),
]);

export function isValidParameterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_NAMES.has(name);
}

export function parseExpression(src: string): Ast {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new ExpressionError("Empty expression");
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (v: string): boolean => {
    const t = peek();
    return !!t && t.t === "op" && t.value === v;
  };
  const expect = (v: string): void => {
    if (!isOp(v)) {
      const t = peek();
      throw new ExpressionError(`Expected "${v}"`, t ? t.pos : src.length);
    }
    pos++;
  };

  const parseAdditive = (): Ast => {
    let left = parseMultiplicative();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        const right = parseMultiplicative();
        left = { type: "bin", op: t.value, left, right, position: t.pos };
      } else return left;
    }
  };
  const parseMultiplicative = (): Ast => {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.value === "*" || t.value === "/")) {
        pos++;
        const right = parseUnary();
        left = { type: "bin", op: t.value, left, right, position: t.pos };
      } else return left;
    }
  };
  const parseUnary = (): Ast => {
    if (isOp("-")) {
      pos++;
      return { type: "neg", arg: parseUnary() };
    }
    if (isOp("+")) {
      pos++;
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): Ast => {
    const base = parsePostfix();
    const t = peek();
    if (t && t.t === "op" && t.value === "^") {
      pos++;
      const exponent = parseUnary();
      return { type: "bin", op: "^", left: base, right: exponent, position: t.pos };
    }
    return base;
  };
  const parsePostfix = (): Ast => {
    let node = parsePrimary();
    for (;;) {
      const t = peek();
      if (t && t.t === "id" && UNITS[t.value]) {
        pos++;
        node = { type: "unit", unit: t.value, arg: node };
      } else return node;
    }
  };
  const parsePrimary = (): Ast => {
    const t = peek();
    if (!t) throw new ExpressionError("Unexpected end of expression", src.length);
    if (t.t === "num") {
      pos++;
      return { type: "num", value: t.value };
    }
    if (t.t === "id") {
      pos++;
      if (isOp("(")) {
        pos++;
        const args: Ast[] = [];
        if (!isOp(")")) {
          args.push(parseAdditive());
          while (isOp(",")) {
            pos++;
            args.push(parseAdditive());
          }
        }
        expect(")");
        return { type: "call", name: t.value, args, position: t.pos };
      }
      if (UNITS[t.value]) throw new ExpressionError(`Unit "${t.value}" needs a value`, t.pos);
      return { type: "ref", name: t.value, position: t.pos };
    }
    if (t.value === "(") {
      pos++;
      const inner = parseAdditive();
      expect(")");
      return inner;
    }
    throw new ExpressionError(`Unexpected "${t.value}"`, t.pos);
  };

  const ast = parseAdditive();
  const rest = peek();
  if (rest) throw new ExpressionError(`Unexpected "${rest.value}"`, rest.pos);
  return ast;
}

/** Names of parameters referenced by an expression (constants and functions excluded). */
export function collectReferences(ast: Ast, out = new Set<string>()): Set<string> {
  switch (ast.type) {
    case "num":
      break;
    case "ref":
      if (!(ast.name in CONSTANTS)) out.add(ast.name);
      break;
    case "unit":
    case "neg":
      collectReferences(ast.arg, out);
      break;
    case "bin":
      collectReferences(ast.left, out);
      collectReferences(ast.right, out);
      break;
    case "call":
      for (const a of ast.args) collectReferences(a, out);
      break;
  }
  return out;
}

/** References of an expression string; empty when the expression does not parse. */
export function expressionReferences(src: string): string[] {
  try {
    return [...collectReferences(parseExpression(src))];
  } catch {
    return [];
  }
}

export type Scope = (name: string) => Quantity | undefined;

const toRadians = (q: Quantity): number => (q.value * Math.PI) / 180;

function combineAdditive(a: Quantity, b: Quantity, position: number): UnitKind {
  if (a.kind === b.kind) return a.kind;
  if (a.kind === "none") return b.kind;
  if (b.kind === "none") return a.kind;
  throw new ExpressionError("Cannot add a length and an angle", position);
}

export function evaluateAst(ast: Ast, scope: Scope): Quantity {
  switch (ast.type) {
    case "num":
      return { value: ast.value, kind: "none" };
    case "ref": {
      const c = CONSTANTS[ast.name];
      if (c !== undefined) return { value: c, kind: "none" };
      const v = scope(ast.name);
      if (!v) throw new ExpressionError(`Unknown parameter "${ast.name}"`, ast.position);
      return v;
    }
    case "unit": {
      const inner = evaluateAst(ast.arg, scope);
      const unit = UNITS[ast.unit]!;
      if (inner.kind !== "none" && inner.kind !== unit.kind) {
        throw new ExpressionError(`Cannot apply unit "${ast.unit}" to this value`);
      }
      // A value that already carries a unit is kept as is: "(width) mm" is just width.
      return inner.kind === "none"
        ? { value: inner.value * unit.factor, kind: unit.kind }
        : inner;
    }
    case "neg": {
      const v = evaluateAst(ast.arg, scope);
      return { value: -v.value, kind: v.kind };
    }
    case "bin": {
      const a = evaluateAst(ast.left, scope);
      const b = evaluateAst(ast.right, scope);
      switch (ast.op) {
        case "+":
          return { value: a.value + b.value, kind: combineAdditive(a, b, ast.position) };
        case "-":
          return { value: a.value - b.value, kind: combineAdditive(a, b, ast.position) };
        case "*":
          return {
            value: a.value * b.value,
            kind: a.kind === "none" ? b.kind : b.kind === "none" ? a.kind : "none",
          };
        case "/":
          if (Math.abs(b.value) < 1e-300) {
            throw new ExpressionError("Division by zero", ast.position);
          }
          return {
            value: a.value / b.value,
            kind: b.kind === "none" ? a.kind : a.kind === b.kind ? "none" : a.kind,
          };
        case "^":
          return { value: Math.pow(a.value, b.value), kind: b.value === 1 ? a.kind : "none" };
      }
      break;
    }
    case "call":
      return evaluateCall(ast, scope);
  }
  throw new ExpressionError("Invalid expression");
}

function evaluateCall(ast: Extract<Ast, { type: "call" }>, scope: Scope): Quantity {
  const args = ast.args.map((a) => evaluateAst(a, scope));
  const arity = (n: number): void => {
    if (args.length !== n) {
      throw new ExpressionError(`${ast.name}() takes ${n} argument${n === 1 ? "" : "s"}`, ast.position);
    }
  };
  const atLeast = (n: number): void => {
    if (args.length < n) {
      throw new ExpressionError(`${ast.name}() needs at least ${n} argument`, ast.position);
    }
  };
  const first = args[0] ?? { value: 0, kind: "none" as UnitKind };
  const commonKind = (): UnitKind => {
    let kind: UnitKind = "none";
    for (const a of args) kind = combineAdditive({ value: 0, kind }, a, ast.position);
    return kind;
  };
  const finite = (value: number, kind: UnitKind): Quantity => {
    if (!Number.isFinite(value)) {
      throw new ExpressionError(`${ast.name}() is undefined for this value`, ast.position);
    }
    return { value, kind };
  };
  switch (ast.name) {
    case "sin":
      arity(1);
      return finite(Math.sin(toRadians(first)), "none");
    case "cos":
      arity(1);
      return finite(Math.cos(toRadians(first)), "none");
    case "tan":
      arity(1);
      return finite(Math.tan(toRadians(first)), "none");
    case "asin":
      arity(1);
      return finite((Math.asin(first.value) * 180) / Math.PI, "angle");
    case "acos":
      arity(1);
      return finite((Math.acos(first.value) * 180) / Math.PI, "angle");
    case "atan":
      arity(1);
      return finite((Math.atan(first.value) * 180) / Math.PI, "angle");
    case "atan2":
      arity(2);
      return finite((Math.atan2(first.value, args[1]!.value) * 180) / Math.PI, "angle");
    case "sqrt":
      arity(1);
      return finite(Math.sqrt(first.value), first.kind === "angle" ? "none" : first.kind);
    case "abs":
      arity(1);
      return finite(Math.abs(first.value), first.kind);
    case "floor":
      arity(1);
      return finite(Math.floor(first.value), first.kind);
    case "ceil":
      arity(1);
      return finite(Math.ceil(first.value), first.kind);
    case "round":
      arity(1);
      return finite(Math.round(first.value), first.kind);
    case "min":
      atLeast(1);
      return finite(Math.min(...args.map((a) => a.value)), commonKind());
    case "max":
      atLeast(1);
      return finite(Math.max(...args.map((a) => a.value)), commonKind());
    case "pow":
      arity(2);
      return finite(Math.pow(first.value, args[1]!.value), "none");
    default:
      throw new ExpressionError(`Unknown function "${ast.name}"`, ast.position);
  }
}

export function evaluateExpression(src: string, scope: Scope = () => undefined): Quantity {
  const q = evaluateAst(parseExpression(src), scope);
  if (!Number.isFinite(q.value)) throw new ExpressionError("Result is not a finite number");
  return q;
}

/**
 * Evaluate and coerce to the expected kind. Dimensionless results adopt the expected kind;
 * a length where an angle is expected (or vice versa) is an error.
 */
export function evaluateAs(src: string, expected: UnitKind, scope: Scope = () => undefined): number {
  const q = evaluateExpression(src, scope);
  if (expected !== "none" && q.kind !== "none" && q.kind !== expected) {
    throw new ExpressionError(`Expected ${expected === "length" ? "a length" : "an angle"}`);
  }
  return q.value;
}
