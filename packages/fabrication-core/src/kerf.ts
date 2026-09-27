import { type Vec2, cleanPolygon, offsetPolygon, signedArea } from "@fabcad/geometry";
import type { FlatPath } from "./types";

/**
 * Kerf compensation.
 *
 * The laser removes a strip of width `kerf` centred on the path. To get parts of nominal size:
 *
 * - closed `cut` paths that bound material from the outside (`outline`, closed `glue-tab`)
 *   GROW by kerf / 2,
 * - closed `cut` paths that bound a hole in the material (`hole`, `slot`) SHRINK by kerf / 2,
 * - open paths and `fold` / `engrave` paths are returned unchanged.
 *
 * The offset uses miter joins, so straight edges stay straight and parallel. Winding of the
 * input may be either orientation and is preserved.
 */
export function compensateKerf(paths: FlatPath[], kerf: number): FlatPath[] {
  if (!(kerf > 0)) return paths.map((p) => ({ ...p, points: p.points.slice() }));
  const half = kerf / 2;
  return paths.map((path) => {
    if (path.type !== "cut" || !path.closed || path.points.length < 3) {
      return { ...path, points: path.points.slice() };
    }
    const grows = path.role === "outline" || path.role === "glue-tab";
    const shrinks = path.role === "hole" || path.role === "slot";
    if (!grows && !shrinks) return { ...path, points: path.points.slice() };
    return { ...path, points: offsetClosed(path.points, grows ? -half : half) };
  });
}

/**
 * Offset a closed polygon; positive = towards its interior. Falls back to the input when the
 * polygon is too small to be offset (e.g. a slot narrower than the kerf).
 */
function offsetClosed(points: readonly Vec2[], inward: number): Vec2[] {
  const clean = cleanPolygon(points);
  if (clean.length < 3 || Math.abs(signedArea(clean)) < 1e-12) return points.slice();
  const result = offsetPolygon(clean, inward);
  if (result.collapsedEdges.length > 0) return points.slice();
  return result.polygon;
}
