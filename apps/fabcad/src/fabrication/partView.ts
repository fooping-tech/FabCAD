import type { Bounds2 } from "@fabcad/geometry";
import {
  type EdgeConnection,
  type FlatPart,
  type JointType,
  type SheetGeometry,
  partPathPoints,
} from "@fabcad/fabrication-core";
import { formatNumber } from "./numberInput";

/** View models of the Parts and Sheet views (pure, no React). */

export const JOINT_LABEL: Record<JointType, string> = {
  "tab-slot": "tab-slot",
  flat: "flat",
  finger: "finger",
  fold: "fold",
  "glue-tab": "glue-tab",
  none: "none",
};

export interface PartLink {
  connectionId: string;
  /** e.g. `edge-0 ↔ top.edge-2 · tab-slot · 90°`. */
  text: string;
  otherPartId: string;
}

export interface PartInfo {
  part: FlatPart;
  width: number;
  height: number;
  joints: JointType[];
  links: PartLink[];
}

/** Edge id without the id of the part it belongs to: `body.panel-1.edge-3` → `edge-3`. */
export function shortEdgeId(edgeId: string, partId: string): string {
  return edgeId.startsWith(`${partId}.`) ? edgeId.slice(partId.length + 1) : edgeId;
}

/** Bounds of the final paths of a part, in the part frame (Y up). */
export function partBounds(part: FlatPart): Bounds2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of partPathPoints(part)) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Per part: size, joint types and mating edges, taken from the explicit connections. */
export function describeParts(
  parts: readonly FlatPart[],
  connections: readonly EdgeConnection[],
): PartInfo[] {
  const names = new Map<string, string>();
  for (const p of parts) names.set(p.id, p.name);
  const byPart = new Map<string, EdgeConnection[]>();
  const add = (partId: string, c: EdgeConnection): void => {
    const list = byPart.get(partId);
    if (list) {
      if (list[list.length - 1] !== c) list.push(c);
    } else byPart.set(partId, [c]);
  };
  for (const c of connections) {
    add(c.a.partId, c);
    add(c.b.partId, c);
  }
  return parts.map((part) => {
    const b = partBounds(part);
    const own = byPart.get(part.id) ?? [];
    const joints: JointType[] = [];
    const links: PartLink[] = [];
    for (const c of own) {
      if (!joints.includes(c.joint)) joints.push(c.joint);
      const mine = c.a.partId === part.id ? c.a : c.b;
      const other = c.a.partId === part.id ? c.b : c.a;
      const otherEdge = shortEdgeId(other.edgeId, other.partId);
      // Both ends on the same part (e.g. two edges of one paper net that are glued together).
      const target =
        other.partId === part.id ? otherEdge : `${names.get(other.partId) ?? other.partId}.${otherEdge}`;
      links.push({
        connectionId: c.id,
        otherPartId: other.partId,
        text:
          `${shortEdgeId(mine.edgeId, part.id)} ↔ ${target}` +
          ` · ${JOINT_LABEL[c.joint]} · ${formatNumber(c.angle, 1)}°`,
      });
    }
    return { part, width: b.maxX - b.minX, height: b.maxY - b.minY, joints, links };
  });
}

export interface PlacedPartBox {
  partId: string;
  sheet: number;
  /** Sheet coordinates (mm, origin top-left, Y down). */
  bounds: Bounds2;
}

/** Bounding boxes of the placed parts, from the same geometry that is drawn and exported. */
export function placedPartBoxes(geometry: SheetGeometry): PlacedPartBox[] {
  const boxes = new Map<string, PlacedPartBox>();
  for (const path of geometry.paths) {
    const key = `${path.sheet}:${path.partId}`;
    let box = boxes.get(key);
    if (!box) {
      box = {
        partId: path.partId,
        sheet: path.sheet,
        bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      };
      boxes.set(key, box);
    }
    const b = box.bounds;
    for (const p of path.points) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return [...boxes.values()].filter((box) => Number.isFinite(box.bounds.minX));
}

/** The smallest part box on `sheet` that contains the point, if any. */
export function hitPartBox(
  boxes: readonly PlacedPartBox[],
  sheet: number,
  x: number,
  y: number,
): PlacedPartBox | null {
  let best: PlacedPartBox | null = null;
  let bestArea = Infinity;
  for (const box of boxes) {
    if (box.sheet !== sheet) continue;
    const b = box.bounds;
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    const area = (b.maxX - b.minX) * (b.maxY - b.minY);
    if (area < bestArea) {
      best = box;
      bestArea = area;
    }
  }
  return best;
}
