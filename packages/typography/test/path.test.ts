import { type ArcCurve, type Curve2, type Vec2, curvePointAt, dist2, rotate2 } from "@fabcad/geometry";
import { beforeAll, describe, expect, test } from "vitest";
import { type GlyphPlacement, type TextLayout, type TextPath, TypographyError } from "../src/index";
import { createPathMap } from "../src/pathMap";
import { type TestTypography, loopProblems, makeTypography } from "./helpers";

let t: TestTypography;

beforeAll(async () => {
  t = makeTypography();
  await t.ensureFont("zen");
});

const TEXT = "FabCAD 123";

const onPath = (path: TextPath, text = TEXT, extra: object = {}): TextLayout =>
  t.layout({ text, fontId: "zen", height: 10, path, ...extra });

const flat = (text = TEXT, extra: object = {}): TextLayout =>
  t.layout({ text, fontId: "zen", height: 10, ...extra });

/** Point on the baseline below the middle of the glyph: the point that is mapped onto the path. */
const anchor = (g: GlyphPlacement): Vec2 =>
  rotate2({ x: g.origin.x + g.advance / 2, y: g.origin.y }, g.rotation, g.origin);

const angleDiff = (a: number, b: number): number => {
  const d = (a - b) % (2 * Math.PI);
  return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
};

const points = (c: Curve2): Vec2[] =>
  c.type === "line" ? [c.a, c.b] : c.type === "bezier" ? [c.p0, c.p1, c.p2, c.p3] : [];

/** Same outlines up to rounding. */
const expectSameLoops = (actual: TextLayout, expected: TextLayout): void => {
  expect(actual.loops.length).toBe(expected.loops.length);
  actual.loops.forEach((loop, i) => {
    const other = expected.loops[i]!;
    expect(loop.map((c) => c.type)).toEqual(other.map((c) => c.type));
    loop.forEach((c, k) => {
      const q = points(other[k]!);
      points(c).forEach((p, n) => {
        expect(p.x).toBeCloseTo(q[n]!.x, 9);
        expect(p.y).toBeCloseTo(q[n]!.y, 9);
      });
    });
  });
  expect(actual.glyphs.map((g) => [g.cluster, g.text, g.glyphId])).toEqual(
    expected.glyphs.map((g) => [g.cluster, g.text, g.glyphId]),
  );
};

const line = (a: Vec2, b: Vec2): Curve2 => ({ type: "line", a, b });

/** Arc length positions of the glyph centres of the flat layout. */
const centres = (layout: TextLayout): number[] => layout.glyphs.map((g) => g.origin.x + g.advance / 2);
const advanceWidth = (layout: TextLayout): number => {
  const last = layout.glyphs[layout.glyphs.length - 1]!;
  return last.origin.x + last.advance;
};

describe("arc length map", () => {
  test("lines, arcs and Béziers are parameterised by length", () => {
    const bezier: Curve2 = { type: "bezier", p0: { x: 0, y: 0 }, p1: { x: 0, y: 40 }, p2: { x: 60, y: 40 }, p3: { x: 60, y: 0 } };
    const map = createPathMap([bezier])!;
    expect(map.closed).toBe(false);
    // Reference length from a fine polyline.
    let reference = 0;
    for (let i = 1; i <= 20000; i++) reference += dist2(curvePointAt(bezier, (i - 1) / 20000), curvePointAt(bezier, i / 20000));
    expect(map.length).toBeCloseTo(reference, 4);
    // Equal steps in s are equal distances along the curve.
    const n = 400;
    const step = map.length / n;
    for (let i = 1; i <= n; i++) {
      const d = dist2(map.frameAt((i - 1) * step).point, map.frameAt(i * step).point);
      expect(d).toBeGreaterThan(step * 0.999);
      expect(d).toBeLessThanOrEqual(step * 1.0001);
    }
    expect(map.frameAt(0).point).toEqual({ x: 0, y: 0 });
    expect(dist2(map.frameAt(map.length).point, { x: 60, y: 0 })).toBeLessThan(1e-9);
    expect(map.frameAt(map.length / 2).point.x).toBeCloseTo(30, 6);
    expect(map.frameAt(map.length / 2).tangent.x).toBeCloseTo(1, 6);
    // Open paths continue straight.
    expect(map.frameAt(-5).point.x).toBeCloseTo(0, 9);
    expect(map.frameAt(-5).point.y).toBeCloseTo(-5, 9);
    expect(map.frameAt(map.length + 5).point.y).toBeCloseTo(-5, 9);

    const chain = createPathMap([
      line({ x: 0, y: 0 }, { x: 10, y: 0 }),
      line({ x: 10, y: 0 }, { x: 10, y: 0 }),
      { type: "arc", center: { x: 10, y: 5 }, radius: 5, startAngle: -Math.PI / 2, sweep: Math.PI },
      line({ x: 10, y: 10 }, { x: 0, y: 10 }),
    ])!;
    expect(chain.length).toBeCloseTo(20 + 5 * Math.PI, 12);
    expect(chain.frameAt(10 + 2.5 * Math.PI).point.x).toBeCloseTo(15, 9);
    expect(chain.frameAt(10 + 2.5 * Math.PI).tangent.y).toBeCloseTo(1, 9);
    expect(chain.frameAt(15 + 5 * Math.PI).point).toEqual({ x: 5, y: 10 });
    expect(createPathMap([])).toBeNull();
    expect(createPathMap([line({ x: 1, y: 1 }, { x: 1, y: 1 })])).toBeNull();
  });
});

