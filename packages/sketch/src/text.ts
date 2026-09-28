import {
  type Bounds2,
  type Curve2,
  type Vec2,
  boundsOfPoints,
  curveStart,
  dist2,
  distanceToCurve,
  flattenLoop,
  pointInPolygon,
  reverseLoop,
  rotate2,
  signedArea,
} from "@fabcad/geometry";
import { SketchBuilder } from "./edit";
import type { EntityId, Sketch, SketchText } from "./model";
import { type SketchRegion, interiorPointOf, loopArea } from "./profiles";

/**
 * Sketch text: SketchText (what the user wrote) → glyph outlines (derived, cached in the
 * text) → regions (profiles). This module only works with the cached outlines; it knows
 * neither fonts nor layout, so it runs wherever the sketch package runs.
 */

export type SketchTextProps = Omit<SketchText, "id" | "type" | "origin" | "outline">;

export const sketchTexts = (sketch: Sketch): SketchText[] => Object.values(sketch.texts ?? {});

const originOf = (sketch: Sketch, text: SketchText): Vec2 => {
  const p = sketch.entities[text.origin];
  return p?.type === "point" ? { x: p.x, y: p.y } : { x: 0, y: 0 };
};

function placeCurve(c: Curve2, origin: Vec2, angle: number): Curve2 {
  const at = (p: Vec2): Vec2 => {
    const r = angle === 0 ? p : rotate2(p, angle);
    return { x: r.x + origin.x, y: r.y + origin.y };
  };
  switch (c.type) {
    case "line":
      return { type: "line", a: at(c.a), b: at(c.b) };
    case "bezier":
      return { type: "bezier", p0: at(c.p0), p1: at(c.p1), p2: at(c.p2), p3: at(c.p3) };
    case "arc":
      return { ...c, center: at(c.center), startAngle: c.startAngle + angle };
    case "ellipseArc":
      return { ...c, center: at(c.center), rotation: c.rotation + angle };
  }
}

/** Outlines of a text in sketch coordinates. Empty while the text has no outline. */
export function textLoops(sketch: Sketch, text: SketchText): Curve2[][] {
  const outline = text.outline;
  if (!outline) return [];
  if (outline.space === "sketch") return outline.loops;
  const origin = originOf(sketch, text);
  return outline.loops.map((loop) => loop.map((c) => placeCurve(c, origin, outline.rotation)));
}

/** Corners of the box around a text in sketch coordinates (rotated with the text). */
export function textBox(sketch: Sketch, text: SketchText, margin = 0): Vec2[] | null {
  const outline = text.outline;
  const b = outline?.bounds;
  if (!outline || !b) return null;
  const corners: Vec2[] = [
    { x: b.minX - margin, y: b.minY - margin },
    { x: b.maxX + margin, y: b.minY - margin },
    { x: b.maxX + margin, y: b.maxY + margin },
    { x: b.minX - margin, y: b.maxY + margin },
  ];
  if (outline.space === "sketch") return corners;
  const origin = originOf(sketch, text);
  return corners.map((p) => {
    const r = rotate2(p, outline.rotation);
    return { x: r.x + origin.x, y: r.y + origin.y };
  });
}

export function textBounds(sketch: Sketch, text: SketchText): Bounds2 | null {
  const box = textBox(sketch, text);
  return box ? boundsOfPoints(box) : null;
}

interface Ring {
  curves: Curve2[];
  polygon: Vec2[];
  area: number;
  bounds: Bounds2;
  depth: number;
  parent: number;
}

/**
 * Regions of one text. Which loop is an outline and which a counter is decided by nesting
 * (a loop inside an odd number of loops is a hole), not by the winding of the font, because
 * fonts disagree about the winding.
 */
