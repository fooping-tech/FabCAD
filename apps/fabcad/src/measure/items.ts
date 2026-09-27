import { type BodyGeometry, edgePolyline, faceEdges } from "@fabcad/brep";
import type { CadDocument } from "@fabcad/cad-document";
import { resolveSketchPlane } from "@fabcad/features";
import {
  type MeasureItem,
  type MeasureResult,
  type MeasureValue,
  ORIGIN_PLANES,
  type Vec3,
  curveLength,
  dist2,
  flattenCurve,
  measureBetween,
  measureItem,
  planeToWorld,
  polygonPerimeter,
} from "@fabcad/geometry";
import { type SketchRegion, entityToCurves, getPoint } from "@fabcad/sketch";
import type { Selection } from "../app/appState";

/**
 * Measure works on what can be selected anyway: a pick is a `Selection`, reduced here to a
 * geometric primitive. The measurement is inspection state of the session and never part of
 * the document.
 */

export interface MeasureContext {
  doc: CadDocument;
  bodies: Record<string, { geometry: BodyGeometry } | undefined>;
  regions: (sketchId: string) => SketchRegion[];
}

export const isMeasurable = (s: Selection): boolean =>
  s.kind !== "constraint" && s.kind !== "dimension" && s.kind !== "feature";

export function measureItemOf(s: Selection, ctx: MeasureContext): MeasureItem | null {
  switch (s.kind) {
    case "vertex":
      return { kind: "point", at: s.point };
    case "edge": {
      const geometry = ctx.bodies[s.bodyId]?.geometry;
      const edge = geometry?.edges[s.edgeIndex];
      if (!geometry || !edge) return null;
      if (edge.curve === "line") return { kind: "segment", from: edge.from, to: edge.to };
      const points = edgePolyline(geometry, edge);
      if (edge.curve === "circle" && edge.radius !== undefined && edge.center) {
        return {
          kind: "circle",
          center: edge.center,
          radius: edge.radius,
          length: edge.length,
          closed: edge.closed,
          points,
        };
      }
      return { kind: "curve", points, length: edge.length, closed: edge.closed };
    }
    case "face": {
      const geometry = ctx.bodies[s.bodyId]?.geometry;
      const face = geometry?.faces[s.faceIndex];
      if (!geometry || !face) return null;
      const edges = faceEdges(geometry, s.faceIndex);
      const perimeter = edges.reduce((sum, e) => sum + e.length, 0);
      const points = edges.flatMap((e) => edgePolyline(geometry, e));
      return face.surface === "plane"
        ? { kind: "plane", point: face.center, normal: face.normal, area: face.area, perimeter, points }
        : { kind: "surface", area: face.area, perimeter, points };
    }
    case "body": {
      const geometry = ctx.bodies[s.bodyId]?.geometry;
      if (!geometry) return null;
      return {
        kind: "solid",
        volume: geometry.volume,
        area: geometry.area,
        min: geometry.bounds.min,
        max: geometry.bounds.max,
      };
    }
    case "origin-plane": {
      const plane = ORIGIN_PLANES[s.plane];
      return { kind: "plane", point: plane.origin, normal: plane.normal, points: [plane.origin] };
    }
    case "entity": {
      const f = ctx.doc.features[s.sketchId];
      if (f?.type !== "sketch") return null;
      const e = f.sketch.entities[s.entityId];
      if (!e) return null;
      const plane = resolveSketchPlane(f.sketch.plane);
      const world = (p: { x: number; y: number }): Vec3 => planeToWorld(plane, p);
      if (e.type === "point") return { kind: "point", at: world(e) };
      if (e.type === "line") {
        return {
          kind: "segment",
          from: world(getPoint(f.sketch, e.p1)),
          to: world(getPoint(f.sketch, e.p2)),
        };
      }
      const curves = entityToCurves(f.sketch, e);
      const points = curves.flatMap((c) => flattenCurve(c, 0.01)).map(world);
      const length = curves.reduce((sum, c) => sum + curveLength(c), 0);
      if (e.type === "circle" || e.type === "arc") {
        const center = getPoint(f.sketch, e.center);
        const radius = e.type === "circle" ? e.radius : dist2(center, getPoint(f.sketch, e.start));
        return {
          kind: "circle",
          center: world(center),
          radius,
          length,
          closed: e.type === "circle",
          points,
        };
      }
      const first = points[0];
      const last = points[points.length - 1];
      const closed =
        !!first && !!last && Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 1e-9;
      return { kind: "curve", points, length, closed };
    }
    case "profile": {
      const f = ctx.doc.features[s.sketchId];
      if (f?.type !== "sketch") return null;
      const region = ctx.regions(s.sketchId).find((r) => r.id === s.regionId);
      if (!region) return null;
      const plane = resolveSketchPlane(f.sketch.plane);
      const rings = [region.polygon, ...region.holePolygons];
      return {
        kind: "plane",
        point: planeToWorld(plane, region.interiorPoint),
        normal: plane.normal,
        area: region.area,
        perimeter: rings.reduce((sum, ring) => sum + polygonPerimeter(ring), 0),
        points: rings.flatMap((ring) =>
          [...ring, ring[0]!].map((p) => planeToWorld(plane, p)),
        ),
      };
    }
    default:
      return null;
  }
}

export function describePick(s: Selection, ctx: MeasureContext): string {
  const body = (id: string): string => ctx.doc.bodies[id]?.name ?? "Body";
  switch (s.kind) {
    case "vertex":
      return `Vertex of ${body(s.bodyId)}`;
    case "edge":
      return `Edge of ${body(s.bodyId)}`;
    case "face":
      return `Face of ${body(s.bodyId)}`;
    case "body":
      return body(s.bodyId);
    case "origin-plane":
      return `${s.plane} plane`;
    case "profile":
      return `Profile of ${ctx.doc.features[s.sketchId]?.name ?? "sketch"}`;
    case "entity": {
      const f = ctx.doc.features[s.sketchId];
      const e = f?.type === "sketch" ? f.sketch.entities[s.entityId] : undefined;
      const type = e ? e.type.charAt(0).toUpperCase() + e.type.slice(1) : "Entity";
      return `${type} of ${f?.name ?? "sketch"}`;
    }
    default:
      return "";
  }
}

export interface Measurement {
  picks: { selection: Selection; label: string; values: MeasureValue[] }[];
  between: MeasureResult | null;
}

export function measureSelection(selection: Selection[], ctx: MeasureContext): Measurement {
  const picks: Measurement["picks"] = [];
  const items: MeasureItem[] = [];
  for (const s of selection) {
    if (picks.length === 2) break;
    const item = measureItemOf(s, ctx);
    if (!item) continue;
    items.push(item);
    picks.push({ selection: s, label: describePick(s, ctx), values: measureItem(item) });
  }
  const [a, b] = items;
  return { picks, between: a && b ? measureBetween(a, b) : null };
}
