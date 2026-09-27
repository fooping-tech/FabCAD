import { describe, expect, it } from "vitest";
import {
  ExpressionError,
  evaluateAs,
  evaluateExpression,
  expressionReferences,
  isValidParameterName,
} from "../src/expression";
import {
  type Parameter,
  evaluateParameters,
  formatQuantity,
  renameInExpression,
} from "../src/parameters";

const p = (name: string, expression: string, unit: Parameter["unit"] = "mm"): Parameter => ({
  id: `id-${name}`,
  name,
  expression,
  unit,
});

describe("expressions", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(evaluateExpression("1 + 2 * 3").value).toBe(7);
    expect(evaluateExpression("(1 + 2) * 3").value).toBe(9);
    expect(evaluateExpression("2 ^ 3 ^ 2").value).toBe(512);
    expect(evaluateExpression("-2 ^ 2").value).toBe(-4);
    expect(evaluateExpression("10 / 4").value).toBe(2.5);
    expect(evaluateExpression("1.5e2 + .5").value).toBe(150.5);
  });

  it("handles units", () => {
    expect(evaluateExpression("5.5 mm")).toEqual({ value: 5.5, kind: "length" });
    expect(evaluateExpression("5.5mm + 0.1 mm").value).toBeCloseTo(5.6);
    expect(evaluateExpression("2 cm").value).toBe(20);
    expect(evaluateExpression("1 in").value).toBeCloseTo(25.4);
    expect(evaluateExpression("90 deg")).toEqual({ value: 90, kind: "angle" });
    expect(evaluateExpression("pi rad").value).toBeCloseTo(180);
    expect(evaluateExpression("10 mm + 1").kind).toBe("length");
    expect(() => evaluateExpression("10 mm + 5 deg")).toThrow(ExpressionError);
  });

  it("provides functions in degrees", () => {
    expect(evaluateExpression("sin(30 deg)").value).toBeCloseTo(0.5);
    expect(evaluateExpression("cos(60)").value).toBeCloseTo(0.5);
    expect(evaluateExpression("atan2(1, 1)")).toMatchObject({ kind: "angle" });
    expect(evaluateExpression("atan2(1, 1)").value).toBeCloseTo(45);
    expect(evaluateExpression("sqrt(3^2 + 4^2)").value).toBe(5);
    expect(evaluateExpression("min(3, 1, 2)").value).toBe(1);
    expect(evaluateExpression("max(3 mm, 10 mm)")).toEqual({ value: 10, kind: "length" });
    expect(evaluateExpression("abs(-4)").value).toBe(4);
    expect(() => evaluateExpression("sqrt(-1)")).toThrow();
    expect(() => evaluateExpression("nope(1)")).toThrow(/Unknown function/);
  });

  it("reports syntax errors", () => {
    expect(() => evaluateExpression("")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1 +")).toThrow(ExpressionError);
    expect(() => evaluateExpression("(1 + 2")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1 $ 2")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1 / 0")).toThrow(/zero/);
    expect(() => evaluateExpression("width")).toThrow(/Unknown parameter/);
  });

  it("coerces to the expected kind", () => {
    expect(evaluateAs("100", "length")).toBe(100);
    expect(evaluateAs("45", "angle")).toBe(45);
    expect(() => evaluateAs("45 deg", "length")).toThrow();
  });

  it("collects references", () => {
    expect(expressionReferences("width / 2 + sin(a) * pi").sort()).toEqual(["a", "width"]);
    expect(isValidParameterName("width")).toBe(true);
    expect(isValidParameterName("mm")).toBe(false);
    expect(isValidParameterName("sin")).toBe(false);
    expect(isValidParameterName("2x")).toBe(false);
  });
});

describe("parameters", () => {
  it("evaluates the example from the specification", () => {
    const r = evaluateParameters([
      p("width", "100 mm"),
      p("height", "width * 0.6"),
      p("material", "5.5 mm"),
      p("slot", "material + 0.1 mm"),
    ]);
    expect(r.errors).toEqual({});
    expect(r.values.width).toEqual({ value: 100, kind: "length" });
    expect(r.values.height).toEqual({ value: 60, kind: "length" });
    expect(r.values.slot!.value).toBeCloseTo(5.6);
  });

  it("evaluates independent of declaration order", () => {
    const r = evaluateParameters([p("b", "a * 2"), p("a", "21")]);
    expect(r.values.b!.value).toBe(42);
    expect(r.order).toEqual(["a", "b"]);
    expect(r.dependencies.b).toEqual(["a"]);
  });

  it("detects cycles, unknown references, duplicates and unit mismatches", () => {
    const r = evaluateParameters([
      p("a", "b + 1"),
      p("b", "a + 1"),
      p("c", "missing * 2"),
      p("d", "1"),
      { ...p("d", "2"), id: "dup" },
      p("e", "30 deg"),
      p("f", "e", "deg"),
      p("g", "d + 1"),
    ]);
    expect(r.errors["id-a"] ?? r.errors["id-b"]).toMatch(/Circular/);
    expect(r.values.a).toBeUndefined();
    expect(r.values.b).toBeUndefined();
    expect(r.errors["id-c"]).toMatch(/Unknown parameter/);
    expect(r.errors.dup).toMatch(/Duplicate/);
    expect(r.errors["id-e"]).toMatch(/mismatch/);
    expect(r.errors["id-f"]).toBeDefined();
    expect(r.values.g!.value).toBe(2);
  });

  it("renames references without touching other identifiers", () => {
    expect(renameInExpression("w + width * w2 + w", "w", "size")).toBe("size + width * w2 + size");
    expect(renameInExpression("min(min, 2)", "min", "m")).toBe("min(m, 2)");
  });

  it("formats quantities", () => {
    expect(formatQuantity({ value: 5.5, kind: "length" })).toBe("5.5 mm");
    expect(formatQuantity({ value: 30, kind: "angle" })).toBe("30°");
    expect(formatQuantity({ value: 1 / 3, kind: "none" })).toBe("0.333");
  });
});
