import { describe, expect, it } from "vitest";
import { evaluateAs } from "@fabcad/cad-document";
import { parsePointEntry, startsPointEntry } from "../src/sketch/pointEntry";

const scope = (name: string) => (name === "width" ? { value: 40, kind: "length" as const } : undefined);
const evaluate = (e: string, kind: "length" | "angle") => evaluateAs(e, kind, scope);
const at = (text: string, previous: { x: number; y: number } | null = null) =>
  parsePointEntry(text, previous, evaluate);

describe("typed points", () => {
  it("reads absolute, relative and polar points", () => {
    expect(at("30, 20")).toEqual({ ok: true, point: { x: 30, y: 20 } });
    expect(at("@10, -5", { x: 30, y: 20 })).toEqual({ ok: true, point: { x: 40, y: 15 } });
    // The first point of a shape is relative to the origin.
    expect(at("@10, 5")).toEqual({ ok: true, point: { x: 10, y: 5 } });
    const polar = at("@10<90", { x: 1, y: 1 });
    expect(polar.ok && polar.point.x).toBeCloseTo(1);
    expect(polar.ok && polar.point.y).toBeCloseTo(11);
    const fromOrigin = at("20<180");
    expect(fromOrigin.ok && fromOrigin.point.x).toBeCloseTo(-20);
  });

  it("evaluates expressions and parameters, with commas inside brackets", () => {
    expect(at("width / 2, max(3, 4)")).toEqual({ ok: true, point: { x: 20, y: 4 } });
  });

  it("explains what is wrong", () => {
    expect(at("")).toMatchObject({ ok: false });
    expect(at("30")).toMatchObject({ ok: false, error: expect.stringContaining("comma") });
    expect(at("30, depth")).toMatchObject({ ok: false, error: expect.stringContaining("depth") });
    expect(at("@5<")).toMatchObject({ ok: false, error: "The angle is missing." });
  });

  it("starts on digits, a sign, a dot, @ or a bracket, not on shortcut letters", () => {
    for (const k of ["3", "-", ".", "@", "("]) expect(startsPointEntry(k)).toBe(true);
    for (const k of ["l", "r", "Enter", "x"]) expect(startsPointEntry(k)).toBe(false);
  });
});
