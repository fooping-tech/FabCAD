import {
  type Plane3,
  type Vec2,
  add2,
  dist2,
  flattenCurve,
  norm2,
  perp2,
  planeToWorld,
  scale2,
  sub2,
} from "@fabcad/geometry";
import {
  type Sketch,
  type SketchDimension,
  type SketchRegion,
  dimensionAnchor,
  entityPointIds,
  entityToCurves,
  getPoint,
  isCurve,
  measureDimension,
} from "@fabcad/sketch";
import type { ViewportScene } from "../viewport/scene";
import { SKETCH_COLORS } from "../viewport/theme";
import { constraintGlyph } from "./constraintTools";

/** Drawing of sketches onto the 2D overlay canvas, using the 3D camera for projection. */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface LabelHit {
  kind: "dimension" | "constraint";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SketchDrawState {
  active: boolean;
  fullyConstrained: boolean;
  selectedEntities: Set<string>;
  selectedLabels: Set<string>;
  hoverEntity: string | null;
  hoverLabel: string | null;
  conflicting: Set<string>;
  /** Entities drawn in the preview colour (not yet committed). */
  previewEntities: Set<string>;
  showConstraints: boolean;
  showDimensions: boolean;
  /** Evaluated values of driving dimensions. */
  dimensionValues: Record<string, number>;
  dimensionErrors: Record<string, string>;
}

export class Projector {
  constructor(
    private scene: ViewportScene,
    readonly plane: Plane3,
  ) {}

  toScreen(p: Vec2): ScreenPoint {
    const s = this.scene.project(planeToWorld(this.plane, p));
    return { x: s.x, y: s.y };
  }

  toSketch(x: number, y: number): Vec2 | null {
    return this.scene.pointOnPlane(x, y, this.plane);
  }

  /** Sketch units per screen pixel near a sketch point. */
  pixel(at: Vec2 = { x: 0, y: 0 }): number {
    return this.scene.pixelSize(planeToWorld(this.plane, at));
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: ScreenPoint[], close = false): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  if (close) ctx.closePath();
  ctx.stroke();
}

export function fillRegion(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  region: SketchRegion,
  color: string,
): void {
  ctx.beginPath();
  for (const ring of [region.polygon, ...region.holePolygons]) {
    ring.forEach((p, i) => {
      const s = projector.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill("evenodd");
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  width: number,
  height: number,
): void {
  const corners = [
    projector.toSketch(0, 0),
    projector.toSketch(width, 0),
    projector.toSketch(width, height),
    projector.toSketch(0, height),
  ];
  if (corners.some((c) => !c)) return;
  const pts = corners as Vec2[];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const px = projector.pixel({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  if (!(px > 0) || !Number.isFinite(px)) return;
  // Minor lines at least 9 px apart, on a 1-2-5 series.
  const raw = px * 9;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  const count = (maxX - minX) / step + (maxY - minY) / step;
  if (count > 600) return;
  const major = step * 5;
  ctx.lineWidth = 1;
  const line = (a: Vec2, b: Vec2, color: string): void => {
    const sa = projector.toScreen(a);
    const sb = projector.toScreen(b);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  };
  const isMajor = (v: number): boolean => Math.abs(v / major - Math.round(v / major)) < 1e-6;
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
    if (Math.abs(x) < step / 2) continue;
    line({ x, y: minY }, { x, y: maxY }, isMajor(x) ? SKETCH_COLORS.gridMajor : SKETCH_COLORS.grid);
  }
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    if (Math.abs(y) < step / 2) continue;
    line({ x: minX, y }, { x: maxX, y }, isMajor(y) ? SKETCH_COLORS.gridMajor : SKETCH_COLORS.grid);
  }
  line({ x: minX, y: 0 }, { x: maxX, y: 0 }, "rgba(208, 69, 58, 0.55)");
  line({ x: 0, y: minY }, { x: 0, y: maxY }, "rgba(61, 154, 74, 0.55)");
}

function entityColor(id: string, construction: boolean, state: SketchDrawState): string {
  if (state.previewEntities.has(id)) return SKETCH_COLORS.preview;
  if (state.selectedEntities.has(id)) return SKETCH_COLORS.selected;
  if (state.hoverEntity === id) return SKETCH_COLORS.hover;
  if (!state.active) return SKETCH_COLORS.inactive;
  if (construction) return SKETCH_COLORS.construction;
  return state.fullyConstrained ? SKETCH_COLORS.curveFull : SKETCH_COLORS.curve;
}

export function drawSketchGeometry(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  sketch: Sketch,
  state: SketchDrawState,
): void {
  const px = projector.pixel();
  const tolerance = Math.max(px * 0.4, 1e-4);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const e of Object.values(sketch.entities)) {
    if (!isCurve(e)) continue;
    let curves;
    try {
      curves = entityToCurves(sketch, e);
    } catch {
      continue;
    }
    const highlighted =
      state.selectedEntities.has(e.id) || state.hoverEntity === e.id || state.previewEntities.has(e.id);
    ctx.strokeStyle = entityColor(e.id, !!e.construction, state);
    ctx.lineWidth = highlighted ? 2.4 : state.active ? 1.6 : 1.1;
    ctx.setLineDash(e.construction ? [6, 4] : []);
    for (const c of curves) {
      strokePolyline(
        ctx,
        flattenCurve(c, tolerance).map((p) => projector.toScreen(p)),
      );
    }
    if (e.type === "spline" && state.active && e.kind === "control") {
      // Control polygon.
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = SKETCH_COLORS.construction;
      strokePolyline(
        ctx,
        e.points.map((id) => projector.toScreen(getPoint(sketch, id))),
      );
    }
  }
  ctx.setLineDash([]);

  if (!state.active) return;
  // Centres of circles etc. are drawn hollow so that end points stand out.
  const centres = new Set<string>();
  for (const e of Object.values(sketch.entities)) {
    if (e.type === "circle" || e.type === "arc" || e.type === "ellipse") centres.add(e.center);
  }
  for (const e of Object.values(sketch.entities)) {
    if (e.type !== "point") continue;
    const s = projector.toScreen(e);
    const highlighted = state.selectedEntities.has(e.id) || state.hoverEntity === e.id;
    if (e.id === sketch.originId) {
      // Origin marker: a ringed dot.
      ctx.beginPath();
      ctx.arc(s.x, s.y, highlighted ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = highlighted ? entityColor(e.id, false, state) : SKETCH_COLORS.curveFull;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      continue;
    }
    const r = highlighted ? 4.5 : 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = centres.has(e.id) && !highlighted ? "#fff" : entityColor(e.id, false, state);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = entityColor(e.id, false, state);
    ctx.stroke();
  }
}

/** A representative point of an entity, where constraint glyphs are attached. */
function entityAnchor(sketch: Sketch, id: string): Vec2 | null {
  const e = sketch.entities[id];
  if (!e) return null;
  try {
    switch (e.type) {
      case "point":
        return { x: e.x, y: e.y };
      case "line": {
        const a = getPoint(sketch, e.p1);
        const b = getPoint(sketch, e.p2);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      case "circle": {
        const c = getPoint(sketch, e.center);
        return { x: c.x + e.radius * Math.SQRT1_2, y: c.y + e.radius * Math.SQRT1_2 };
      }
      default: {
        const curves = entityToCurves(sketch, e);
        const c = curves[Math.floor(curves.length / 2)];
        if (!c) return null;
        const pts = flattenCurve(c, 0.5);
        return pts[Math.floor(pts.length / 2)] ?? null;
      }
    }
  } catch {
    return null;
  }
}

export function drawConstraints(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  sketch: Sketch,
  state: SketchDrawState,
  hits: LabelHit[],
): void {
  const stacked = new Map<string, number>();
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const c of Object.values(sketch.constraints)) {
    // The origin is always fixed; its glyph would only be noise.
    if (c.type === "fix" && sketch.originId && c.refs.includes(sketch.originId)) continue;
    // One glyph per referenced entity, except for the mirror axis of a symmetry.
    const refs = c.type === "symmetry" ? c.refs.slice(0, 2) : c.refs;
    for (const ref of refs) {
      const anchor = entityAnchor(sketch, ref);
      if (!anchor) continue;
      const s = projector.toScreen(anchor);
      const n = stacked.get(ref) ?? 0;
      stacked.set(ref, n + 1);
      const x = s.x + 12 + n * 16;
      const y = s.y - 12;
      const key = `constraint:${c.id}`;
      const selected = state.selectedLabels.has(key);
      const hover = state.hoverLabel === key;
      const conflict = state.conflicting.has(c.id);
      ctx.fillStyle = conflict
        ? SKETCH_COLORS.conflict
        : selected
          ? SKETCH_COLORS.selected
          : hover
            ? SKETCH_COLORS.hover
            : "rgba(255,255,255,0.92)";
      ctx.strokeStyle = conflict ? SKETCH_COLORS.conflict : SKETCH_COLORS.constraint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - 7, y - 7, 14, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = conflict || selected || hover ? "#fff" : SKETCH_COLORS.constraint;
      ctx.fillText(constraintGlyph(c.type), x, y + 0.5);
      hits.push({ kind: "constraint", id: c.id, x: x - 7, y: y - 7, w: 14, h: 14 });
    }
  }
}

const trimNumber = (v: number, digits = 2): string => {
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "") || "0";
};

export function dimensionText(dim: SketchDimension, value: number | null, error?: string): string {
  if (error) return `${dim.expression} ⚠`;
  const v = value === null ? "?" : trimNumber(value);
  const prefix = dim.type === "radius" ? "R" : dim.type === "diameter" ? "⌀" : "";
  const suffix = dim.type === "angle" ? "°" : "";
  const isNumber = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*(mm|deg)?\s*$/.test(dim.expression);
  const text = `${prefix}${v}${suffix}`;
  const body = isNumber ? text : `${text}  ƒ ${dim.expression.trim()}`;
  return dim.driving ? body : `(${body})`;
}

function arrow(ctx: CanvasRenderingContext2D, tip: ScreenPoint, from: ScreenPoint): void {
  const d = norm2(sub2(from, tip));
  if (d.x === 0 && d.y === 0) return;
  const n = perp2(d);
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + d.x * size + n.x * size * 0.35, tip.y + d.y * size + n.y * size * 0.35);
  ctx.lineTo(tip.x + d.x * size - n.x * size * 0.35, tip.y + d.y * size - n.y * size * 0.35);
  ctx.closePath();
  ctx.fill();
}

export function labelPositionOf(sketch: Sketch, dim: SketchDimension): Vec2 {
  return dim.labelPosition ?? dimensionAnchor(sketch, dim).defaultLabel;
}

export function drawDimensions(
  ctx: CanvasRenderingContext2D,
  projector: Projector,
  sketch: Sketch,
  state: SketchDrawState,
  hits: LabelHit[],
): void {
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const dim of Object.values(sketch.dimensions)) {
    let anchor;
    try {
      anchor = dimensionAnchor(sketch, dim);
    } catch {
      continue;
    }
    if (anchor.points.length < 2) continue;
    const label = dim.labelPosition ?? anchor.defaultLabel;
    const key = `dimension:${dim.id}`;
    const selected = state.selectedLabels.has(key);
    const hover = state.hoverLabel === key;
    const conflict = state.conflicting.has(dim.id) || !!state.dimensionErrors[dim.id];
    const color = conflict
      ? SKETCH_COLORS.conflict
      : selected
        ? SKETCH_COLORS.selected
        : hover
          ? SKETCH_COLORS.hover
          : SKETCH_COLORS.dimension;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    const measured = measureDimension(sketch, dim);
    const value = dim.driving ? (state.dimensionValues[dim.id] ?? measured) : measured;
    const text = dimensionText(dim, value, state.dimensionErrors[dim.id]);
    const sl = projector.toScreen(label);

    if (dim.type === "distance" || dim.type === "hdistance" || dim.type === "vdistance") {
      const a = anchor.points[0]!;
      const b = anchor.points[1]!;
      let dir: Vec2;
      if (dim.type === "hdistance") dir = { x: 1, y: 0 };
      else if (dim.type === "vdistance") dir = { x: 0, y: 1 };
      else dir = dist2(a, b) < 1e-9 ? { x: 1, y: 0 } : norm2(sub2(b, a));
      // Feet of the anchors on the dimension line through the label.
      const foot = (p: Vec2): Vec2 => {
        const t = (p.x - label.x) * dir.x + (p.y - label.y) * dir.y;
        return add2(label, scale2(dir, t));
      };
      const fa = projector.toScreen(foot(a));
      const fb = projector.toScreen(foot(b));
      const sa = projector.toScreen(a);
      const sb = projector.toScreen(b);
      ctx.globalAlpha = 0.6;
      strokePolyline(ctx, [sa, fa]);
      strokePolyline(ctx, [sb, fb]);
      ctx.globalAlpha = 1;
      strokePolyline(ctx, [fa, fb]);
      strokePolyline(ctx, [fa, sl]);
      arrow(ctx, fa, fb);
      arrow(ctx, fb, fa);
    } else if (dim.type === "radius" || dim.type === "diameter") {
      const a = projector.toScreen(anchor.points[0]!);
      const b = projector.toScreen(anchor.points[1]!);
      // Leader from the curve through the label, pointing at the curve.
      const e = sketch.entities[dim.refs[0] ?? ""];
      if (e && (e.type === "circle" || e.type === "arc")) {
        const c = getPoint(sketch, e.center);
        const r = e.type === "circle" ? e.radius : dist2(c, getPoint(sketch, e.start));
        const d = dist2(label, c) < 1e-9 ? { x: 1, y: 0 } : norm2(sub2(label, c));
        const on = projector.toScreen(add2(c, scale2(d, r)));
        const start =
          dim.type === "diameter"
            ? projector.toScreen(sub2(c, scale2(d, r)))
            : projector.toScreen(c);
        strokePolyline(ctx, [start, on]);
        strokePolyline(ctx, [on, sl]);
        arrow(ctx, on, start);
        if (dim.type === "diameter") arrow(ctx, start, on);
      } else {
        strokePolyline(ctx, [a, b]);
      }
    } else if (dim.type === "angle") {
      const v = anchor.points[0]!;
      const p1 = anchor.points[1]!;
      const p2 = anchor.points[2] ?? p1;
      const r = Math.max(dist2(v, label), projector.pixel(v) * 18);
      const a0 = Math.atan2(p1.y - v.y, p1.x - v.x);
      let a1 = Math.atan2(p2.y - v.y, p2.x - v.x);
      while (a1 < a0) a1 += Math.PI * 2;
      const steps = Math.max(8, Math.ceil(((a1 - a0) / Math.PI) * 32));
      const arc: ScreenPoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        arc.push(projector.toScreen({ x: v.x + r * Math.cos(a), y: v.y + r * Math.sin(a) }));
      }
      strokePolyline(ctx, arc);
      if (arc.length > 2) {
        arrow(ctx, arc[0]!, arc[1]!);
        arrow(ctx, arc[arc.length - 1]!, arc[arc.length - 2]!);
      }
      ctx.globalAlpha = 0.6;
      const sv = projector.toScreen(v);
      strokePolyline(ctx, [sv, arc[0]!]);
      strokePolyline(ctx, [sv, arc[arc.length - 1]!]);
      ctx.globalAlpha = 1;
    }

    const w = ctx.measureText(text).width + 10;
    const h = 17;
    ctx.fillStyle = selected || hover ? color : "rgba(255,255,255,0.94)";
    ctx.beginPath();
    ctx.roundRect(sl.x - w / 2, sl.y - h / 2, w, h, 3);
    ctx.fill();
    if (!selected && !hover) {
      ctx.strokeStyle = conflict ? SKETCH_COLORS.conflict : "rgba(74, 88, 102, 0.35)";
      ctx.stroke();
    }
    ctx.fillStyle = selected || hover ? "#fff" : color;
    ctx.fillText(text, sl.x, sl.y + 0.5);
    hits.push({ kind: "dimension", id: dim.id, x: sl.x - w / 2, y: sl.y - h / 2, w, h });
  }
}

