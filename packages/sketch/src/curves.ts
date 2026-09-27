import {
  type Curve2,
  type Vec2,
  controlSplineToBeziers,
  dist2,
  fitSplineToBeziers,
  normalizeAngle,
} from "@fabcad/geometry";
import type { CurveEntity, Sketch } from "./model";
import { getPoint } from "./edit";

/**
 * Convert a sketch curve entity into kernel-neutral curve segments. Lines, arcs and circles map
 * to one segment, ellipses to one full elliptical arc and splines to a chain of cubic Béziers.
 */
export function entityToCurves(sketch: Sketch, e: CurveEntity): Curve2[] {
  switch (e.type) {
    case "line":
      return [{ type: "line", a: getPoint(sketch, e.p1), b: getPoint(sketch, e.p2) }];
    case "circle":
      return [
        {
          type: "arc",
          center: getPoint(sketch, e.center),
          radius: e.radius,
          startAngle: 0,
          sweep: 2 * Math.PI,
        },
      ];
    case "arc": {
      const c = getPoint(sketch, e.center);
      const s = getPoint(sketch, e.start);
      const en = getPoint(sketch, e.end);
      const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
      const endAngle = Math.atan2(en.y - c.y, en.x - c.x);
      let sweep = normalizeAngle(endAngle - startAngle);
      if (sweep < 1e-12) sweep = 2 * Math.PI;
      return [{ type: "arc", center: c, radius: dist2(c, s), startAngle, sweep }];
    }
    case "ellipse": {
      const c = getPoint(sketch, e.center);
      const m = getPoint(sketch, e.majorPoint);
      return [
        {
          type: "ellipseArc",
          center: c,
          rx: dist2(c, m),
          ry: e.minorRadius,
          rotation: Math.atan2(m.y - c.y, m.x - c.x),
          startParam: 0,
          sweep: 2 * Math.PI,
        },
      ];
    }
    case "spline": {
      const pts: Vec2[] = e.points.map((p) => getPoint(sketch, p));
      return e.kind === "fit"
        ? fitSplineToBeziers(pts, e.closed)
        : controlSplineToBeziers(pts, e.closed);
    }
  }
}

export function arcRadius(sketch: Sketch, e: { center: string; start: string }): number {
  return dist2(getPoint(sketch, e.center), getPoint(sketch, e.start));
}
