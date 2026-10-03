import {
  type AlignFeature,
  type AlignInput,
  type CadDocument,
  type CircularPatternFeature,
  type Command,
  type CreatedRef,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type HoleFeature,
  type LoftFeature,
  type LoftSection,
  type MirrorFeature,
  type MoveFeature,
  type MoveTransform,
  type OffsetPlaneFeature,
  type PatternAxis,
  type PatternSource,
  type ExtrudeTarget,
  type PlaneReference,
  type Point3Ref,
  type RectangularPatternFeature,
  type Scope,
  type SplitFeature,
  type SweepFeature,
  addAlign,
  addCircularPattern,
  addHole,
  addLoft,
  addMirror,
  addMove,
  addOffsetPlane,
  addRectangularPattern,
  addSplit,
  addSweep,
  evaluateAs,
  listBodies,
  updateFeature,
} from "@fabcad/cad-document";
import { type OriginPlaneName, type Vec2, curveEnd, curveStart, dist2 } from "@fabcad/geometry";
import {
  type EntityId,
  type ProfileRef,
  type Sketch,
  type SketchEntity,
  entityPointIds,
  entityToCurves,
} from "@fabcad/sketch";
import type {
  AlignDialog,
  CircularPatternDialog,
  Dialog,
  HoleDialog,
  LoftDialog,
  MirrorDialog,
  MoveDialog,
  OffsetPlaneDialog,
  OperationPick,
  RectangularPatternDialog,
  SolidDialog,
  SourcePick,
  SplitDialog,
  SweepDialog,
} from "./appState";

/**
 * The dialogs of Hole, the patterns, Mirror, Move/Copy, Align, Split Body, Sweep, Loft and
 * Offset Plane as plain functions of the dialog and the document: what the active input accepts, what a pick
 * does to the dialog, why it cannot be applied yet, and the command it turns into. Nothing here
 * touches the stores, so all of it can be tested without a browser.
 */

const SOLID_TYPES: ReadonlySet<string> = new Set<SolidDialog["type"]>([
  "hole",
  "rectangular-pattern",
  "circular-pattern",
  "mirror",
  "move",
  "align",
  "split",
  "sweep",
  "loft",
  "offset-plane",
]);

export const isSolidDialogType = (type: string): type is SolidDialog["type"] =>
  SOLID_TYPES.has(type);

export const isSolidDialog = (dialog: Dialog | null): dialog is SolidDialog =>
  dialog !== null && SOLID_TYPES.has(dialog.type);

// --------------------------------------------------------------------- sketches

const sketchOf = (doc: CadDocument, id: string | null): Sketch | null => {
  const f = id ? doc.features[id] : undefined;
  return f?.type === "sketch" ? f.sketch : null;
};

/** Points that no curve uses, the sketch origin left out: the ones drawn to place something. */
export function freePoints(sketch: Sketch): EntityId[] {
  const used = new Set<EntityId>();
  for (const e of Object.values(sketch.entities)) {
    if (e.type !== "point") for (const id of entityPointIds(e)) used.add(id);
  }
  return Object.values(sketch.entities)
    .filter((e) => e.type === "point" && e.id !== sketch.originId && !used.has(e.id))
    .map((e) => e.id);
}

const PATH_TOLERANCE = 1e-6;

/** Both ends of a curve that can be part of a path; null for points, ellipses and closed curves. */
function openEnds(sketch: Sketch, e: SketchEntity | undefined): [Vec2, Vec2] | null {
  if (!e || e.type === "point" || e.type === "ellipse") return null;
  let curves;
  try {
    curves = entityToCurves(sketch, e);
  } catch {
    return null;
  }
  const first = curves[0];
  const last = curves[curves.length - 1];
  if (!first || !last) return null;
  const ends: [Vec2, Vec2] = [curveStart(first), curveEnd(last)];
  return dist2(ends[0], ends[1]) < PATH_TOLERANCE ? null : ends;
}

/** Whether a sketch entity can be (part of) a sweep path. */
export function isPathCurve(e: SketchEntity | undefined): boolean {
  return e !== undefined && e.type !== "point" && e.type !== "ellipse";
}

/**
 * The chain of curves that `start` belongs to: what joins it end to end, in both directions,
 * up to the first point where the way is not unique (a branch) or ends. Curves meet where
 * their ends coincide, whether or not they share the point entity, which is how the feature
 * engine sees it. Construction geometry and normal geometry do not mix. A closed curve is a
 * chain by itself.
 */
export function pathChain(sketch: Sketch, start: EntityId): EntityId[] {
  const first = sketch.entities[start];
  if (!isPathCurve(first)) return [];
  if (!openEnds(sketch, first)) return [start];
  const pieces = Object.values(sketch.entities).flatMap((e) => {
    if (!e.construction !== !first?.construction) return [];
    const ends = openEnds(sketch, e);
    return ends ? [{ id: e.id, ends }] : [];
  });
  const meeting = (p: Vec2): typeof pieces =>
    pieces.filter((q) => q.ends.some((end) => dist2(end, p) < PATH_TOLERANCE));
  const chain = [start];
  const own = pieces.find((p) => p.id === start);
  if (!own) return chain;
  for (const side of [0, 1] as const) {
    let at = own.ends[side];
    let from = start;
    for (;;) {
      const here = meeting(at);
      // Exactly two curves meet: the one we came along and the one to go on with.
      if (here.length !== 2) break;
      const next = here.find((p) => p.id !== from);
      if (!next || chain.includes(next.id)) break;
      if (side === 0) chain.unshift(next.id);
      else chain.push(next.id);
      at = dist2(next.ends[0], at) < PATH_TOLERANCE ? next.ends[1] : next.ends[0];
      from = next.id;
    }
  }
  return chain;
}

