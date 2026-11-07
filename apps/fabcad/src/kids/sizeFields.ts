import type { CadDocument, Feature } from "@fabcad/cad-document";
import type { Sketch, SketchDimension } from "@fabcad/sketch";
import { isPlainNumber } from "./kidsModel";

/**
 * The sizes of a body that the Kids Mode "おおきさ" panel can change: values the body was built
 * from, not a scale of the body (there is no such feature). A sphere has its diameter; an
 * extrusion its distance and the driving length dimensions of its sketch. Every change goes
 * through the same commands as in the normal screen, so it stays parametric.
 */
export type SizeField =
  | {
      kind: "feature";
      featureId: string;
      /** Key of the expression (`featureExpressions`). */
      key: string;
      label: string;
      expression: string;
    }
  | {
      kind: "dimension";
      sketchId: string;
      dimensionId: string;
      label: string;
      expression: string;
    };

export interface SizeFields {
  fields: SizeField[];
  /**
   * Why there is nothing (or not everything) to change here: the body was made by a feature
   * Kids Mode does not know, or its sizes are expressions of parameters.
   */
  limited: boolean;
}

export function sizeFields(doc: CadDocument, bodyId: string): SizeFields {
  const body = doc.bodies[bodyId];
  const feature: Feature | undefined = body ? doc.features[body.createdBy] : undefined;
  if (!feature) return { fields: [], limited: true };
  const out: SizeField[] = [];
  if (feature.type === "sphere") {
    out.push({
      kind: "feature",
      featureId: feature.id,
      key: "diameter",
      label: "ふとさ",
      expression: feature.diameter,
    });
  } else if (feature.type === "extrude") {
    const sketch = doc.features[feature.sketchId];
    if (sketch?.type === "sketch") {
      for (const d of Object.values(sketch.sketch.dimensions)) {
        const label = dimensionLabel(sketch.sketch, d);
        if (d.driving && label) {
          out.push({
            kind: "dimension",
            sketchId: sketch.id,
            dimensionId: d.id,
            label,
            expression: d.expression,
          });
        }
      }
    }
    if (!feature.to) {
      out.push({
        kind: "feature",
        featureId: feature.id,
        key: "distance",
        label: "たかさ",
        expression: feature.distance,
      });
    }
  } else {
    return { fields: [], limited: true };
  }
  const plain = out.filter((f) => isPlainNumber(f.expression));
  // A label used twice gets a number, so the child can tell the rows apart.
  const seen = new Map<string, number>();
  for (const f of plain) seen.set(f.label, (seen.get(f.label) ?? 0) + 1);
  const count = new Map<string, number>();
  const fields = plain.map((f) => {
    if ((seen.get(f.label) ?? 0) < 2) return f;
    const n = (count.get(f.label) ?? 0) + 1;
    count.set(f.label, n);
    return { ...f, label: `${f.label} ${n}` };
  });
  return { fields, limited: plain.length < out.length };
}

/** A name a child understands for a length dimension; null for angles. */
function dimensionLabel(sketch: Sketch, d: SketchDimension): string | null {
  switch (d.type) {
    case "angle":
      return null;
    case "diameter":
    case "radius":
      return "ふとさ";
    case "hdistance":
      return "よこ";
    case "vdistance":
      return "たて";
    case "distance": {
      const line = d.refs.length === 1 ? sketch.entities[d.refs[0]!] : undefined;
      if (line?.type === "line") {
        const a = sketch.entities[line.p1];
        const b = sketch.entities[line.p2];
        if (a?.type === "point" && b?.type === "point") {
          const dx = Math.abs(b.x - a.x);
          const dy = Math.abs(b.y - a.y);
          if (dy < 1e-6 * Math.max(1, dx)) return "よこ";
          if (dx < 1e-6 * Math.max(1, dy)) return "たて";
        }
      }
      return "ながさ";
    }
  }
}

/** The step of the + / − buttons and the range of the slider of a size, in mm. */
export const SIZE_STEP = 5;
export const SIZE_MIN = 1;
export const SIZE_SLIDER_MAX = 200;
