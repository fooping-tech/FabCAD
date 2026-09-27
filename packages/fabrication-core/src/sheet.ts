import { type Bounds2, type Vec2, boundsOfPoints, degToRad } from "@fabcad/geometry";
import type {
  FlatPart,
  PartPlacement,
  PlacedLabel,
  PlacedPath,
  SheetGeometry,
  SheetLayout,
} from "./types";

/**
 * Coordinate convention (the one place where part frames meet sheet coordinates)
 * -----------------------------------------------------------------------------
 * Part frame: millimetres, X right, Y UP, drawn as the part is seen from its OUTSIDE face
 * (the face normal points at the viewer).
 *
 * Sheet frame: millimetres, origin at the top-left corner, X right, Y DOWN (SVG convention).
 *
 * A placement maps a part point `p` to the sheet in two steps:
 *
 *   1. rotate `p` counter-clockwise by `rotation` degrees about the part frame origin
 *      (counter-clockwise in the part frame, i.e. as seen on screen), giving `r`;
 *   2. sheet = (placement.x + r.x, placement.y − r.y).
 *
 * Negating Y exactly cancels the change from a Y-up to a Y-down axis, so the picture on the
 * sheet is the same picture as in the part frame: parts are cut as seen from the outside face
 * and are NOT mirrored. (Copying part coordinates unchanged into a Y-down sheet would mirror
 * every part.) `placement.x / y` is therefore the sheet position of the part frame origin.
 */
export function placePoint(p: Vec2, placement: Pick<PartPlacement, "x" | "y" | "rotation">): Vec2 {
  const r = rotatePartPoint(p, placement.rotation);
  return { x: placement.x + r.x, y: placement.y - r.y };
}

/** Step 1 of the placement transform; exact for multiples of 90°. */
export function rotatePartPoint(p: Vec2, rotationDeg: number): Vec2 {
  const turns = ((rotationDeg % 360) + 360) % 360;
  if (turns === 0) return { x: p.x, y: p.y };
  if (turns === 90) return { x: -p.y, y: p.x };
  if (turns === 180) return { x: -p.x, y: -p.y };
  if (turns === 270) return { x: p.y, y: -p.x };
  const a = degToRad(turns);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** All points of the final manufacturing paths of a part (falls back to the raw outline). */
export function partPathPoints(part: FlatPart): Vec2[] {
  const pts: Vec2[] = [];
  for (const path of part.paths) for (const p of path.points) pts.push(p);
  if (pts.length === 0) for (const p of part.outline) pts.push(p);
  return pts;
}

/** Bounds on the sheet of a placed part. */
export function placedBounds(part: FlatPart, placement: PartPlacement): Bounds2 {
  return boundsOfPoints(partPathPoints(part).map((p) => placePoint(p, placement)));
}

/**
 * Apply a layout to the parts' final `paths`. The result is THE single source of geometry for
 * the on-screen preview and for SVG / DXF export; exporters never transform parts themselves.
 */
export function resolveSheetGeometry(
  parts: FlatPart[],
  layout: SheetLayout,
  options: { labels?: boolean } = {},
): SheetGeometry {
  const withLabels = options.labels ?? true;
  const byId = new Map<string, FlatPart>();
  for (const part of parts) byId.set(part.id, part);
  const paths: PlacedPath[] = [];
  const labels: PlacedLabel[] = [];
  for (const placement of layout.placements) {
    const part = byId.get(placement.partId);
    if (!part) continue;
    for (const path of part.paths) {
      paths.push({
        ...path,
        points: path.points.map((p) => placePoint(p, placement)),
        partId: part.id,
        sheet: placement.sheet,
      });
    }
    if (withLabels) {
      const b = placedBounds(part, placement);
      if (Number.isFinite(b.minX)) {
        labels.push({
          partId: part.id,
          sheet: placement.sheet,
          text: part.name,
          position: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
        });
      }
    }
  }
  return { sheet: layout.sheet, sheetCount: layout.sheetCount, paths, labels };
}
