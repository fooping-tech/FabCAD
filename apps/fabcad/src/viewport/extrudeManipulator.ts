import { type CadDocument, evaluateAs } from "@fabcad/cad-document";
import { resolveSketchPlane } from "@fabcad/features";
import type { Plane3, Vec2 } from "@fabcad/geometry";
import { resolveProfileRefs } from "@fabcad/sketch";
import type { Dialog } from "../app/appState";
import { currentScope, sketchView } from "../app/session";

/**
 * The translucent preview of the Extrude command. Its arrow is one of the dialog handles
 * (`app/dialogHandles.ts`).
 */

export type ExtrudeDialog = Extract<Dialog, { type: "extrude" }>;

export interface ExtrudeManipulator {
  plane: Plane3;
  /** Extent of the extrusion along the normal. */
  from: number;
  to: number;
  /** Evaluated distance, or null while the expression is invalid. */
  distance: number | null;
  regions: { outer: Vec2[]; holes: Vec2[][] }[];
  removing: boolean;
}

export function extrudeManipulator(
  doc: CadDocument,
  dialog: ExtrudeDialog,
): ExtrudeManipulator | null {
  if (!dialog.sketchId || dialog.profiles.length === 0) return null;
  const f = doc.features[dialog.sketchId];
  if (!f || f.type !== "sketch") return null;
  const all = sketchView(f.sketch, doc).regions;
  const picked = new Map<string, (typeof all)[number]>();
  for (const ref of dialog.profiles) {
    for (const r of resolveProfileRefs(all, ref)) picked.set(r.id, r);
  }
  const regions = [...picked.values()];
  if (regions.length === 0) return null;

  let distance: number | null = null;
  try {
    distance = evaluateAs(dialog.distance, "length", currentScope(doc));
  } catch {
    distance = null;
  }
  const d = distance ?? 0;
  const [from, to] =
    dialog.direction === "symmetric" ? [-d / 2, d / 2] : dialog.direction === "negative" ? [-d, 0] : [0, d];

  return {
    plane: resolveSketchPlane(f.sketch.plane),
    from,
    to,
    distance,
    regions: regions.map((r) => ({ outer: r.polygon, holes: r.holePolygons })),
    removing: dialog.operation === "cut",
  };
}

/** Drag increment: a round number of millimetres that is a few pixels on screen. */
export function dragStep(pixelSize: number): number {
  const raw = Math.max(pixelSize * 4, 1e-6);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  return Math.max(0.1, step);
}

