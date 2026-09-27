import {
  type Curve2,
  type Vec2,
  curveBounds,
  curveEnd,
  curvePointAt,
  curveStart,
  dist2,
  emptyBounds2,
  unionBounds2,
} from "@fabcad/geometry";

/**
 * SVG export of 2D curves (e.g. a sketch). Lines, arcs, ellipses and Béziers are written as
 * exact path commands, in millimetres. The Y axis is flipped: CAD is Y-up, SVG is Y-down.
 */

export interface CurveSvgOptions {
  /** Empty border around the geometry, in mm. Default 1. */
  margin?: number;
  /** Decimals. Default 3. */
  precision?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Id of the group that holds the paths. Default "cut". */
  group?: string;
}

export interface CurveSvgInput {
  /** Curves of one entity, end to end. They become one path. */
  curves: Curve2[];
  id?: string;
}

export function renderCurvesSvg(inputs: CurveSvgInput[], options: CurveSvgOptions = {}): string {
  const margin = options.margin ?? 1;
  const precision = options.precision ?? 3;
  const bounds = emptyBounds2();
  let any = false;
  for (const input of inputs) {
    for (const c of input.curves) {
      const b = curveBounds(c);
      Object.assign(bounds, unionBounds2(bounds, b));
      any = true;
    }
  }
  if (!any) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = 0;
    bounds.maxY = 0;
  }
  const width = bounds.maxX - bounds.minX + margin * 2;
  const height = bounds.maxY - bounds.minY + margin * 2;
  const n = (v: number): string => {
    const s = v.toFixed(precision).replace(/\.?0+$/, "");
    return s === "-0" || s === "" ? "0" : s;
  };
  const map = (p: Vec2): string =>
    `${n(p.x - bounds.minX + margin)} ${n(bounds.maxY - p.y + margin)}`;

  /** Arc command. Flipping Y turns counter-clockwise into clockwise, hence the sweep flag. */
  const arc = (rx: number, ry: number, rotation: number, sweep: number, end: Vec2): string => {
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    const flag = sweep > 0 ? 0 : 1;
    return `A${n(rx)} ${n(ry)} ${n((-rotation * 180) / Math.PI)} ${large} ${flag} ${map(end)}`;
  };

  const lines: string[] = [];
  for (const input of inputs) {
    const parts: string[] = [];
    let cursor: Vec2 | null = null;
    let first: Vec2 | null = null;
    for (const c of input.curves) {
      const start = curveStart(c);
      if (!cursor || dist2(cursor, start) > 1e-6) {
        parts.push(`M${map(start)}`);
        first = start;
      }
      switch (c.type) {
        case "line":
          parts.push(`L${map(c.b)}`);
          break;
        case "arc":
        case "ellipseArc": {
          const rx = c.type === "arc" ? c.radius : c.rx;
          const ry = c.type === "arc" ? c.radius : c.ry;
          const rotation = c.type === "arc" ? 0 : c.rotation;
          // A full turn has no distinct end point: write it as two halves.
          const pieces = Math.abs(c.sweep) > Math.PI * 1.999 ? 2 : 1;
          for (let i = 1; i <= pieces; i++) {
            parts.push(arc(rx, ry, rotation, c.sweep / pieces, curvePointAt(c, i / pieces)));
          }
          break;
        }
        case "bezier":
          parts.push(`C${map(c.p1)} ${map(c.p2)} ${map(c.p3)}`);
          break;
      }
      cursor = curveEnd(c);
    }
    if (parts.length === 0) continue;
    if (first && cursor && dist2(first, cursor) <= 1e-6) parts.push("Z");
    const id = input.id ? ` data-entity="${input.id}"` : "";
    lines.push(`    <path${id} d="${parts.join(" ")}"/>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}">`,
    `  <g id="${options.group ?? "cut"}" fill="none" stroke="${options.stroke ?? "#ff0000"}" stroke-width="${n(options.strokeWidth ?? 0.1)}" stroke-linejoin="round" stroke-linecap="round">`,
    ...lines,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}
