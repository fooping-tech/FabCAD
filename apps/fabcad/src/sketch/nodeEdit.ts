import { type EntityId, type Sketch } from "@fabcad/sketch";

/** Editable sketch nodes. Cubic Bézier endpoints are anchors; their two interior points
 * are handles. A shared endpoint stays an anchor even when several curves use it.
 * Projected geometry is excluded because it is regenerated from its source body.
 */
export type NodeRole = "anchor" | "handle";

export function editableNodes(sketch: Sketch): Map<EntityId, NodeRole> {
  const projected = new Set(sketch.projections.flatMap((ref) => ref.entityIds));
  const nodes = new Map<EntityId, NodeRole>();
  const add = (id: EntityId, role: NodeRole): void => {
    if (sketch.entities[id]?.type !== "point") return;
    if (role === "anchor" || !nodes.has(id)) nodes.set(id, role);
  };
  for (const entity of Object.values(sketch.entities)) {
    if (projected.has(entity.id)) continue;
    if (entity.type === "line") {
      add(entity.p1, "anchor");
      add(entity.p2, "anchor");
    } else if (entity.type === "spline") {
      entity.points.forEach((id, index) => {
        const handle = entity.kind === "control" && entity.points.length === 4 && (index === 1 || index === 2);
        add(id, handle ? "handle" : "anchor");
      });
    }
  }
  return nodes;
}