/** Why the curves do not make a path, in the words of the feature engine; null when they do. */
export function pathProblem(sketch: Sketch, ids: readonly EntityId[]): string | null {
  if (ids.length === 0) return "Select a path";
  const pieces: [Vec2, Vec2][] = [];
  for (const id of new Set(ids)) {
    const e = sketch.entities[id];
    if (!e || e.type === "point") return "A curve of the path no longer exists. Select the path again";
    if (e.type === "ellipse") return "An ellipse cannot be a path. Use lines, arcs, circles or splines";
    const ends = openEnds(sketch, e);
    if (!ends) {
      // Closed: a path by itself.
      return ids.length > 1 ? "A closed curve cannot be joined by others. Select it alone" : null;
    }
    pieces.push(ends);
  }
  const ends = pieces.flat();
  const degree = (p: Vec2): number => ends.filter((q) => dist2(p, q) < PATH_TOLERANCE).length;
  if (ends.some((p) => degree(p) > 2)) return "The path branches. Remove one of the curves";
  if (ends.filter((p) => degree(p) === 1).length > 2) {
    return "The curves of the path are not connected end to end";
  }
  return null;
}

// ------------------------------------------------------------------- topology

/** Feature that made a face, from the persistent names of the body. */
export function featureOfFace(
  names: { faces: readonly { feature: string }[] } | undefined,
  faceIndex: number,
): string | null {
  return names?.faces[faceIndex]?.feature || null;
}

/**
 * Whether a feature can be the source of the pattern or mirror in the dialog: a feature other
 * than a sketch that comes before the one being edited.
 */
export function canRepeatFeature(
  doc: CadDocument,
  dialog: { editing: string | null },
  featureId: string,
): boolean {
  const f = doc.features[featureId];
  if (!f || f.type === "sketch" || f.type === "offset-plane") return false;
  if (featureId === dialog.editing) return false;
  if (!dialog.editing) return true;
  const own = doc.timeline.indexOf(dialog.editing);
  return own < 0 || doc.timeline.indexOf(featureId) < own;
}

/**
 * The body a hole in this sketch is meant for: the body of the face the sketch lies on,
 * otherwise the only body there is.
 */
export function holeBody(doc: CadDocument, sketchId: string | null): string | null {
  const plane = sketchOf(doc, sketchId)?.plane;
  if (plane?.type === "face" && doc.bodies[plane.bodyId]) return plane.bodyId;
  const bodies = listBodies(doc);
  const visible = bodies.filter((b) => b.visible);
  if (visible.length === 1) return visible[0]!.id;
  return bodies.length === 1 ? bodies[0]!.id : null;
}

// ---------------------------------------------------------------------- picking

/** What the active input of a dialog accepts. Everything else is ignored by the viewport. */
export interface PickWants {
  bodies?: boolean;
  faces?: "any" | "planar";
  /** "linear": straight edges; "axis": straight or circular ones. */
  edges?: "linear" | "axis";
  vertices?: boolean;
  /** Origin planes and construction planes. */
  originPlanes?: boolean;
  sketchPoints?: boolean;
  sketchLines?: boolean;
  /** Curves that can be part of a path. */
  sketchCurves?: boolean;
  profiles?: boolean;
  /** Features, picked in the timeline or through one of their faces. */
  features?: boolean;
}

const SOURCE = (dialog: SourcePick): PickWants =>
  dialog.sourceKind === "bodies" ? { bodies: true } : { features: true, faces: "any" };
const DIRECTION: PickWants = { edges: "linear", sketchLines: true };
const AXIS: PickWants = { edges: "axis", sketchLines: true };
const PLANE: PickWants = { faces: "planar", originPlanes: true };
const POINT: PickWants = { vertices: true, sketchPoints: true };

/** What Extrude can go up to: a plane, a flat face, a vertex or a sketch point. */
export const EXTRUDE_TO_WANTS: PickWants = { ...PLANE, ...POINT };

/** The target of an extrusion from a pick; null for anything else. */
export function pickExtrudeTarget(
  picked: Picked,
  ctx: PickContext,
  dialog: { editing: string | null },
): ExtrudeTarget | null {
  return pickPlane(picked, ctx, dialog) ?? pickPoint(picked, ctx);
}

export function dialogWants(dialog: SolidDialog): PickWants {
  switch (dialog.type) {
    case "hole":
      return dialog.picking === "body" ? { bodies: true } : { sketchPoints: true };
    case "rectangular-pattern":
      return dialog.picking === "source" ? SOURCE(dialog) : DIRECTION;
    case "circular-pattern":
      return dialog.picking === "source" ? SOURCE(dialog) : AXIS;
    case "mirror":
      return dialog.picking === "source" ? SOURCE(dialog) : PLANE;
    case "move":
      if (dialog.picking === "bodies") return { bodies: true };
      if (dialog.picking === "axis") return dialog.mode === "rotate" ? AXIS : {};
      return dialog.mode === "point-to-point" ? POINT : {};
    case "align":
      if (dialog.mode === "face-to-face") return { faces: "planar" };
      // The point on the body that moves is one of its vertices: that tells which body it is.
      return dialog.picking === "from" ? { vertices: true } : POINT;
    case "split":
      return dialog.picking === "body" ? { bodies: true } : PLANE;
    case "sweep":
      return dialog.picking === "profile" ? { profiles: true } : { sketchCurves: true };
    case "loft":
      return { profiles: true, faces: "planar" };
    case "offset-plane":
      return PLANE;
  }
}

/** Something picked in the viewport, the timeline or the browser, ready to be stored. */
export type Picked =
  | { kind: "body"; bodyId: string }
  | {
      kind: "face";
      bodyId: string;
      faceIndex: number;
      ref: FaceRef;
      planar: boolean;
      /** Feature that made the face. */
      featureId: string | null;
    }
  | { kind: "edge"; bodyId: string; ref: EdgeRef; curve: "line" | "circle" | "other" }
  | { kind: "vertex"; ref: Extract<Point3Ref, { type: "vertex" }> }
  | { kind: "origin-plane"; plane: OriginPlaneName }
  | { kind: "plane"; featureId: string }
  | { kind: "entity"; sketchId: string; entityId: EntityId }
  | { kind: "profile"; sketchId: string; ref: ProfileRef }
  | { kind: "feature"; featureId: string };