describe("text on a line", () => {
  const a = { x: 10, y: 20 };
  const angle = Math.PI / 6;
  const b = { x: a.x + 200 * Math.cos(angle), y: a.y + 200 * Math.sin(angle) };
  const path = { curves: [line(a, b)] };

  test("is the flat layout rotated onto the line", () => {
    const layout = onPath(path);
    const reference = flat();
    expect(layout.glyphs).toHaveLength(10);
    expect(layout.loops.length).toBe(reference.loops.length);
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
    layout.glyphs.forEach((g, i) => {
      expect(g.rotation).toBeCloseTo(angle, 12);
      expect(g.glyphId).toBe(reference.glyphs[i]!.glyphId);
      expect(g.advance).toBe(reference.glyphs[i]!.advance);
      // Collinear: every origin is on the line, at the pen position of the flat layout.
      const expected = rotate2({ x: a.x + reference.glyphs[i]!.origin.x, y: a.y }, angle, a);
      expect(g.origin.x).toBeCloseTo(expected.x, 9);
      expect(g.origin.y).toBeCloseTo(expected.y, 9);
      const d = { x: g.origin.x - a.x, y: g.origin.y - a.y };
      expect(d.x * Math.sin(angle) - d.y * Math.cos(angle)).toBeCloseTo(0, 9);
    });
    // Outlines too: compare one control point of every loop.
    layout.loops.forEach((loop, i) => {
      const c = loop[0]!;
      const r = reference.loops[i]![0]!;
      const p = c.type === "line" ? c.a : c.type === "bezier" ? c.p0 : null;
      const q = r.type === "line" ? r.a : r.type === "bezier" ? r.p0 : null;
      const expected = rotate2({ x: a.x + q!.x, y: a.y + q!.y }, angle, a);
      expect(p!.x).toBeCloseTo(expected.x, 9);
      expect(p!.y).toBeCloseTo(expected.y, 9);
    });
  });

  test("offset moves the baseline to the left of the travel direction", () => {
    const base = onPath(path);
    const left = onPath({ ...path, offset: 4 });
    const right = onPath({ ...path, offset: -4 });
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    left.glyphs.forEach((g, i) => {
      expect(g.origin.x).toBeCloseTo(base.glyphs[i]!.origin.x + 4 * normal.x, 9);
      expect(g.origin.y).toBeCloseTo(base.glyphs[i]!.origin.y + 4 * normal.y, 9);
      expect(right.glyphs[i]!.origin.x).toBeCloseTo(base.glyphs[i]!.origin.x - 4 * normal.x, 9);
    });
  });

  test("start and align position the text along the path", () => {
    const horizontal = { curves: [line({ x: 0, y: 0 }, { x: 200, y: 0 })] };
    const reference = flat();
    const w = advanceWidth(reference);
    expectSameLoops(onPath(horizontal), reference);
    expect(onPath({ ...horizontal, start: 25 }).glyphs[0]!.origin.x).toBeCloseTo(25, 9);
    expect(onPath({ ...horizontal, start: 25 }).bounds!.minX).toBeCloseTo(reference.bounds!.minX + 25, 9);
    const center = onPath({ ...horizontal, align: "center" });
    expect(center.glyphs[0]!.origin.x).toBeCloseTo(100 - w / 2, 9);
    expect(center.glyphs[9]!.origin.x + center.glyphs[9]!.advance).toBeCloseTo(100 + w / 2, 9);
    const right = onPath({ ...horizontal, align: "right" });
    expect(right.glyphs[9]!.origin.x + right.glyphs[9]!.advance).toBeCloseTo(200, 9);
    // Without path.align the horizontalAlign of the request is used.
    expect(onPath(horizontal, TEXT, { horizontalAlign: "center" })).toEqual(center);
    expect(onPath({ ...horizontal, align: "left" }, TEXT, { horizontalAlign: "center" })).toEqual(onPath(horizontal));
    // start shifts aligned text as well.
    expect(onPath({ ...horizontal, align: "center", start: -10 }).glyphs[0]!.origin.x).toBeCloseTo(90 - w / 2, 9);
  });

  test("flip runs the text from the other end, on the other side", () => {
    const horizontal = { curves: [line({ x: 0, y: 0 }, { x: 200, y: 0 })] };
    const flipped = onPath({ ...horizontal, flip: true, offset: 3 });
    const reference = flat();
    flipped.glyphs.forEach((g, i) => {
      expect(angleDiff(g.rotation, Math.PI)).toBeLessThan(1e-12);
      expect(g.origin.x).toBeCloseTo(200 - reference.glyphs[i]!.origin.x, 9);
      // Left of the reversed direction is below the line.
      expect(g.origin.y).toBeCloseTo(-3, 9);
    });
    expect(flipped.bounds!.maxY).toBeLessThanOrEqual(-3 + 0.2);
    expect(flipped.loops.flatMap(loopProblems)).toEqual([]);
  });

  test("text longer than an open path continues along the end tangent", () => {
    const short = { curves: [line({ x: 0, y: 0 }, { x: 0, y: 15 })] };
    const layout = onPath(short);
    const reference = flat();
    layout.glyphs.forEach((g, i) => {
      expect(g.rotation).toBeCloseTo(Math.PI / 2, 12);
      expect(g.origin.x).toBeCloseTo(0, 9);
      expect(g.origin.y).toBeCloseTo(reference.glyphs[i]!.origin.x, 9);
    });
    expect(layout.bounds!.maxY).toBeCloseTo(reference.bounds!.maxX, 9);
    expect(layout.bounds!.maxY).toBeGreaterThan(50);
  });

  test("vertical alignment and further lines are measured across the path", () => {
    const horizontal = { curves: [line({ x: 0, y: 0 }, { x: 200, y: 0 })] };
    for (const verticalAlign of ["top", "middle", "bottom", "baseline"] as const) {
      const layout = onPath(horizontal, "Fab\nCAD", { verticalAlign });
      expectSameLoops(layout, flat("Fab\nCAD", { verticalAlign }));
      expect(layout.lineCount).toBe(2);
    }
    expect(onPath(horizontal, "Hg", { verticalAlign: "top" }).bounds!.maxY).toBeLessThan(0);
  });

  test("vertical writing is ignored on a path; stretch and spacing apply", () => {
    const horizontal = { curves: [line({ x: 0, y: 0 }, { x: 200, y: 0 })] };
    expect(onPath(horizontal, "レーザー", { vertical: true })).toEqual(onPath(horizontal, "レーザー"));
    const options = { stretch: 130, spacing: 1.5 };
    expectSameLoops(onPath(horizontal, TEXT, options), flat(TEXT, options));
  });

  test("a path without length is rejected", () => {
    expect(() => onPath({ curves: [] })).toThrow(TypographyError);
    expect(() => onPath({ curves: [line({ x: 1, y: 1 }, { x: 1, y: 1 })] })).toThrow(/no length/);
    // …but not for empty text.
    expect(onPath({ curves: [] }, "").glyphs).toEqual([]);
  });
});