export function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  at: ScreenPoint,
  kind: string,
  inferred?: string,
): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SKETCH_COLORS.preview;
  ctx.fillStyle = "rgba(47, 158, 107, 0.15)";
  ctx.beginPath();
  if (kind === "point" || kind === "center") {
    ctx.rect(at.x - 5, at.y - 5, 10, 10);
  } else if (kind === "midpoint") {
    ctx.moveTo(at.x, at.y - 6);
    ctx.lineTo(at.x + 6, at.y + 5);
    ctx.lineTo(at.x - 6, at.y + 5);
    ctx.closePath();
  } else if (kind === "curve") {
    ctx.moveTo(at.x - 5, at.y - 5);
    ctx.lineTo(at.x + 5, at.y + 5);
    ctx.moveTo(at.x + 5, at.y - 5);
    ctx.lineTo(at.x - 5, at.y + 5);
  } else {
    ctx.arc(at.x, at.y, 2, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (inferred) {
    ctx.font = "600 10px Inter, system-ui, sans-serif";
    ctx.fillStyle = SKETCH_COLORS.preview;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(inferred === "horizontal" ? "H" : "V", at.x + 10, at.y - 10);
  }
}

/** Entities connected to `start` through shared end points (for Offset). */
export function connectedChain(sketch: Sketch, start: string): string[] {
  const first = sketch.entities[start];
  if (!first || !isCurve(first)) return [];
  if (first.type === "circle" || first.type === "ellipse" || first.type === "spline") return [start];
  const usable = Object.values(sketch.entities).filter(
    (e) => (e.type === "line" || e.type === "arc") && !e.construction === !first.construction,
  );
  const ends = (id: string): string[] => {
    const e = sketch.entities[id];
    if (!e) return [];
    if (e.type === "line") return [e.p1, e.p2];
    if (e.type === "arc") return [e.start, e.end];
    return entityPointIds(e);
  };
  const chain = [start];
  const seen = new Set(chain);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of usable) {
      if (seen.has(e.id)) continue;
      const mine = ends(e.id);
      if (chain.some((id) => ends(id).some((p) => mine.includes(p)))) {
        chain.push(e.id);
        seen.add(e.id);
        grew = true;
      }
    }
  }
  return chain;
}