export interface PickContext {
  doc: CadDocument;
  /** Shift / Ctrl / Cmd held: a path curve is toggled by itself, not with its chain. */
  additive?: boolean;
  /** Index of the face a reference points at in the body as it is now, or -1. */
  faceIndexOf?: (bodyId: string, ref: FaceRef) => number;
}

export const sameProfile = (a: ProfileRef, b: ProfileRef): boolean =>
  a.textId !== undefined || b.textId !== undefined
    ? a.textId === b.textId
    : a.entityIds.length === b.entityIds.length &&
      a.entityIds.every((e) => b.entityIds.includes(e)) &&
      Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) < 1e-6;

const toggled = <T>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

function pickSource(
  dialog: Extract<SolidDialog, SourcePick>,
  picked: Picked,
  ctx: PickContext,
): Partial<SourcePick> | null {
  if (dialog.sourceKind === "bodies") {
    if (picked.kind !== "body" || !ctx.doc.bodies[picked.bodyId]) return null;
    return { bodyIds: toggled(dialog.bodyIds, picked.bodyId) };
  }
  const featureId =
    picked.kind === "feature" ? picked.featureId : picked.kind === "face" ? picked.featureId : null;
  if (!featureId || !canRepeatFeature(ctx.doc, dialog, featureId)) return null;
  return { featureIds: toggled(dialog.featureIds, featureId) };
}

function pickAxis(picked: Picked, ctx: PickContext, circular: boolean): PatternAxis | null {
  if (picked.kind === "edge") {
    if (picked.curve === "line" || (circular && picked.curve === "circle")) {
      return { type: "edge", bodyId: picked.bodyId, ref: picked.ref };
    }
    return null;
  }
  if (picked.kind === "entity") {
    const e = sketchOf(ctx.doc, picked.sketchId)?.entities[picked.entityId];
    if (e?.type === "line") {
      return { type: "sketch-line", sketchId: picked.sketchId, entityId: picked.entityId };
    }
  }
  return null;
}

/**
 * Whether a construction plane can be referred to by the feature in the dialog: it must come
 * before the feature being edited, which also keeps a plane from referring to itself.
 */
export function canUsePlane(
  doc: CadDocument,
  dialog: { editing: string | null },
  featureId: string,
): boolean {
  const f = doc.features[featureId];
  if (f?.type !== "offset-plane" || featureId === dialog.editing) return false;
  if (!dialog.editing) return true;
  const own = doc.timeline.indexOf(dialog.editing);
  return own < 0 || doc.timeline.indexOf(featureId) < own;
}

function pickPlane(
  picked: Picked,
  ctx: PickContext,
  dialog: { editing: string | null },
): PlaneReference | null {
  if (picked.kind === "origin-plane") return { type: "origin-plane", plane: picked.plane };
  // A construction plane, picked in the view or as a feature in the timeline or the browser.
  if (picked.kind === "plane" || picked.kind === "feature") {
    return canUsePlane(ctx.doc, dialog, picked.featureId)
      ? { type: "plane", featureId: picked.featureId }
      : null;
  }
  if (picked.kind === "face" && picked.planar) {
    return { type: "face", bodyId: picked.bodyId, ref: picked.ref };
  }
  return null;
}

function pickPoint(picked: Picked, ctx: PickContext): Point3Ref | null {
  if (picked.kind === "vertex") return picked.ref;
  if (picked.kind === "entity") {
    const e = sketchOf(ctx.doc, picked.sketchId)?.entities[picked.entityId];
    if (e?.type === "point") {
      return { type: "sketch-point", sketchId: picked.sketchId, entityId: picked.entityId };
    }
  }
  return null;
}

function pickProfile(
  dialog: { sketchId: string | null; profiles: ProfileRef[] },
  picked: Picked,
): { sketchId: string; profiles: ProfileRef[] } | null {
  if (picked.kind !== "profile") return null;
  // A profile of another sketch replaces what was picked before.
  if (dialog.sketchId !== picked.sketchId) return { sketchId: picked.sketchId, profiles: [picked.ref] };
  const exists = dialog.profiles.some((r) => sameProfile(r, picked.ref));
  return {
    sketchId: picked.sketchId,
    profiles: exists
      ? dialog.profiles.filter((r) => !sameProfile(r, picked.ref))
      : [...dialog.profiles, picked.ref],
  };
}

function pickPath(dialog: SweepDialog, picked: Picked, ctx: PickContext): Partial<SweepDialog> | null {
  if (picked.kind !== "entity") return null;
  const sketch = sketchOf(ctx.doc, picked.sketchId);
  if (!sketch || !isPathCurve(sketch.entities[picked.entityId])) return null;
  const same = dialog.pathSketchId === picked.sketchId;
  const current = same ? dialog.path : [];
  if (ctx.additive) {
    return { pathSketchId: picked.sketchId, path: toggled(current, picked.entityId) };
  }
  const chain = pathChain(sketch, picked.entityId);
  // Clicking a curve of the path again takes its chain out; any other curve starts anew.
  if (current.includes(picked.entityId)) {
    return { pathSketchId: picked.sketchId, path: current.filter((id) => !chain.includes(id)) };
  }
  return { pathSketchId: picked.sketchId, path: chain };
}

function sameSection(a: LoftSection, b: LoftSection, ctx: PickContext): boolean {
  if (a.type === "profile" || b.type === "profile") {
    return (
      a.type === "profile" &&
      b.type === "profile" &&
      a.sketchId === b.sketchId &&
      sameProfile(a.profile, b.profile)
    );
  }
  if (a.bodyId !== b.bodyId) return false;
  if (!ctx.faceIndexOf) return JSON.stringify(a.ref) === JSON.stringify(b.ref);
  const index = ctx.faceIndexOf(a.bodyId, a.ref);
  return index >= 0 && index === ctx.faceIndexOf(b.bodyId, b.ref);
}