export function textRegions(sketch: Sketch, text: SketchText, flattenTolerance = 0.01): SketchRegion[] {
  const rings: Ring[] = [];
  for (const curves of textLoops(sketch, text)) {
    if (curves.length === 0) continue;
    const polygon = flattenLoop({ curves }, flattenTolerance);
    // Exact area of the curves; the polygon is only used for containment tests.
    const area = loopArea({ curves });
    if (polygon.length < 3 || Math.abs(area) < 1e-9) continue;
    rings.push({ curves, polygon, area, bounds: boundsOfPoints(polygon), depth: 0, parent: -1 });
  }
  for (const [i, ring] of rings.entries()) {
    const probe = curveStart(ring.curves[0]!);
    for (const [j, other] of rings.entries()) {
      if (i === j) continue;
      const b = other.bounds;
      if (probe.x < b.minX || probe.x > b.maxX || probe.y < b.minY || probe.y > b.maxY) continue;
      if (Math.abs(other.area) <= Math.abs(ring.area)) continue;
      if (!pointInPolygon(probe, other.polygon)) continue;
      ring.depth += 1;
      // The smallest loop around is the direct parent.
      if (ring.parent < 0 || Math.abs(other.area) < Math.abs(rings[ring.parent]!.area)) {
        ring.parent = j;
      }
    }
  }

  const regions: SketchRegion[] = [];
  let n = 0;
  for (const [i, ring] of rings.entries()) {
    if (ring.depth % 2 === 1) continue;
    const holes = rings.filter((r) => r.parent === i && r.depth === ring.depth + 1);
    const ccw = (r: Ring): { curves: Curve2[]; polygon: Vec2[] } =>
      r.area > 0
        ? { curves: r.curves, polygon: r.polygon }
        : { curves: reverseLoop({ curves: r.curves }).curves, polygon: r.polygon.slice().reverse() };
    const cw = (r: Ring): { curves: Curve2[]; polygon: Vec2[] } =>
      r.area < 0
        ? { curves: r.curves, polygon: r.polygon }
        : { curves: reverseLoop({ curves: r.curves }).curves, polygon: r.polygon.slice().reverse() };
    const outer = ccw(ring);
    const inner = holes.map(cw);
    const area = Math.abs(ring.area) - holes.reduce((sum, h) => sum + Math.abs(h.area), 0);
    if (!(area > 1e-9)) continue;
    const holePolygons = inner.map((h) => h.polygon);
    regions.push({
      id: `text:${text.id}:${n++}`,
      profile: { outer: { curves: outer.curves }, holes: inner.map((h) => ({ curves: h.curves })) },
      entityIds: [text.id],
      holeEntityIds: inner.map(() => [text.id]),
      area,
      polygon: outer.polygon,
      holePolygons,
      interiorPoint: interiorPointOf(outer.polygon, holePolygons),
      textId: text.id,
    });
  }
  return regions;
}

/**
 * Text under `p`: inside the box around the text, or within `tolerance` of an outline. The
 * box makes a text easy to pick; thin strokes would be hard to hit otherwise.
 */
export function hitTestText(sketch: Sketch, p: Vec2, tolerance: number): SketchText | null {
  let best: SketchText | null = null;
  let bestArea = Infinity;
  for (const text of sketchTexts(sketch)) {
    const box = textBox(sketch, text, tolerance);
    if (!box || !pointInPolygon(p, box)) continue;
    const area = Math.abs(signedArea(box));
    if (area < bestArea) {
      best = text;
      bestArea = area;
    }
  }
  return best;
}

/** Id of the text whose outline passes within `tolerance` of `p`. */
export function textOutlineAt(sketch: Sketch, p: Vec2, tolerance: number): string | null {
  for (const text of sketchTexts(sketch)) {
    const b = textBounds(sketch, text);
    if (!b) continue;
    if (
      p.x < b.minX - tolerance ||
      p.x > b.maxX + tolerance ||
      p.y < b.minY - tolerance ||
      p.y > b.maxY + tolerance
    ) {
      continue;
    }
    for (const loop of textLoops(sketch, text)) {
      for (const c of loop) if (distanceToCurve(c, p) <= tolerance) return text.id;
    }
  }
  return null;
}

// ------------------------------------------------------------------ editing

/** Add a text at a new point (or at an existing point). */
export function addText(
  sketch: Sketch,
  at: Vec2 | EntityId,
  props: SketchTextProps,
): { sketch: Sketch; id: string } {
  const b = new SketchBuilder(sketch);
  const origin = b.resolvePoint(at);
  const next = b.build();
  const id = `t${next.nextId}`;
  const text: SketchText = { ...props, id, type: "text", origin };
  return {
    sketch: { ...next, nextId: next.nextId + 1, texts: { ...(next.texts ?? {}), [id]: text } },
    id,
  };
}

/**
 * Change a text. The cached outline is kept: whoever derives outlines compares its key and
 * renews it (see `SketchTextOutline`).
 */
export function updateText(sketch: Sketch, id: string, patch: Partial<SketchTextProps> & { outline?: SketchText["outline"] }): Sketch {
  const text = sketch.texts?.[id];
  if (!text) return sketch;
  const next: SketchText = { ...text, ...patch };
  if ("path" in patch && patch.path === undefined) delete next.path;
  if ("outline" in patch && patch.outline === undefined) delete next.outline;
  return { ...sketch, texts: { ...sketch.texts, [id]: next } };
}

