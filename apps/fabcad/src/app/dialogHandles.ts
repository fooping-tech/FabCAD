import { type BodyGeometry, faceEdges } from "@fabcad/brep";
import {
  type CadDocument,
  type PlaneReference,
  type Scope,
  evaluateAs,
  featureOutputBodies,
} from "@fabcad/cad-document";
import {
  type PlanePatch,
  facePlanePatch,
  originPlanePatch,
  resolveEdgeRef,
  resolveFaceRef,
  resolveSketchPlane,
} from "@fabcad/features";
import {
  type Vec3,
  add3,
  dot3,
  len3,
  norm3,
  planeToWorld,
  scale3,
  sub3,
} from "@fabcad/geometry";
import { type Sketch, resolveProfileRefs, sketchBounds } from "@fabcad/sketch";
import type { Dialog, SourcePick } from "./appState";
import { bodiesCenter, formatValue, resolveMoveAxis } from "./moveTransform";
import type { BodyModel } from "./session";
import { sketchView } from "./session";

/**
 * Handles in the view that set a value of the open dialog by dragging, as the arrow of Extrude
 * does: an arrow for a length along a direction, a ring for an angle about an axis. Pure: what
 * the dialog refers to is resolved from the arguments. The view draws the handles and turns a
 * drag into a value; `patch` writes the value back into the dialog.
 */

interface HandleBase {
  /** Tells the handles of one dialog apart (the field the handle sets). */
  key: string;
  /** Value of the field now (mm or degrees). */
  value: number;
  /** Dragging cannot take the value below the smallest step (radius, depth, thickness). */
  positive?: boolean;
  patch: (value: number) => Partial<Dialog>;
}

export interface LinearHandle extends HandleBase {
  kind: "linear";
  /** Foot of the arrow and its unit direction. */
  origin: Vec3;
  direction: Vec3;
  /** The tip of the arrow is at `factor · value` along the direction. */
  factor: number;
}

export interface AngularHandle extends HandleBase {
  kind: "angular";
  /** A point on the axis and its unit direction; the value turns counter-clockwise about it. */
  center: Vec3;
  axis: Vec3;
  /** Unit vector square to the axis where the angle is zero. */
  reference: Vec3;
  /** Radius of the ring (mm): the distance of what turns from the axis. Null: a fixed size. */
  radius: number | null;
}

export type DialogHandle = LinearHandle | AngularHandle;

export interface HandleContext {
  doc: CadDocument;
  bodies: Record<string, BodyModel>;
  /** Construction planes as evaluated, by feature id. */
  planes: Record<string, PlanePatch>;
  scope: Scope;
}