/**
 * What a pick changes in the dialog, or null when the active input has no use for it. The
 * result is a patch of the dialog the pick was made for.
 */
export function applyPick(
  dialog: SolidDialog,
  picked: Picked,
  ctx: PickContext,
): Partial<SolidDialog> | null {
  switch (dialog.type) {
    case "hole": {
      if (dialog.picking === "body") {
        if (picked.kind !== "body" || !ctx.doc.bodies[picked.bodyId]) return null;
        const patch: Partial<HoleDialog> = {
          bodyId: picked.bodyId,
          bodyAuto: false,
          picking: "points",
        };
        return patch;
      }
      if (picked.kind !== "entity") return null;
      const e = sketchOf(ctx.doc, picked.sketchId)?.entities[picked.entityId];
      if (e?.type !== "point") return null;
      const other = dialog.sketchId !== picked.sketchId;
      const patch: Partial<HoleDialog> = {
        sketchId: picked.sketchId,
        // Points of another sketch replace the set: a hole has one sketch.
        points: other ? [picked.entityId] : toggled(dialog.points, picked.entityId),
      };
      if (other && (dialog.bodyAuto || !dialog.bodyId)) {
        patch.bodyId = holeBody(ctx.doc, picked.sketchId) ?? dialog.bodyId;
      }
      return patch;
    }
    case "rectangular-pattern": {
      if (dialog.picking === "source") return pickSource(dialog, picked, ctx);
      const direction = pickAxis(picked, ctx, false);
      if (!direction) return null;
      const patch: Partial<RectangularPatternDialog> =
        dialog.picking === "direction" ? { direction } : { direction2: direction };
      return patch;
    }
    case "circular-pattern": {
      if (dialog.picking === "source") return pickSource(dialog, picked, ctx);
      const axis = pickAxis(picked, ctx, true);
      const patch: Partial<CircularPatternDialog> | null = axis ? { axis } : null;
      return patch;
    }
    case "mirror": {
      if (dialog.picking === "source") return pickSource(dialog, picked, ctx);
      const plane = pickPlane(picked, ctx, dialog);
      const patch: Partial<MirrorDialog> | null = plane ? { plane } : null;
      return patch;
    }
    case "move": {
      let patch: Partial<MoveDialog> | null = null;
      if (dialog.picking === "bodies") {
        if (picked.kind === "body" && ctx.doc.bodies[picked.bodyId]) {
          patch = { bodyIds: toggled(dialog.bodyIds, picked.bodyId) };
        }
      } else if (dialog.picking === "axis") {
        const axis = dialog.mode === "rotate" ? pickAxis(picked, ctx, true) : null;
        if (axis) patch = { axis };
      } else if (dialog.mode === "point-to-point") {
        const point = pickPoint(picked, ctx);
        if (point) patch = dialog.picking === "from" ? { from: point, picking: "to" } : { to: point };
      }
      return patch;
    }
    case "align": {
      let patch: Partial<AlignDialog> | null = null;
      if (dialog.mode === "face-to-face") {
        if (picked.kind !== "face" || !picked.planar) return null;
        patch =
          dialog.picking === "from"
            ? { bodyId: picked.bodyId, fromFace: picked.ref, picking: "to" }
            : { toFace: { bodyId: picked.bodyId, ref: picked.ref } };
      } else if (dialog.picking === "from") {
        if (picked.kind === "vertex") {
          patch = { bodyId: picked.ref.bodyId, fromPoint: picked.ref, picking: "to" };
        }
      } else {
        const point = pickPoint(picked, ctx);
        if (point) patch = { toPoint: point };
      }
      return patch;
    }
    case "split": {
      let patch: Partial<SplitDialog> | null = null;
      if (dialog.picking === "body") {
        if (picked.kind === "body" && ctx.doc.bodies[picked.bodyId]) {
          patch = { bodyId: picked.bodyId, picking: "tool" };
        }
      } else {
        const tool = pickPlane(picked, ctx, dialog);
        if (tool) patch = { tool };
      }
      return patch;
    }
    case "sweep": {
      if (dialog.picking === "path") return pickPath(dialog, picked, ctx);
      const patch: Partial<SweepDialog> | null = pickProfile(dialog, picked);
      return patch;
    }
    case "loft": {
      let section: LoftSection | null = null;
      if (picked.kind === "profile") {
        section = { type: "profile", sketchId: picked.sketchId, profile: picked.ref };
      } else if (picked.kind === "face" && picked.planar) {
        section = { type: "face", bodyId: picked.bodyId, ref: picked.ref };
      }
      if (!section) return null;
      const added = section;
      const exists = dialog.sections.some((s) => sameSection(s, added, ctx));
      const patch: Partial<LoftDialog> = {
        sections: exists
          ? dialog.sections.filter((s) => !sameSection(s, added, ctx))
          : [...dialog.sections, added],
      };
      return patch;
    }
    case "offset-plane": {
      const base = pickPlane(picked, ctx, dialog);
      const patch: Partial<OffsetPlaneDialog> | null = base ? { base } : null;
      return patch;
    }
  }
}