/** Remove texts together with origin points that nothing else uses. */
export function removeTexts(sketch: Sketch, ids: Iterable<string>): Sketch {
  const doomed = new Set(ids);
  const texts = sketch.texts ?? {};
  const origins: EntityId[] = [];
  const kept: Record<string, SketchText> = {};
  for (const t of Object.values(texts)) {
    if (doomed.has(t.id)) origins.push(t.origin);
    else kept[t.id] = t;
  }
  if (origins.length === 0) return sketch;
  let next: Sketch = { ...sketch, texts: kept };
  const free = origins.filter((p) => pointIsFree(next, p));
  if (free.length > 0) {
    const b = new SketchBuilder(next);
    b.remove(free);
    next = b.build();
  }
  return next;
}

function pointIsFree(sketch: Sketch, pointId: EntityId): boolean {
  if (pointId === sketch.originId) return false;
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "point") continue;
    if (JSON.stringify(e).includes(`"${pointId}"`)) return false;
  }
  if (Object.values(sketch.constraints).some((c) => c.refs.includes(pointId))) return false;
  if (Object.values(sketch.dimensions).some((d) => d.refs.includes(pointId))) return false;
  if (sketchTexts(sketch).some((t) => t.origin === pointId)) return false;
  return !sketch.projections.some((r) => r.entityIds.includes(pointId));
}

export interface ExplodedText {
  sketch: Sketch;
  /** The curve entities that replace the text. */
  created: EntityId[];
}

/**
 * Explode Text: replace a text by ordinary sketch curves. Straight segments become lines and
 * every cubic Bézier a control spline of four points, which is that very curve. The ends of
 * consecutive segments share a point, so the outlines stay closed profiles.
 *
 * The text itself is gone afterwards; undoing the command is the way back.
 */
export function explodeText(sketch: Sketch, id: string): ExplodedText | null {
  const text = sketch.texts?.[id];
  if (!text) return null;
  const loops = textLoops(sketch, text);
  if (loops.length === 0) return null;
  const clean = (v: number): number => {
    const r = Math.round(v * 1e6) / 1e6;
    return Object.is(r, -0) ? 0 : r;
  };
  const b = new SketchBuilder(removeTexts(sketch, [id]));
  const created: EntityId[] = [];
  const construction = text.construction === true;
  for (const loop of loops) {
    // Curves that are too short to matter would only make degenerate entities.
    const curves = loop.filter((c) => c.type === "line" || c.type === "bezier").filter((c) =>
      c.type === "line" ? dist2(c.a, c.b) > 1e-7 : dist2(c.p0, c.p3) > 1e-7 || dist2(c.p0, c.p1) > 1e-7,
    );
    if (curves.length === 0) continue;
    const startOf = (c: Curve2): Vec2 => curveStart(c);
    const first = b.point(clean(startOf(curves[0]!).x), clean(startOf(curves[0]!).y), construction);
    let from = first;
    for (const [i, c] of curves.entries()) {
      const last = i === curves.length - 1;
      const end = c.type === "line" ? c.b : c.type === "bezier" ? c.p3 : startOf(c);
      const to = last ? first : b.point(clean(end.x), clean(end.y), construction);
      if (c.type === "line") {
        created.push(b.line(from, to, construction));
      } else if (c.type === "bezier") {
        const c1 = b.point(clean(c.p1.x), clean(c.p1.y), construction);
        const c2 = b.point(clean(c.p2.x), clean(c.p2.y), construction);
        created.push(b.spline("control", [from, c1, c2, to], false, construction));
      }
      from = to;
    }
  }
  return { sketch: b.build(), created };
}

// -------------------------------------------------------------- expressions

export interface TextExpression {
  /** "height", "letterSpacing", "lineSpacing", "rotation", "path.offset", "path.start". */
  field: string;
  expression: string;
  kind: "length" | "angle" | "none";
}

/** The parameter expressions of a text, for the dependency graph and for renaming parameters. */
export function textExpressions(text: SketchText): TextExpression[] {
  const out: TextExpression[] = [
    { field: "height", expression: text.height, kind: "length" },
    { field: "letterSpacing", expression: text.letterSpacing, kind: "length" },
    { field: "lineSpacing", expression: text.lineSpacing, kind: "none" },
  ];
  if (text.path) {
    out.push(
      { field: "path.offset", expression: text.path.offset, kind: "length" },
      { field: "path.start", expression: text.path.start, kind: "length" },
    );
  } else {
    out.push({ field: "rotation", expression: text.rotation, kind: "angle" });
  }
  return out;
}

export function setTextExpression(text: SketchText, field: string, expression: string): SketchText {
  switch (field) {
    case "height":
    case "letterSpacing":
    case "lineSpacing":
    case "rotation":
      return text[field] === expression ? text : { ...text, [field]: expression };
    case "path.offset":
      return text.path ? { ...text, path: { ...text.path, offset: expression } } : text;
    case "path.start":
      return text.path ? { ...text, path: { ...text.path, start: expression } } : text;
    default:
      return text;
  }
}
