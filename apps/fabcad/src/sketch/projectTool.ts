import {
  type BodyGeometry,
  type MeshEdgeGroup,
  edgePolyline,
  faceEdges,
  faceSilhouettes,
  polylineMidpoint,
} from "@fabcad/brep";
import { type BodyNames, makeEdgeRef, makeFaceRef, resolveSketchPlane } from "@fabcad/features";
import type { Plane3, TopologyRef, Vec3 } from "@fabcad/geometry";
import {
  type ProjectedShape,
  type Sketch,
  addProjection,
  projectCurve,
  projectedShapes,
  sameProjectedShape,
} from "@fabcad/sketch";
import { appState, toast } from "../app/appState";
import { documentStore, editSketchSolved, modelState } from "../app/session";

/** What the Project command accepts from the 3D view. */
export type ProjectPick =
  | { kind: "edge"; bodyId: string; edgeIndex: number }
  | { kind: "face"; bodyId: string; faceIndex: number }
  | { kind: "vertex"; bodyId: string; vertexIndex: number; point: Vec3 };

/** Add the projection of the picked geometry to a sketch. Pure: nothing is committed. */
export function projectInto(
  sketch: Sketch,
  plane: Plane3,
  geometry: BodyGeometry,
  pick: ProjectPick,
  names?: BodyNames,
): { sketch: Sketch; added: number; edges: number } {
  const edgeRef = (index: number): TopologyRef | undefined =>
    names ? (makeEdgeRef({ geometry, names }, index) ?? undefined) : undefined;
  const faceRef = (index: number): TopologyRef | undefined =>
    names ? (makeFaceRef({ geometry, names }, index) ?? undefined) : undefined;
  let edges: MeshEdgeGroup[] = [];
  if (pick.kind === "edge") {
    const e = geometry.edges[pick.edgeIndex];
    if (e) edges = [e];
  } else if (pick.kind === "face") {
    edges = faceEdges(geometry, pick.faceIndex);
  }
  let current = sketch;
  let added = 0;
  // Edges that land on the same place (the two seams of a cylinder seen from the side, or an
  // edge that is also a silhouette) are projected once, also across separate picks.
  const shapes: ProjectedShape[] = projectedShapes(sketch);
  const add = (
    points: Vec3[],
    source: "edge" | "vertex" | "silhouette",
    hint: Vec3,
    index: number,
    count: number,
    edge?: MeshEdgeGroup,
  ): void => {
    const shape = projectCurve(plane, points, edge?.bezier, edge);
    if (!shape || shapes.some((s) => sameProjectedShape(s, shape))) return;
    const ref = source === "edge" ? edgeRef(index) : source === "silhouette" ? faceRef(index) : undefined;
    const result = addProjection(current, shape, {
      bodyId: pick.bodyId,
      source,
      hint,
      index,
      count,
      ...(ref ? { ref } : {}),
    });
    if (!result) return;
    shapes.push(shape);
    current = result.sketch;
    added += 1;
  };
  if (pick.kind === "vertex") {
    add([pick.point], "vertex", pick.point, pick.vertexIndex, geometry.vertices.length / 3);
  }
  for (const e of edges) {
    add(edgePolyline(geometry, e), "edge", e.midpoint, e.edgeIndex, geometry.edges.length, e);
  }
  if (pick.kind === "face") {
    // The outline of a curved face also includes where it turns away from the sketch plane.
    for (const chain of faceSilhouettes(geometry, pick.faceIndex, plane.normal)) {
      add(chain, "silhouette", polylineMidpoint(chain), pick.faceIndex, geometry.faces.length);
    }
  }
  return { sketch: current, added, edges: edges.length };
}

/**
 * Project: put the picked edge, vertex or the outline of the picked face onto the plane of the
 * active sketch. Returns the number of projections that were added.
 */
export function projectPick(pick: ProjectPick): number {
  const sketchId = appState.get().activeSketchId;
  const feature = sketchId ? documentStore.document.features[sketchId] : undefined;
  const model = modelState.get().bodies[pick.bodyId];
  const geometry = model?.geometry;
  const names = model?.names;
  if (!sketchId || feature?.type !== "sketch" || !geometry) return 0;
  const plane = resolveSketchPlane(feature.sketch.plane);
  let added = 0;
  let edges = 0;
  const ok = editSketchSolved(sketchId, "Project", (sketch) => {
    const result = projectInto(sketch, plane, geometry, pick, names);
    added = result.added;
    edges = result.edges;
    return result.sketch;
  });
  if (!ok || added === 0) {
    toast(
      pick.kind === "face" && edges === 0
        ? "The outline of this face could not be determined."
        : "This geometry is already projected.",
      "warning",
    );
    return 0;
  }
  return added;
}