/** The input to fill next: the first one that is still empty. */
export function nextPicking<D extends SolidDialog>(dialog: D): D {
  const at = (picking: string): D => ({ ...dialog, picking }) as D;
  const sourceEmpty = (d: SourcePick): boolean =>
    (d.sourceKind === "bodies" ? d.bodyIds : d.featureIds).length === 0;
  switch (dialog.type) {
    case "hole":
      return at(dialog.points.length > 0 && !dialog.bodyId ? "body" : "points");
    case "rectangular-pattern":
      if (sourceEmpty(dialog) || dialog.direction) return at("source");
      return at("direction");
    case "circular-pattern":
      return at(sourceEmpty(dialog) || dialog.axis ? "source" : "axis");
    case "mirror":
      return at(sourceEmpty(dialog) || dialog.plane ? "source" : "plane");
    case "move":
      if (dialog.bodyIds.length === 0) return at("bodies");
      if (dialog.mode === "rotate") return at(dialog.axis ? "bodies" : "axis");
      if (dialog.mode === "point-to-point") return at(dialog.from ? "to" : "from");
      return at("bodies");
    case "align":
      return at((dialog.mode === "face-to-face" ? dialog.fromFace : dialog.fromPoint) ? "to" : "from");
    case "split":
      return at(dialog.bodyId ? "tool" : "body");
    case "sweep":
      return at(dialog.profiles.length > 0 ? "path" : "profile");
    case "loft":
    case "offset-plane":
      return dialog;
  }
}

// ------------------------------------------------------------------ references

/** Everything a dialog refers to, for highlighting it in the viewport. */
export interface DialogReferences {
  bodies: string[];
  faces: { bodyId: string; ref: FaceRef }[];
  edges: { bodyId: string; ref: EdgeRef }[];
  points: Extract<Point3Ref, { type: "vertex" | "fixed" }>[];
  originPlanes: OriginPlaneName[];
  /** Construction planes, by feature id. */
  planes: string[];
  /** Features whose faces are highlighted. */
  features: string[];
  entities: { sketchId: string; entityId: EntityId }[];
  profiles: { sketchId: string; ref: ProfileRef }[];
}

export function dialogReferences(dialog: SolidDialog): DialogReferences {
  const out: DialogReferences = {
    bodies: [],
    faces: [],
    edges: [],
    points: [],
    originPlanes: [],
    planes: [],
    features: [],
    entities: [],
    profiles: [],
  };
  const source = (d: SourcePick): void => {
    if (d.sourceKind === "bodies") out.bodies.push(...d.bodyIds);
    else out.features.push(...d.featureIds);
  };
  const axis = (a: PatternAxis | null): void => {
    if (a?.type === "edge") out.edges.push({ bodyId: a.bodyId, ref: a.ref });
    else if (a?.type === "sketch-line") out.entities.push({ sketchId: a.sketchId, entityId: a.entityId });
  };
  const plane = (p: PlaneReference | null): void => {
    if (p?.type === "origin-plane") out.originPlanes.push(p.plane);
    else if (p?.type === "face") out.faces.push({ bodyId: p.bodyId, ref: p.ref });
    else if (p?.type === "plane") out.planes.push(p.featureId);
  };
  const point = (p: Point3Ref | null): void => {
    if (p?.type === "sketch-point") out.entities.push({ sketchId: p.sketchId, entityId: p.entityId });
    else if (p) out.points.push(p);
  };
  switch (dialog.type) {
    case "hole":
      if (dialog.bodyId) out.bodies.push(dialog.bodyId);
      if (dialog.sketchId) {
        for (const entityId of dialog.points) out.entities.push({ sketchId: dialog.sketchId, entityId });
      }
      break;
    case "rectangular-pattern":
      source(dialog);
      axis(dialog.direction);
      if (dialog.second) axis(dialog.direction2);
      break;
    case "circular-pattern":
      source(dialog);
      axis(dialog.axis);
      break;
    case "mirror":
      source(dialog);
      plane(dialog.plane);
      break;
    case "move":
      out.bodies.push(...dialog.bodyIds);
      if (dialog.mode === "rotate") axis(dialog.axis);
      if (dialog.mode === "point-to-point") {
        point(dialog.from);
        point(dialog.to);
      }
      break;
    case "align":
      if (dialog.mode === "face-to-face") {
        if (dialog.bodyId && dialog.fromFace) out.faces.push({ bodyId: dialog.bodyId, ref: dialog.fromFace });
        if (dialog.toFace) out.faces.push(dialog.toFace);
      } else {
        point(dialog.fromPoint);
        point(dialog.toPoint);
      }
      break;
    case "split":
      if (dialog.bodyId) out.bodies.push(dialog.bodyId);
      plane(dialog.tool);
      break;
    case "sweep":
      if (dialog.sketchId) {
        for (const ref of dialog.profiles) out.profiles.push({ sketchId: dialog.sketchId, ref });
      }
      if (dialog.pathSketchId) {
        for (const entityId of dialog.path) {
          out.entities.push({ sketchId: dialog.pathSketchId, entityId });
        }
      }
      break;
    case "loft":
      for (const s of dialog.sections) {
        if (s.type === "profile") out.profiles.push({ sketchId: s.sketchId, ref: s.profile });
        else out.faces.push({ bodyId: s.bodyId, ref: s.ref });
      }
      break;
    case "offset-plane":
      plane(dialog.base);
      break;
  }
  return out;
}

/** Sketches a dialog refers to: they are shown while it is open, hidden or not. */
export function dialogSketches(dialog: SolidDialog): Set<string> {
  const refs = dialogReferences(dialog);
  return new Set([...refs.entities.map((e) => e.sketchId), ...refs.profiles.map((p) => p.sketchId)]);
}

// ------------------------------------------------------------------ validation

type Rule = "positive" | "not-zero" | "any";

