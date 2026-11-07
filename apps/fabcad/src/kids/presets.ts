import {
  type CadDocument,
  type Command,
  type CreatedRef,
  addExtrude,
  addSketch,
  addSphere,
  applySketchEdit,
  command,
  evaluateParameters,
  parameterScope,
  setSketchVisible,
} from "@fabcad/cad-document";
import { solveSketchWithParameters } from "@fabcad/features";
import type { Vec2 } from "@fabcad/geometry";
import {
  createCircle,
  createRectangleCenter,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";
import type { SketchSolver } from "@fabcad/sketch-solver";

/**
 * The shapes of the Kids Mode "かたち" menu. They are not primitives of their own: each one is
 * built from the ordinary commands (a dimensioned sketch and an Extrude, or a Sphere), in one
 * undo step, so the result is plain history that the normal screen edits like any other.
 */
export type KidsShape = "box" | "cylinder" | "ball";

/** Size of a new shape (mm): its width, diameter and height. */
export const KIDS_SHAPE_SIZE = 20;

export interface PresetOptions {
  /** Where the shape stands on the XY plane (its centre). */
  at: Vec2;
  componentId?: string;
  size?: number;
}

/**
 * The command that makes a shape. `out` receives the feature that made the body (`id`) and the
 * body (`bodyId`).
 */
export function kidsShapeCommand(
  shape: KidsShape,
  solver: SketchSolver,
  options: PresetOptions,
  out: CreatedRef = {},
): Command {
  const size = options.size ?? KIDS_SHAPE_SIZE;
  const { x, y } = options.at;
  if (shape === "ball") {
    return command("Ball", (doc) =>
      addSphere(
        {
          center: { x: num(x), y: num(y), z: num(size / 2) },
          diameter: num(size),
          componentId: options.componentId,
        },
        out,
      ).apply(doc),
    );
  }
  return command(shape === "box" ? "Box" : "Cylinder", (doc) => {
    const sketch: CreatedRef = {};
    let d = addSketch({ type: "origin", plane: "XY" }, sketch, options.componentId).apply(doc);
    if (!sketch.id) return doc;
    const sketchId = sketch.id;
    d = applySketchEdit(d, sketchId, (s) =>
      editSketch(s, (b) => {
        if (shape === "box") {
          const made = createRectangleCenter(b, { x, y }, { x: x + size / 2, y: y + size / 2 });
          const center = made.points[4]!;
          b.constrain("fix", center);
          b.dimension("distance", [made.entities[0]!], num(size), {
            labelPosition: { x, y: y + size / 2 + 4 },
          });
          b.dimension("distance", [made.entities[1]!], num(size), {
            labelPosition: { x: x - size / 2 - 4, y },
          });
        } else {
          const made = createCircle(b, { x, y }, size / 2);
          b.constrain("fix", made.points[0]!);
          b.dimension("diameter", [made.entities[0]!], num(size), {
            labelPosition: { x: x + size / 2 + 4, y: y + size / 2 + 4 },
          });
        }
      }),
    );
    d = solveSketch(d, sketchId, solver);
    const solved = d.features[sketchId];
    if (!solved || solved.type !== "sketch") return doc;
    const region = regionAtPoint(detectProfiles(solved.sketch), { x, y });
    if (!region) return doc;
    const extruded = addExtrude(
      { sketchId, profiles: [profileRefOf(region)], distance: num(size), operation: "new" },
      out,
    ).apply(d);
    if (extruded === d) return doc;
    // Like Extrude from the toolbar, the sketch is hidden once the body is made of it.
    return setSketchVisible(sketchId, false).apply(extruded);
  });
}

/** The document always stores solved sketches. */
function solveSketch(doc: CadDocument, sketchId: string, solver: SketchSolver): CadDocument {
  const scope = parameterScope(evaluateParameters(doc.parameters));
  return applySketchEdit(doc, sketchId, (s) => {
    const info = solveSketchWithParameters(s, solver, scope);
    return info.converged ? info.sketch : s;
  });
}

/** A number as an expression, without float noise. */
const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * Where a new shape goes: to the right of everything there is, with a gap, so that it does
 * not land inside another shape. `maxX` is the largest X of the bodies, or null for none.
 */
export function nextShapeSpot(maxX: number | null, size = KIDS_SHAPE_SIZE): Vec2 {
  if (maxX === null || !Number.isFinite(maxX)) return { x: 0, y: 0 };
  return { x: Math.ceil((maxX + 10 + size / 2) / 5) * 5, y: 0 };
}