describe("text on an arc", () => {
  const center = { x: 30, y: -10 };
  const radius = 80;

  const check = (arc: ArcCurve, path: TextPath, layout: TextLayout, first: number): void => {
    const reference = flat();
    const s = centres(reference);
    const offset = path.offset ?? 0;
    const ccw = arc.sweep > 0 !== (path.flip === true);
    // Positive offsets are to the left: towards the centre on a counter-clockwise arc.
    const expectedRadius = ccw ? radius - offset : radius + offset;
    const startAngle = path.flip ? arc.startAngle + arc.sweep : arc.startAngle;
    layout.glyphs.forEach((g, i) => {
      const p = anchor(g);
      expect(dist2(p, center)).toBeCloseTo(expectedRadius, 9);
      const along = (first + s[i]!) / radius;
      const polar = startAngle + (ccw ? along : -along);
      expect(angleDiff(Math.atan2(p.y - center.y, p.x - center.x), polar)).toBeLessThan(1e-9);
      // Rotation = direction of the tangent.
      expect(angleDiff(g.rotation, polar + (ccw ? Math.PI / 2 : -Math.PI / 2))).toBeLessThan(1e-9);
      expect(g.advance).toBe(reference.glyphs[i]!.advance);
    });
    expect(layout.loops.length).toBe(reference.loops.length);
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
  };

  test("counter-clockwise and clockwise arcs, with offsets", () => {
    const ccw: ArcCurve = { type: "arc", center, radius, startAngle: 0.3, sweep: 2.2 };
    const cw: ArcCurve = { type: "arc", center, radius, startAngle: 2.5, sweep: -2.2 };
    for (const arc of [ccw, cw]) {
      for (const offset of [0, 3, -3]) {
        const path = { curves: [arc], offset };
        check(arc, path, onPath(path), 0);
      }
    }
    // Text on top of a clockwise arc reads left to right and stays outside the circle.
    const top = onPath({ curves: [cw] });
    const outside = top.loops.flat().every((c) => {
      const p = c.type === "line" ? c.a : c.type === "bezier" ? c.p0 : center;
      return dist2(p, center) > radius - 1.5;
    });
    expect(outside).toBe(true);
  });

  test("start, align and flip on an arc", () => {
    const arc: ArcCurve = { type: "arc", center, radius, startAngle: 0.3, sweep: 2.2 };
    const length = radius * 2.2;
    const w = advanceWidth(flat());
    check(arc, { curves: [arc], start: 12 }, onPath({ curves: [arc], start: 12 }), 12);
    check(arc, { curves: [arc], align: "center" }, onPath({ curves: [arc], align: "center" }), (length - w) / 2);
    check(arc, { curves: [arc], align: "right", offset: 2 }, onPath({ curves: [arc], align: "right", offset: 2 }), length - w);
    const flipped = { curves: [arc], flip: true, offset: 2, start: 5 };
    check(arc, flipped, onPath(flipped), 5);
    // Centred text is symmetric about the middle of the arc.
    const centred = onPath({ curves: [arc], align: "center" });
    const first = anchor(centred.glyphs[0]!);
    const last = centred.glyphs[9]!;
    const end = rotate2({ x: last.origin.x + last.advance, y: last.origin.y }, last.rotation, last.origin);
    const begin = centred.glyphs[0]!.origin;
    const mid = arc.startAngle + arc.sweep / 2;
    const polar = (p: Vec2): number => Math.atan2(p.y - center.y, p.x - center.x);
    expect(first).toBeDefined();
    expect(angleDiff(polar(begin), mid) ).toBeCloseTo(angleDiff(polar(end), mid), 2);
  });
});