function valueOf(
  expression: string,
  kind: "length" | "angle" | "none",
  scope: Scope,
): { value: number; error: null } | { value: null; error: string } {
  try {
    const value = evaluateAs(expression, kind, scope);
    if (!Number.isFinite(value)) return { value: null, error: "Not a number" };
    return { value, error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function check(
  label: string,
  expression: string,
  kind: "length" | "angle" | "none",
  scope: Scope,
  rule: Rule = "positive",
): string | null {
  const v = valueOf(expression, kind, scope);
  if (v.error !== null) return `${label}: ${v.error}`;
  if (rule === "positive" && !(v.value > 0)) return `${label} must be greater than zero`;
  if (rule === "not-zero" && Math.abs(v.value) < 1e-9) return `${label} must not be zero`;
  return null;
}

function checkCount(label: string, expression: string, scope: Scope): string | null {
  const v = valueOf(expression, "none", scope);
  if (v.error !== null) return `${label}: ${v.error}`;
  // The engine rounds to a whole number of instances, the original included.
  return Math.round(v.value) < 1 ? `${label} must be at least 1` : null;
}

function sourceProblem(dialog: SourcePick, doc: CadDocument): string | null {
  if (dialog.sourceKind === "bodies") {
    return dialog.bodyIds.some((b) => doc.bodies[b]) ? null : "Select a body";
  }
  return dialog.featureIds.some((f) => doc.features[f]) ? null : "Select a feature";
}

function operationProblem(dialog: OperationPick): string | null {
  return dialog.operation !== "new" && dialog.targetBodyIds.length === 0
    ? "Select a target body"
    : null;
}

const sameAxis = (a: PatternAxis, b: PatternAxis): boolean =>
  a.type === "origin-axis" && b.type === "origin-axis" && a.axis === b.axis;

/** Reason why the dialog cannot be applied yet, or null when it is complete. */
export function solidDialogProblem(dialog: SolidDialog, doc: CadDocument, scope: Scope): string | null {
  switch (dialog.type) {
    case "hole": {
      if (!dialog.sketchId || dialog.points.length === 0) return "Select a sketch point";
      if (!dialog.bodyId || !doc.bodies[dialog.bodyId]) return "Select the body to drill";
      const diameter = valueOf(dialog.diameter, "length", scope);
      const problem =
        check("Diameter", dialog.diameter, "length", scope) ??
        (dialog.extent === "distance" ? check("Depth", dialog.depth, "length", scope) : null);
      if (problem || diameter.value === null) return problem;
      if (dialog.holeType === "counterbore") {
        const wide = valueOf(dialog.counterboreDiameter, "length", scope);
        return (
          check("Counterbore diameter", dialog.counterboreDiameter, "length", scope) ??
          check("Counterbore depth", dialog.counterboreDepth, "length", scope) ??
          (wide.value !== null && wide.value <= diameter.value
            ? "The counterbore must be wider than the hole"
            : null)
        );
      }
      if (dialog.holeType === "countersink") {
        const wide = valueOf(dialog.countersinkDiameter, "length", scope);
        const angle = valueOf(dialog.countersinkAngle, "angle", scope);
        return (
          check("Countersink diameter", dialog.countersinkDiameter, "length", scope) ??
          check("Countersink angle", dialog.countersinkAngle, "angle", scope) ??
          (wide.value !== null && wide.value <= diameter.value
            ? "The countersink must be wider than the hole"
            : angle.value !== null && angle.value >= 180
              ? "Countersink angle must be less than 180 deg"
              : null)
        );
      }
      return null;
    }
    case "rectangular-pattern": {
      const first =
        sourceProblem(dialog, doc) ??
        (dialog.direction ? null : "Select a direction") ??
        checkCount("Count", dialog.count, scope) ??
        check("Distance", dialog.distance, "length", scope, "not-zero");
      if (first || !dialog.second) return first;
      if (!dialog.direction2) return "Select the second direction";
      if (dialog.direction && sameAxis(dialog.direction, dialog.direction2)) {
        return "The two directions are the same. Select another second direction";
      }
      return (
        checkCount("Second count", dialog.count2, scope) ??
        check("Second distance", dialog.distance2, "length", scope, "not-zero")
      );
    }
    case "circular-pattern":
      return (
        sourceProblem(dialog, doc) ??
        (dialog.axis ? null : "Select an axis") ??
        checkCount("Count", dialog.count, scope) ??
        check("Angle", dialog.angle, "angle", scope, "not-zero")
      );
    case "mirror":
      return sourceProblem(dialog, doc) ?? (dialog.plane ? null : "Select a mirror plane");
    case "move": {
      if (!dialog.bodyIds.some((b) => doc.bodies[b])) return "Select a body";
      if (dialog.mode === "translate" || dialog.mode === "free") {
        const free = dialog.mode === "free";
        const problem =
          check("X", dialog.x, "length", scope, "any") ??
          check("Y", dialog.y, "length", scope, "any") ??
          check("Z", dialog.z, "length", scope, "any") ??
          (free
            ? (check("X Angle", dialog.rx, "angle", scope, "any") ??
              check("Y Angle", dialog.ry, "angle", scope, "any") ??
              check("Z Angle", dialog.rz, "angle", scope, "any"))
            : null);
        if (problem) return problem;
        const zero = (e: string, kind: "length" | "angle"): boolean =>
          Math.abs(valueOf(e, kind, scope).value ?? 0) < 1e-9;
        const still =
          [dialog.x, dialog.y, dialog.z].every((e) => zero(e, "length")) &&
          (!free || [dialog.rx, dialog.ry, dialog.rz].every((e) => zero(e, "angle")));
        if (!still) return null;
        return free ? "Enter a distance or an angle, or drag the manipulator" : "Enter a distance";
      }
      if (dialog.mode === "rotate") {
        return (
          (dialog.axis ? null : "Select an axis") ??
          check("Angle", dialog.angle, "angle", scope, "not-zero")
        );
      }
      if (!dialog.from) return "Select the point to move from";
      return dialog.to ? null : "Select the point to move to";
    }
    case "align":
      if (dialog.mode === "face-to-face") {
        if (!dialog.bodyId || !dialog.fromFace) return "Select a flat face of the body that moves";
        if (!dialog.toFace) return "Select the face to align with";
        return dialog.toFace.bodyId === dialog.bodyId
          ? "Select a face of another body to align with"
          : null;
      }
      if (!dialog.bodyId || !dialog.fromPoint) return "Select a vertex of the body that moves";
      return dialog.toPoint ? null : "Select the point to align with";
    case "split":
      if (!dialog.bodyId || !doc.bodies[dialog.bodyId]) return "Select the body to split";
      return dialog.tool ? null : "Select a splitting plane";
    case "sweep": {
      if (!dialog.sketchId || dialog.profiles.length === 0) return "Select a profile";
      const sketch = sketchOf(doc, dialog.pathSketchId);
      if (!sketch || dialog.path.length === 0) return "Select a path";
      return pathProblem(sketch, dialog.path) ?? operationProblem(dialog);
    }
    case "loft":
      if (dialog.sections.length < 2) {
        return dialog.sections.length === 0 ? "Select the sections" : "Select a second section";
      }
      return operationProblem(dialog);
    case "offset-plane":
      if (!dialog.base) return "Select a flat face or a plane";
      return check("Offset", dialog.offset, "length", scope, "any");
  }
}

// -------------------------------------------------------- features and dialogs

const SOURCE_OF = (source: PatternSource): SourcePick => ({
  sourceKind: source.kind,
  featureIds: source.kind === "features" ? source.featureIds : [],
  bodyIds: source.kind === "bodies" ? source.bodyIds : [],
});

const sourceOf = (dialog: SourcePick): PatternSource =>
  dialog.sourceKind === "bodies"
    ? { kind: "bodies", bodyIds: dialog.bodyIds }
    : { kind: "features", featureIds: dialog.featureIds };

const MOVE_DEFAULTS = { x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0", angle: "90", pivot: null };

/** The dialog that edits a feature; null for the features that have their own dialogs. */
export function dialogFromFeature(f: Feature): SolidDialog | null {
  switch (f.type) {
    case "hole":
      return {
        type: "hole",
        editing: f.id,
        bodyId: f.bodyId,
        bodyAuto: false,
        sketchId: f.sketchId,
        points: f.points,
        holeType: f.holeType,
        diameter: f.diameter,
        extent: f.extent,
        depth: f.depth,
        counterboreDiameter: f.counterboreDiameter,
        counterboreDepth: f.counterboreDepth,
        countersinkDiameter: f.countersinkDiameter,
        countersinkAngle: f.countersinkAngle,
        flip: f.flip ?? false,
        picking: "points",
      };
    case "rectangular-pattern":
      return {
        type: "rectangular-pattern",
        editing: f.id,
        ...SOURCE_OF(f.source),
        direction: f.direction,
        count: f.count,
        distance: f.distance,
        flip: f.flip ?? false,
        second: f.direction2 !== undefined,
        direction2: f.direction2 ?? null,
        count2: f.count2 ?? "2",
        distance2: f.distance2 ?? f.distance,
        flip2: f.flip2 ?? false,
        picking: "source",
      };
    case "circular-pattern":
      return {
        type: "circular-pattern",
        editing: f.id,
        ...SOURCE_OF(f.source),
        axis: f.axis,
        count: f.count,
        angle: f.angle,
        flip: f.flip ?? false,
        picking: "source",
      };
    case "mirror":
      return {
        type: "mirror",
        editing: f.id,
        ...SOURCE_OF(f.source),
        plane: f.plane,
        picking: "source",
      };
    case "move": {
      const t = f.transform;
      return {
        type: "move",
        editing: f.id,
        bodyIds: f.bodyIds,
        copy: f.copy,
        mode: t.type,
        ...MOVE_DEFAULTS,
        ...(t.type === "translate" ? { x: t.x, y: t.y, z: t.z } : {}),
        ...(t.type === "free"
          ? { x: t.x, y: t.y, z: t.z, rx: t.rx, ry: t.ry, rz: t.rz, pivot: t.pivot }
          : {}),
        axis: t.type === "rotate" ? t.axis : null,
        ...(t.type === "rotate" ? { angle: t.angle } : {}),
        from: t.type === "point-to-point" ? t.from : null,
        to: t.type === "point-to-point" ? t.to : null,
        picking: "bodies",
      };
    }
    case "align":
      return {
        type: "align",
        editing: f.id,
        mode: f.mode,
        bodyId: f.bodyId,
        fromFace: f.mode === "face-to-face" ? f.from : null,
        toFace: f.mode === "face-to-face" ? f.to : null,
        fromPoint: f.mode === "point-to-point" ? f.from : null,
        toPoint: f.mode === "point-to-point" ? f.to : null,
        flip: f.flip ?? false,
        picking: "from",
      };
    case "split":
      return {
        type: "split",
        editing: f.id,
        bodyId: f.bodyId,
        tool: f.tool,
        keep: f.keep,
        picking: "tool",
      };
    case "sweep":
      return {
        type: "sweep",
        editing: f.id,
        sketchId: f.sketchId,
        profiles: f.profiles,
        pathSketchId: f.path.sketchId,
        path: f.path.entityIds,
        operation: f.operation,
        targetBodyIds: f.targetBodyIds,
        picking: "profile",
      };
    case "loft":
      return {
        type: "loft",
        editing: f.id,
        sections: f.sections,
        ruled: f.ruled ?? false,
        operation: f.operation,
        targetBodyIds: f.targetBodyIds,
      };
    case "offset-plane":
      return { type: "offset-plane", editing: f.id, base: f.base, offset: f.offset, picking: "base" };
    default:
      return null;
  }
}

function moveTransform(dialog: MoveDialog): MoveTransform | null {
  if (dialog.mode === "translate") {
    return { type: "translate", x: dialog.x, y: dialog.y, z: dialog.z };
  }
  if (dialog.mode === "free") {
    if (!dialog.pivot) return null;
    const { x, y, z, rx, ry, rz, pivot } = dialog;
    return { type: "free", x, y, z, rx, ry, rz, pivot };
  }
  if (dialog.mode === "rotate") {
    return dialog.axis ? { type: "rotate", axis: dialog.axis, angle: dialog.angle } : null;
  }
  return dialog.from && dialog.to
    ? { type: "point-to-point", from: dialog.from, to: dialog.to }
    : null;
}

function alignInput(dialog: AlignDialog): AlignInput | null {
  if (!dialog.bodyId) return null;
  if (dialog.mode === "face-to-face") {
    if (!dialog.fromFace || !dialog.toFace) return null;
    return {
      mode: "face-to-face",
      bodyId: dialog.bodyId,
      from: dialog.fromFace,
      to: dialog.toFace,
      // Optional flags are left out rather than stored as false, as the commands do.
        flip: dialog.flip || undefined,
    };
  }
  if (!dialog.fromPoint || !dialog.toPoint) return null;
  return {
    mode: "point-to-point",
    bodyId: dialog.bodyId,
    from: dialog.fromPoint,
    to: dialog.toPoint,
    flip: dialog.flip || undefined,
  };
}

const targetsOf = (dialog: OperationPick): string[] =>
  dialog.operation === "new" ? [] : dialog.targetBodyIds;

/**
 * The command that applies a dialog: it adds the feature, or updates the one being edited.
 * Null while the dialog is incomplete (see `solidDialogProblem`).
 */
export function solidDialogCommand(dialog: SolidDialog, out: CreatedRef = {}): Command | null {
  const editing = dialog.editing;
  switch (dialog.type) {
    case "hole": {
      if (!dialog.bodyId || !dialog.sketchId || dialog.points.length === 0) return null;
      const input = {
        bodyId: dialog.bodyId,
        sketchId: dialog.sketchId,
        points: dialog.points,
        holeType: dialog.holeType,
        diameter: dialog.diameter,
        extent: dialog.extent,
        depth: dialog.depth,
        counterboreDiameter: dialog.counterboreDiameter,
        counterboreDepth: dialog.counterboreDepth,
        countersinkDiameter: dialog.countersinkDiameter,
        countersinkAngle: dialog.countersinkAngle,
        flip: dialog.flip || undefined,
      };
      return editing
        ? updateFeature<HoleFeature>(editing, input, "Edit hole")
        : addHole(input, out);
    }
    case "rectangular-pattern": {
      if (!dialog.direction) return null;
      const second = dialog.second && dialog.direction2 !== null;
      const input = {
        source: sourceOf(dialog),
        direction: dialog.direction,
        count: dialog.count,
        distance: dialog.distance,
        flip: dialog.flip || undefined,
        direction2: second && dialog.direction2 ? dialog.direction2 : undefined,
        count2: second ? dialog.count2 : undefined,
        distance2: second ? dialog.distance2 : undefined,
        flip2: (second && dialog.flip2) || undefined,
      };
      return editing
        ? updateFeature<RectangularPatternFeature>(editing, input, "Edit rectangular pattern")
        : addRectangularPattern(input, out);
    }
    case "circular-pattern": {
      if (!dialog.axis) return null;
      const input = {
        source: sourceOf(dialog),
        axis: dialog.axis,
        count: dialog.count,
        angle: dialog.angle,
        flip: dialog.flip || undefined,
      };
      return editing
        ? updateFeature<CircularPatternFeature>(editing, input, "Edit circular pattern")
        : addCircularPattern(input, out);
    }
    case "mirror": {
      if (!dialog.plane) return null;
      const input = { source: sourceOf(dialog), plane: dialog.plane };
      return editing
        ? updateFeature<MirrorFeature>(editing, input, "Edit mirror")
        : addMirror(input, out);
    }
    case "move": {
      const transform = moveTransform(dialog);
      if (!transform || dialog.bodyIds.length === 0) return null;
      const input = { bodyIds: dialog.bodyIds, transform, copy: dialog.copy };
      return editing
        ? updateFeature<MoveFeature>(editing, input, dialog.copy ? "Edit copy" : "Edit move")
        : addMove(input, out);
    }
    case "align": {
      const input = alignInput(dialog);
      if (!input) return null;
      return editing
        ? updateFeature<AlignFeature>(editing, input, "Edit align")
        : addAlign(input, out);
    }
    case "split": {
      if (!dialog.bodyId || !dialog.tool) return null;
      const input = { bodyId: dialog.bodyId, tool: dialog.tool, keep: dialog.keep };
      return editing
        ? updateFeature<SplitFeature>(editing, input, "Edit split body")
        : addSplit(input, out);
    }
    case "sweep": {
      if (!dialog.sketchId || !dialog.pathSketchId) return null;
      if (dialog.profiles.length === 0 || dialog.path.length === 0) return null;
      const input = {
        sketchId: dialog.sketchId,
        profiles: dialog.profiles,
        path: { sketchId: dialog.pathSketchId, entityIds: dialog.path },
        operation: dialog.operation,
        targetBodyIds: targetsOf(dialog),
      };
      return editing
        ? updateFeature<SweepFeature>(editing, input, "Edit sweep")
        : addSweep(input, out);
    }
    case "loft": {
      if (dialog.sections.length < 2) return null;
      const input = {
        sections: dialog.sections,
        operation: dialog.operation,
        targetBodyIds: targetsOf(dialog),
        ruled: dialog.ruled || undefined,
      };
      return editing
        ? updateFeature<LoftFeature>(editing, input, "Edit loft")
        : addLoft(input, out);
    }
    case "offset-plane": {
      if (!dialog.base) return null;
      const input = { base: dialog.base, offset: dialog.offset };
      return editing
        ? updateFeature<OffsetPlaneFeature>(editing, input, "Edit offset plane")
        : addOffsetPlane(input, out);
    }
  }
}

/** Sketches that the feature made from the dialog is built from: they are hidden afterwards. */
export function consumedSketches(dialog: SolidDialog): string[] {
  switch (dialog.type) {
    case "hole":
      return dialog.sketchId ? [dialog.sketchId] : [];
    case "sweep":
      return [dialog.sketchId, dialog.pathSketchId].filter((id): id is string => id !== null);
    case "loft":
      return dialog.sections.flatMap((s) => (s.type === "profile" ? [s.sketchId] : []));
    default:
      return [];
  }
}