const number = (expression: string, kind: "length" | "angle" | "none", scope: Scope): number | null => {
  try {
    const v = evaluateAs(expression, kind, scope);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

const sketchOf = (ctx: HandleContext, id: string | null): Sketch | null => {
  const f = id ? ctx.doc.features[id] : undefined;
  return f?.type === "sketch" ? f.sketch : null;
};

/** World position of a point entity of a sketch. */
function sketchPoint(ctx: HandleContext, sketchId: string, entityId: string): Vec3 | null {
  const sketch = sketchOf(ctx, sketchId);
  const e = sketch?.entities[entityId];
  return sketch && e?.type === "point" ? planeToWorld(resolveSketchPlane(sketch.plane), e) : null;
}

/** Centre of what a sketch draws, on its plane. */
function sketchCenter(sketch: Sketch): Vec3 | null {
  const b = sketchBounds(sketch);
  return b
    ? planeToWorld(resolveSketchPlane(sketch.plane), { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 })
    : null;
}

/** The patch of a plane reference as the view shows it. */
export function referencePatch(ref: PlaneReference, ctx: HandleContext): PlanePatch | null {
  if (ref.type === "origin-plane") return originPlanePatch(ref.plane);
  if (ref.type === "plane") return ctx.planes[ref.featureId] ?? null;
  const body = ctx.bodies[ref.bodyId];
  const found = body ? resolveFaceRef(ref.ref, body) : null;
  return body && found ? facePlanePatch(body.geometry, found.index) : null;
}

/** Where the source of a pattern is: the bodies, or what the features drew. */
function sourceAnchor(dialog: SourcePick, ctx: HandleContext): Vec3 | null {
  if (dialog.sourceKind === "bodies") return bodiesCenter(ctx.bodies, dialog.bodyIds);
  const points: Vec3[] = [];
  for (const id of dialog.featureIds) {
    const f = ctx.doc.features[id];
    if (!f) continue;
    const sketch = "sketchId" in f && typeof f.sketchId === "string" ? sketchOf(ctx, f.sketchId) : null;
    const at =
      f.type === "hole"
        ? average(f.points.map((p) => sketchPoint(ctx, f.sketchId, p)).filter((p): p is Vec3 => !!p))
        : sketch
          ? sketchCenter(sketch)
          : bodiesCenter(ctx.bodies, featureOutputBodies(f));
    if (at) points.push(at);
  }
  return average(points);
}

const average = (points: Vec3[]): Vec3 | null =>
  points.length > 0 ? scale3(points.reduce(add3), 1 / points.length) : null;

/** The ring of an angle about an axis, standing where `at` turns. */
function ring(
  key: string,
  axis: { origin: Vec3; direction: Vec3 },
  at: Vec3 | null,
  value: number,
  patch: (value: number) => Partial<Dialog>,
): AngularHandle {
  const direction = norm3(axis.direction);
  const from = at ?? axis.origin;
  const center = add3(axis.origin, scale3(direction, dot3(sub3(from, axis.origin), direction)));
  const out = sub3(from, center);
  const radius = len3(out);
  let reference: Vec3;
  if (radius > 1e-6) {
    reference = scale3(out, 1 / radius);
  } else {
    // On the axis: any direction square to it.
    const helper = Math.abs(direction.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const c = sub3(helper, scale3(direction, dot3(helper, direction)));
    reference = norm3(c);
  }
  return { kind: "angular", key, center, axis: direction, reference, radius: radius > 1e-6 ? radius : null, value, patch };
}

/** The normal of a face of the mesh at the vertex nearest `p`. */
function normalNear(g: BodyGeometry, faceIndex: number, p: Vec3): Vec3 | null {
  const face = g.faces[faceIndex];
  if (!face) return null;
  let best = -1;
  let bestD = Infinity;
  for (let k = face.start; k < face.start + face.count; k++) {
    const v = g.indices[k]!;
    const d = Math.hypot(g.positions[v * 3]! - p.x, g.positions[v * 3 + 1]! - p.y, g.positions[v * 3 + 2]! - p.z);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best < 0 ? null : norm3({ x: g.normals[best * 3]!, y: g.normals[best * 3 + 1]!, z: g.normals[best * 3 + 2]! });
}

/** The handles of the open dialog; none for dialogs without a value to drag. */
export function dialogHandles(dialog: Dialog | null, ctx: HandleContext): DialogHandle[] {
  if (!dialog) return [];
  const { scope } = ctx;
  switch (dialog.type) {
    case "extrude":
      return extrudeHandle(dialog, ctx);
    case "offset-plane": {
      const base = dialog.base ? referencePatch(dialog.base, ctx) : null;
      const offset = number(dialog.offset, "length", scope);
      if (!base || offset === null) return [];
      return [
        {
          kind: "linear",
          key: "offset",
          origin: base.center,
          direction: base.plane.normal,
          factor: 1,
          value: offset,
          patch: (v) => ({ offset: formatValue(v) }),
        },
      ];
    }
    case "revolve": {
      const sketch = sketchOf(ctx, dialog.sketchId);
      const angle = number(dialog.angle, "angle", scope);
      if (!sketch || !dialog.axis || angle === null) return [];
      const plane = resolveSketchPlane(sketch.plane);
      let axis: { origin: Vec3; direction: Vec3 };
      if (dialog.axis.type === "origin-axis") {
        axis = { origin: { x: 0, y: 0, z: 0 }, direction: worldAxis(dialog.axis.axis) };
      } else {
        const line = sketch.entities[dialog.axis.entityId];
        const a = line?.type === "line" ? sketch.entities[line.p1] : undefined;
        const b = line?.type === "line" ? sketch.entities[line.p2] : undefined;
        if (a?.type !== "point" || b?.type !== "point") return [];
        const from = planeToWorld(plane, a);
        const to = planeToWorld(plane, b);
        if (len3(sub3(to, from)) < 1e-9) return [];
        axis = { origin: from, direction: norm3(sub3(to, from)) };
      }
      const regions = sketchView(sketch, ctx.doc).regions;
      const region = dialog.profiles.flatMap((r) => resolveProfileRefs(regions, r))[0];
      const at = region ? planeToWorld(plane, region.interiorPoint) : sketchCenter(sketch);
      return [ring("angle", axis, at, angle, (v) => ({ angle: formatValue(Math.max(-360, Math.min(360, v))) }))];
    }
    case "hole": {
      if (dialog.extent !== "distance" || !dialog.sketchId || !dialog.bodyId) return [];
      const sketch = sketchOf(ctx, dialog.sketchId);
      const point = dialog.points[0] ? sketchPoint(ctx, dialog.sketchId, dialog.points[0]) : null;
      const depth = number(dialog.depth, "length", scope);
      const body = ctx.bodies[dialog.bodyId];
      if (!sketch || !point || depth === null || !body) return [];
      // The direction the feature engine drills in (`holeDirection`).
      const plane = resolveSketchPlane(sketch.plane);
      let direction = scale3(plane.normal, -1);
      if (sketch.plane.type !== "face") {
        const { min, max } = body.geometry.bounds;
        const heights = [min.x, max.x].flatMap((x) =>
          [min.y, max.y].flatMap((y) =>
            [min.z, max.z].map((z) => dot3(sub3({ x, y, z }, plane.origin), plane.normal)),
          ),
        );
        if (Math.min(...heights) > -1e-6 && Math.max(...heights) > 1e-6) direction = plane.normal;
      }
      if (dialog.flip) direction = scale3(direction, -1);
      return [
        {
          kind: "linear",
          key: "depth",
          origin: point,
          direction,
          factor: 1,
          value: depth,
          positive: true,
          patch: (v) => ({ depth: formatValue(v) }),
        },
      ];
    }
    case "fillet":
    case "chamfer": {
      const body = dialog.bodyId ? ctx.bodies[dialog.bodyId] : undefined;
      const ref = dialog.edges[0];
      const value = number(dialog.value, "length", scope);
      if (!body || !ref || value === null) return [];
      const found = resolveEdgeRef(ref, body);
      const edge = found ? body.geometry.edges[found.index] : undefined;
      if (!edge) return [];
      // Into the body, halfway between the two faces that meet at the edge.
      const g = body.geometry;
      const normals = g.faces
        .filter((f) => faceEdges(g, f.faceIndex).some((e) => e.edgeIndex === edge.edgeIndex))
        .map((f) => normalNear(g, f.faceIndex, edge.midpoint))
        .filter((n): n is Vec3 => !!n);
      if (normals.length === 0) return [];
      const sum = normals.reduce(add3);
      if (len3(sum) < 1e-9) return [];
      return [
        {
          kind: "linear",
          key: "value",
          origin: edge.midpoint,
          direction: scale3(norm3(sum), -1),
          factor: 1,
          value,
          positive: true,
          patch: (v) => ({ value: formatValue(v) }),
        },
      ];
    }
    case "shell": {
      const body = dialog.bodyId ? ctx.bodies[dialog.bodyId] : undefined;
      const ref = dialog.faces[0];
      const value = number(dialog.value, "length", scope);
      if (!body || !ref || value === null) return [];
      const found = resolveFaceRef(ref, body);
      const face = found ? body.geometry.faces[found.index] : undefined;
      if (!face) return [];
      // The wall grows inwards from the faces of the body.
      return [
        {
          kind: "linear",
          key: "value",
          origin: face.center,
          direction: scale3(norm3(face.normal), -1),
          factor: 1,
          value,
          positive: true,
          patch: (v) => ({ value: formatValue(v) }),
        },
      ];
    }
    case "rectangular-pattern": {
      const at = sourceAnchor(dialog, ctx);
      if (!at) return [];
      const out: DialogHandle[] = [];
      const row = (
        key: "distance" | "distance2",
        direction: typeof dialog.direction,
        count: string,
        distance: string,
        flip: boolean,
      ): void => {
        const axis = direction ? resolveMoveAxis(direction, ctx) : null;
        const n = number(count, "none", scope);
        const d = number(distance, "length", scope);
        if (!axis || n === null || d === null) return;
        // The arrow ends at the last instance; dragging it changes the spacing.
        out.push({
          kind: "linear",
          key,
          origin: at,
          direction: flip ? scale3(axis.direction, -1) : axis.direction,
          factor: Math.max(1, Math.round(n) - 1),
          value: d,
          patch: (v) => ({ [key]: formatValue(v) }),
        });
      };
      row("distance", dialog.direction, dialog.count, dialog.distance, dialog.flip);
      if (dialog.second) row("distance2", dialog.direction2, dialog.count2, dialog.distance2, dialog.flip2);
      return out;
    }
    case "circular-pattern": {
      const axis = dialog.axis ? resolveMoveAxis(dialog.axis, ctx) : null;
      const angle = number(dialog.angle, "angle", scope);
      if (!axis || angle === null) return [];
      const direction = dialog.flip ? scale3(axis.direction, -1) : axis.direction;
      return [
        ring("angle", { origin: axis.origin, direction }, sourceAnchor(dialog, ctx), angle, (v) => ({
          angle: formatValue(Math.max(-360, Math.min(360, v))),
        })),
      ];
    }
    default:
      return [];
  }
}

const worldAxis = (name: "X" | "Y" | "Z"): Vec3 =>
  name === "X" ? { x: 1, y: 0, z: 0 } : name === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };

/** The arrow of Extrude: along the sketch normal, from a point inside the profiles. */
function extrudeHandle(dialog: Extract<Dialog, { type: "extrude" }>, ctx: HandleContext): DialogHandle[] {
  const sketch = sketchOf(ctx, dialog.sketchId);
  if (!sketch || dialog.profiles.length === 0) return [];
  const regions = sketchView(sketch, ctx.doc).regions;
  const picked = dialog.profiles.flatMap((r) => resolveProfileRefs(regions, r));
  if (picked.length === 0) return [];
  const distance = number(dialog.distance, "length", ctx.scope);
  const plane = resolveSketchPlane(sketch.plane);
  // The largest profile carries the arrow.
  const main = picked.reduce((a, b) => (b.area > a.area ? b : a));
  const factor = dialog.direction === "symmetric" ? 0.5 : dialog.direction === "negative" ? -1 : 1;
  return [
    {
      kind: "linear",
      key: "distance",
      origin: planeToWorld(plane, main.interiorPoint),
      direction: plane.normal,
      factor,
      // A symmetric extrusion is as long on both sides: the arrow cannot cross the sketch.
      value: distance ?? 0,
      positive: dialog.direction === "symmetric",
      patch: (v) => ({ distance: formatValue(v) }),
    },
  ];
}