describe("text on a full circle", () => {
  const center = { x: -5, y: 8 };
  const radius = 40;
  const circle: ArcCurve = { type: "arc", center, radius, startAngle: Math.PI / 2, sweep: -2 * Math.PI };

  test("glyph centres are on the circle and follow the tangent", () => {
    const text = "FABCAD * LASER * PRINT * ";
    const layout = onPath({ curves: [circle] }, text, { height: 8 });
    const reference = flat(text, { height: 8 });
    const s = centres(reference);
    layout.glyphs.forEach((g, i) => {
      const p = anchor(g);
      expect(dist2(p, center)).toBeCloseTo(radius, 9);
      const polar = Math.PI / 2 - s[i]! / radius;
      expect(angleDiff(Math.atan2(p.y - center.y, p.x - center.x), polar)).toBeLessThan(1e-9);
      expect(angleDiff(g.rotation, polar - Math.PI / 2)).toBeLessThan(1e-9);
    });
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
    // Clockwise from the top: the text is outside the circle.
    const b = layout.bounds!;
    expect(b.maxY).toBeGreaterThan(center.y + radius);
    expect(b.maxY).toBeLessThan(center.y + radius + 8);
  });

  test("positions wrap around on a closed path", () => {
    const length = 2 * Math.PI * radius;
    const a = onPath({ curves: [circle], start: 10 });
    const b = onPath({ curves: [circle], start: 10 + length });
    const c = onPath({ curves: [circle], start: 10 - length });
    a.glyphs.forEach((g, i) => {
      for (const other of [b, c]) {
        expect(other.glyphs[i]!.origin.x).toBeCloseTo(g.origin.x, 6);
        expect(other.glyphs[i]!.origin.y).toBeCloseTo(g.origin.y, 6);
        expect(angleDiff(other.glyphs[i]!.rotation, g.rotation)).toBeLessThan(1e-9);
      }
    });
    // Centred on a circle that starts at the top: centred on the bottom.
    const centred = onPath({ curves: [circle], align: "center" });
    const bounds = centred.bounds!;
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(center.x, 0);
    expect(bounds.minY).toBeLessThan(center.y - radius);
    // Upside down there: the text runs from right to left.
    expect(centred.glyphs[0]!.origin.x).toBeGreaterThan(centred.glyphs[9]!.origin.x);
  });

  test("inside a counter-clockwise circle with top alignment", () => {
    const ccw: ArcCurve = { ...circle, startAngle: -Math.PI / 2, sweep: 2 * Math.PI };
    const layout = onPath({ curves: [ccw] }, TEXT, { verticalAlign: "bottom" });
    // Left of a counter-clockwise circle is the inside; "bottom" puts the descender line on the path.
    for (const c of layout.loops.flat()) {
      const p = c.type === "line" ? c.a : c.type === "bezier" ? c.p0 : center;
      expect(dist2(p, center)).toBeLessThan(radius);
    }
  });
});

