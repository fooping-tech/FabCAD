import {
  type Curve2,
  curveBounds,
  curveEnd,
  curveStart,
  dist2,
  emptyBounds2,
  flattenCurve,
  unionBounds2,
} from "@fabcad/geometry";

/**
 * DXF export of 2D curves (e.g. a sketch), R12 compatible so that every laser and CAM program
 * can read it. Lines, arcs and circles are written as LINE, ARC and CIRCLE. R12 has no ellipse
 * or spline entity: those are written as polylines within `tolerance`.
 *
 * DXF is Y-up like the sketch, so coordinates are written unchanged, in millimetres.
 */
export interface CurveDxfOptions {
  /** Decimals of the coordinates. Default 4. */
  precision?: number;
  /** Largest deviation of polylines from ellipses and splines, in mm. Default 0.01. */
  tolerance?: number;
  layer?: string;
  /** AutoCAD colour index of the layer. Default 1 (red). */
  color?: number;
}

export interface CurveDxfInput {
  /** Curves of one entity, end to end. */
  curves: Curve2[];
}

export function renderCurvesDxf(inputs: CurveDxfInput[], options: CurveDxfOptions = {}): string {
  const precision = options.precision ?? 4;
  const tolerance = options.tolerance ?? 0.01;
  const layer = options.layer ?? "CUT";
  const out: string[] = [];
  const pair = (code: number, value: string | number): void => {
    out.push(String(code), typeof value === "number" ? String(value) : value);
  };
  const num = (value: number): string => {
    const text = value.toFixed(precision);
    return Number(text) === 0 ? (0).toFixed(precision) : text;
  };
  const degrees = (radians: number): string => {
    const d = ((radians * 180) / Math.PI) % 360;
    return num(d < 0 ? d + 360 : d);
  };

  const bounds = emptyBounds2();
  let any = false;
  for (const input of inputs) {
    for (const c of input.curves) {
      Object.assign(bounds, unionBounds2(bounds, curveBounds(c)));
      any = true;
    }
  }
  if (!any) Object.assign(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 });

  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1009");
  pair(9, "$INSUNITS");
  pair(70, 4); // millimetres
  pair(9, "$EXTMIN");
  pair(10, num(bounds.minX));
  pair(20, num(bounds.minY));
  pair(30, num(0));
  pair(9, "$EXTMAX");
  pair(10, num(bounds.maxX));
  pair(20, num(bounds.maxY));
  pair(30, num(0));
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LTYPE");
  pair(70, 1);
  pair(0, "LTYPE");
  pair(2, "CONTINUOUS");
  pair(70, 0);
  pair(3, "Solid line");
  pair(72, 65);
  pair(73, 0);
  pair(40, num(0));
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(70, 1);
  pair(0, "LAYER");
  pair(2, layer);
  pair(70, 0);
  pair(62, options.color ?? 1);
  pair(6, "CONTINUOUS");
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  pair(0, "SECTION");
  pair(2, "ENTITIES");
  for (const input of inputs) {
    // Consecutive free curves of one entity (a spline) form a single polyline.
    let run: Curve2[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const points = run.flatMap((c, i) => {
        const pts = flattenCurve(c, tolerance);
        return i === 0 ? pts : pts.slice(1);
      });
      const closed = points.length > 2 && dist2(points[0]!, points[points.length - 1]!) <= 1e-6;
      if (closed) points.pop();
      pair(0, "POLYLINE");
      pair(8, layer);
      pair(66, 1);
      pair(10, num(0));
      pair(20, num(0));
      pair(30, num(0));
      pair(70, closed ? 1 : 0);
      for (const p of points) {
        pair(0, "VERTEX");
        pair(8, layer);
        pair(10, num(p.x));
        pair(20, num(p.y));
        pair(30, num(0));
      }
      pair(0, "SEQEND");
      pair(8, layer);
      run = [];
    };
    for (const c of input.curves) {
      if (c.type === "ellipseArc" || c.type === "bezier") {
        const last = run[run.length - 1];
        if (last && dist2(curveEnd(last), curveStart(c)) > 1e-6) flush();
        run.push(c);
        continue;
      }
      flush();
      if (c.type === "line") {
        pair(0, "LINE");
        pair(8, layer);
        pair(10, num(c.a.x));
        pair(20, num(c.a.y));
        pair(30, num(0));
        pair(11, num(c.b.x));
        pair(21, num(c.b.y));
        pair(31, num(0));
      } else if (Math.abs(c.sweep) >= 2 * Math.PI - 1e-9) {
        pair(0, "CIRCLE");
        pair(8, layer);
        pair(10, num(c.center.x));
        pair(20, num(c.center.y));
        pair(30, num(0));
        pair(40, num(c.radius));
      } else {
        // DXF arcs always run counter-clockwise from the start angle to the end angle.
        const from = c.sweep > 0 ? c.startAngle : c.startAngle + c.sweep;
        const to = c.sweep > 0 ? c.startAngle + c.sweep : c.startAngle;
        pair(0, "ARC");
        pair(8, layer);
        pair(10, num(c.center.x));
        pair(20, num(c.center.y));
        pair(30, num(0));
        pair(40, num(c.radius));
        pair(50, degrees(from));
        pair(51, degrees(to));
      }
    }
    flush();
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${out.join("\n")}\n`;
}