describe("text on a Bézier chain", () => {
  const curves: Curve2[] = [
    { type: "bezier", p0: { x: 0, y: 0 }, p1: { x: 30, y: 40 }, p2: { x: 60, y: 40 }, p3: { x: 90, y: 0 } },
    { type: "bezier", p0: { x: 90, y: 0 }, p1: { x: 120, y: -40 }, p2: { x: 150, y: -40 }, p3: { x: 180, y: 0 } },
  ];

  test("glyph centres are on the curve at the right arc length, rotated to the tangent", () => {
    const map = createPathMap(curves)!;
    const text = "設計から、切れるデータまで。FabCAD";
    const layout = onPath({ curves, offset: 1.5, start: 3 }, text, { height: 8 });
    const s = centres(flat(text, { height: 8 }));
    layout.glyphs.forEach((g, i) => {
      const frame = map.frameAt(3 + s[i]!);
      const p = anchor(g);
      expect(p.x).toBeCloseTo(frame.point.x - frame.tangent.y * 1.5, 9);
      expect(p.y).toBeCloseTo(frame.point.y + frame.tangent.x * 1.5, 9);
      expect(angleDiff(g.rotation, Math.atan2(frame.tangent.y, frame.tangent.x))).toBeLessThan(1e-12);
      // On the curve itself (within the accuracy of the length table).
      const foot = { x: p.x + frame.tangent.y * 1.5, y: p.y - frame.tangent.x * 1.5 };
      let nearest = Infinity;
      for (const c of curves) {
        for (let k = 0; k <= 4000; k++) nearest = Math.min(nearest, dist2(curvePointAt(c, k / 4000), foot));
      }
      expect(nearest).toBeLessThan(0.02);
    });
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
    expect(layout.glyphs.length).toBe([...text].length);
    // The first half climbs, the chain passes through (90, 0) heading down.
    expect(layout.glyphs[0]!.rotation).toBeGreaterThan(0.5);
    const flippedLayout = onPath({ curves, flip: true }, text, { height: 8 });
    expect(flippedLayout.glyphs[0]!.origin.x).toBeGreaterThan(170);
    // Reversed end tangent: from (180, 0) towards (150, -40).
    expect(angleDiff(flippedLayout.glyphs[0]!.rotation, Math.atan2(-40, -30))).toBeLessThan(0.3);
  });

  test("mixed chain of line, arc and Bézier", () => {
    const chain: Curve2[] = [
      line({ x: 0, y: 0 }, { x: 40, y: 0 }),
      { type: "arc", center: { x: 40, y: 20 }, radius: 20, startAngle: -Math.PI / 2, sweep: Math.PI / 2 },
      { type: "bezier", p0: { x: 60, y: 20 }, p1: { x: 60, y: 40 }, p2: { x: 70, y: 50 }, p3: { x: 90, y: 50 } },
    ];
    const layout = onPath({ curves: chain }, "FabCAD 123 FabCAD 123", { height: 6 });
    const rotations = layout.glyphs.map((g) => g.rotation);
    expect(rotations[0]).toBe(0);
    expect(Math.max(...rotations)).toBeGreaterThan(1.0);
    expect(Math.max(...rotations)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(layout.loops.flatMap(loopProblems)).toEqual([]);
    expect(layout).toEqual(onPath({ curves: chain }, "FabCAD 123 FabCAD 123", { height: 6 }));
  });
});
