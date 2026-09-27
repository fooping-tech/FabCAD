import { type Sketch, type SketchPlaneRef, createSketch, editSketch } from "@fabcad/sketch";
import {
  type BodyRecord,
  type CadDocument,
  allocateId,
  nextBodyName,
  nextFeatureName,
  pruneBodies,
} from "./document";
import { isValidParameterName } from "./expression";
import {
  type BodyOperation,
  type ChamferFeature,
  type EdgeRef,
  type ExtrudeDirection,
  type ExtrudeFeature,
  type FaceRef,
  type Feature,
  type FilletFeature,
  type ImportFeature,
  type RevolveAxis,
  type RevolveFeature,
  type ShellFeature,
  type SketchFeature,
  type BooleanFeature,
  featureCreatedBodies,
  featureExpressions,
} from "./features";
import { type Parameter, type ParameterUnit, renameInExpression } from "./parameters";
import { type Command, command } from "./store";
import type { ProfileRef } from "@fabcad/sketch";

/**
 * Commands: the only way the UI changes a document. Each factory returns a `Command` that the
 * `DocumentStore` executes and records for undo / redo.
 */

const insertIntoTimeline = (doc: CadDocument, id: string): string[] => {
  // New features are inserted at the history marker, like in Fusion.
  const at = doc.timelineCursor ?? doc.timeline.length;
  const timeline = doc.timeline.slice();
  timeline.splice(at, 0, id);
  return timeline;
};

function withFeature(doc: CadDocument, feature: Feature, bodies: BodyRecord[] = []): CadDocument {
  const next: CadDocument = {
    ...doc,
    features: { ...doc.features, [feature.id]: feature },
    timeline: insertIntoTimeline(doc, feature.id),
    timelineCursor: doc.timelineCursor === null ? null : doc.timelineCursor + 1,
  };
  if (bodies.length > 0) {
    next.bodies = { ...doc.bodies };
    for (const b of bodies) next.bodies[b.id] = b;
  }
  return next;
}

function newBody(doc: CadDocument, featureId: string, componentId: string): [BodyRecord, CadDocument] {
  const [id, d] = allocateId(doc, "body");
  const body: BodyRecord = {
    id,
    name: nextBodyName(doc),
    componentId,
    visible: true,
    createdBy: featureId,
  };
  return [body, d];
}

// ---------------------------------------------------------------- parameters

export function addParameter(input: {
  name: string;
  expression: string;
  unit: ParameterUnit;
  comment?: string;
}): Command {
  return command(`Add parameter ${input.name}`, (doc) => {
    if (!isValidParameterName(input.name)) return doc;
    if (doc.parameters.some((p) => p.name === input.name)) return doc;
    const [id, d] = allocateId(doc, "param");
    const p: Parameter = { id, name: input.name, expression: input.expression, unit: input.unit };
    if (input.comment) p.comment = input.comment;
    return { ...d, parameters: [...d.parameters, p] };
  });
}

export function updateParameter(
  id: string,
  patch: Partial<Pick<Parameter, "expression" | "unit" | "comment">>,
): Command {
  return command("Change parameter", (doc) => {
    const cur = doc.parameters.find((p) => p.id === id);
    if (!cur) return doc;
    const next = { ...cur, ...patch };
    if (
      next.expression === cur.expression &&
      next.unit === cur.unit &&
      next.comment === cur.comment
    ) {
      return doc;
    }
    return { ...doc, parameters: doc.parameters.map((p) => (p.id === id ? next : p)) };
  });
}

/** Rename a parameter and rewrite every expression that refers to it. */
export function renameParameter(id: string, name: string): Command {
  return command("Rename parameter", (doc) => {
    const cur = doc.parameters.find((p) => p.id === id);
    if (!cur || cur.name === name) return doc;
    if (!isValidParameterName(name) || doc.parameters.some((p) => p.name === name)) return doc;
    const from = cur.name;
    const parameters = doc.parameters.map((p) => ({
      ...p,
      name: p.id === id ? name : p.name,
      expression: renameInExpression(p.expression, from, name),
    }));
    const features: Record<string, Feature> = {};
    for (const [fid, f] of Object.entries(doc.features)) {
      features[fid] = renameInFeature(f, from, name);
    }
    return { ...doc, parameters, features };
  });
}

function renameInFeature(feature: Feature, from: string, to: string): Feature {
  if (!featureExpressions(feature).some((e) => e.expression.includes(from))) return feature;
  const r = (s: string): string => renameInExpression(s, from, to);
  switch (feature.type) {
    case "sketch": {
      const dimensions = Object.fromEntries(
        Object.entries(feature.sketch.dimensions).map(([k, d]) => [
          k,
          { ...d, expression: r(d.expression) },
        ]),
      );
      return { ...feature, sketch: { ...feature.sketch, dimensions } };
    }
    case "extrude":
      return { ...feature, distance: r(feature.distance) };
    case "revolve":
      return { ...feature, angle: r(feature.angle) };
    case "fillet":
      return { ...feature, radius: r(feature.radius) };
    case "chamfer":
      return { ...feature, distance: r(feature.distance) };
    case "shell":
      return { ...feature, thickness: r(feature.thickness) };
    default:
      return feature;
  }
}

export function removeParameter(id: string): Command {
  return command("Delete parameter", (doc) => {
    if (!doc.parameters.some((p) => p.id === id)) return doc;
    return { ...doc, parameters: doc.parameters.filter((p) => p.id !== id) };
  });
}

// ------------------------------------------------------------------- sketches

export interface CreatedRef {
  /** Filled in when the command runs, so that the caller can select the new object. */
  id?: string;
  bodyId?: string;
}

export function addSketch(plane: SketchPlaneRef, out: CreatedRef = {}, componentId?: string): Command {
  return command("New sketch", (doc) => {
    const [id, d] = allocateId(doc, "sketch");
    const name = nextFeatureName(doc, "sketch");
    const feature: SketchFeature = {
      id,
      type: "sketch",
      name,
      componentId: componentId ?? doc.assembly.rootComponentId,
      suppressed: false,
      visible: true,
      // Every sketch starts with its origin: a fixed point that geometry can be tied to.
      sketch: withOrigin(createSketch(id, name, plane)),
    };
    out.id = id;
    return withFeature(d, feature);
  });
}

function withOrigin(sketch: Sketch): Sketch {
  let originId = "";
  const next = editSketch(sketch, (b) => {
    originId = b.point(0, 0, true);
    b.constrain("fix", originId);
  });
  return { ...next, originId };
}

/** Apply an edit to the sketch of a sketch feature. */
export function updateSketch(
  featureId: string,
  label: string,
  edit: (sketch: Sketch) => Sketch,
): Command {
  return command(label, (doc) => applySketchEdit(doc, featureId, edit));
}

/** Non-command form of `updateSketch`, for use inside store transactions. */
export function applySketchEdit(
  doc: CadDocument,
  featureId: string,
  edit: (sketch: Sketch) => Sketch,
): CadDocument {
  const f = doc.features[featureId];
  if (!f || f.type !== "sketch") return doc;
  const sketch = edit(f.sketch);
  if (sketch === f.sketch) return doc;
  return { ...doc, features: { ...doc.features, [featureId]: { ...f, sketch } } };
}

// ------------------------------------------------------------------- features

export interface ExtrudeInput {
  sketchId: string;
  profiles: ProfileRef[];
  distance: string;
  direction?: ExtrudeDirection;
  operation?: BodyOperation;
  targetBodyIds?: string[];
}

export function addExtrude(input: ExtrudeInput, out: CreatedRef = {}): Command {
  return command("Extrude", (doc) => {
    const sketch = doc.features[input.sketchId];
    if (!sketch || sketch.type !== "sketch") return doc;
    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "extrude");
    const operation = input.operation ?? "new";
    const bodies: BodyRecord[] = [];
    let bodyId = "";
    if (operation === "new") {
      let body: BodyRecord;
      [body, d] = newBody(d, id, sketch.componentId);
      bodies.push(body);
      bodyId = body.id;
    }
    const feature: ExtrudeFeature = {
      id,
      type: "extrude",
      name: nextFeatureName(doc, "extrude"),
      componentId: sketch.componentId,
      suppressed: false,
      sketchId: input.sketchId,
      profiles: input.profiles,
      distance: input.distance,
      direction: input.direction ?? "positive",
      operation,
      targetBodyIds: operation === "new" ? [] : (input.targetBodyIds ?? []),
      bodyId,
    };
    out.id = id;
    out.bodyId = bodyId;
    return withFeature(d, feature, bodies);
  });
}

export interface RevolveInput {
  sketchId: string;
  profiles: ProfileRef[];
  axis: RevolveAxis;
  angle: string;
  operation?: BodyOperation;
  targetBodyIds?: string[];
}

export function addRevolve(input: RevolveInput, out: CreatedRef = {}): Command {
  return command("Revolve", (doc) => {
    const sketch = doc.features[input.sketchId];
    if (!sketch || sketch.type !== "sketch") return doc;
    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "revolve");
    const operation = input.operation ?? "new";
    const bodies: BodyRecord[] = [];
    let bodyId = "";
    if (operation === "new") {
      let body: BodyRecord;
      [body, d] = newBody(d, id, sketch.componentId);
      bodies.push(body);
      bodyId = body.id;
    }
    const feature: RevolveFeature = {
      id,
      type: "revolve",
      name: nextFeatureName(doc, "revolve"),
      componentId: sketch.componentId,
      suppressed: false,
      sketchId: input.sketchId,
      profiles: input.profiles,
      axis: input.axis,
      angle: input.angle,
      operation,
      targetBodyIds: operation === "new" ? [] : (input.targetBodyIds ?? []),
      bodyId,
    };
    out.id = id;
    out.bodyId = bodyId;
    return withFeature(d, feature, bodies);
  });
}

export function addBoolean(
  input: {
    operation: BooleanFeature["operation"];
    targetBodyId: string;
    toolBodyIds: string[];
    keepTools?: boolean;
  },
  out: CreatedRef = {},
): Command {
  return command("Combine", (doc) => {
    const target = doc.bodies[input.targetBodyId];
    const tools = input.toolBodyIds.filter((t) => t !== input.targetBodyId && doc.bodies[t]);
    if (!target || tools.length === 0) return doc;
    const [id, d] = allocateId(doc, "boolean");
    const feature: BooleanFeature = {
      id,
      type: "boolean",
      name: nextFeatureName(doc, "boolean"),
      componentId: target.componentId,
      suppressed: false,
      operation: input.operation,
      targetBodyId: input.targetBodyId,
      toolBodyIds: tools,
      keepTools: input.keepTools ?? false,
    };
    out.id = id;
    return withFeature(d, feature);
  });
}

export function addFillet(
  input: { bodyId: string; edges: EdgeRef[]; radius: string },
  out: CreatedRef = {},
): Command {
  return command("Fillet", (doc) => {
    const body = doc.bodies[input.bodyId];
    if (!body || input.edges.length === 0) return doc;
    const [id, d] = allocateId(doc, "fillet");
    const feature: FilletFeature = {
      id,
      type: "fillet",
      name: nextFeatureName(doc, "fillet"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
      edges: input.edges,
      radius: input.radius,
    };
    out.id = id;
    return withFeature(d, feature);
  });
}

export function addChamfer(
  input: { bodyId: string; edges: EdgeRef[]; distance: string },
  out: CreatedRef = {},
): Command {
  return command("Chamfer", (doc) => {
    const body = doc.bodies[input.bodyId];
    if (!body || input.edges.length === 0) return doc;
    const [id, d] = allocateId(doc, "chamfer");
    const feature: ChamferFeature = {
      id,
      type: "chamfer",
      name: nextFeatureName(doc, "chamfer"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
      edges: input.edges,
      distance: input.distance,
    };
    out.id = id;
    return withFeature(d, feature);
  });
}

export function addShell(
  input: { bodyId: string; faces: FaceRef[]; thickness: string },
  out: CreatedRef = {},
): Command {
  return command("Shell", (doc) => {
    const body = doc.bodies[input.bodyId];
    if (!body) return doc;
    const [id, d] = allocateId(doc, "shell");
    const feature: ShellFeature = {
      id,
      type: "shell",
      name: nextFeatureName(doc, "shell"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
      faces: input.faces,
      thickness: input.thickness,
    };
    out.id = id;
    return withFeature(d, feature);
  });
}

export function addImport(
  input: { fileName: string; data: string; format: "step" },
  out: CreatedRef = {},
): Command {
  return command(`Import ${input.fileName}`, (doc) => {
    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "import");
    let body: BodyRecord;
    [body, d] = newBody(d, id, doc.assembly.rootComponentId);
    body = { ...body, name: input.fileName.replace(/\.[^.]+$/, "") || body.name };
    const feature: ImportFeature = {
      id,
      type: "import",
      name: nextFeatureName(doc, "import"),
      componentId: doc.assembly.rootComponentId,
      suppressed: false,
      format: input.format,
      fileName: input.fileName,
      data: input.data,
      bodyId: body.id,
    };
    out.id = id;
    out.bodyId = body.id;
    return withFeature(d, feature, [body]);
  });
}

/** Fields of a feature that may be patched; distributes over the feature union. */
export type FeaturePatch<T extends Feature = Feature> = T extends Feature
  ? Partial<Omit<T, "id" | "type">>
  : never;

/** Patch a feature's own fields (expressions, operation, references…). */
export function updateFeature<T extends Feature = Feature>(
  id: string,
  patch: FeaturePatch<T>,
  label = "Edit feature",
): Command {
  return command(label, (doc) => {
    const f = doc.features[id];
    if (!f) return doc;
    const next = { ...f, ...patch } as Feature;
    let d: CadDocument = { ...doc, features: { ...doc.features, [id]: next } };
    // Switching an extrude between "new" and the modifying operations adds or drops its body.
    if ((next.type === "extrude" || next.type === "revolve") && f.type === next.type) {
      if (next.operation === "new" && !next.bodyId) {
        const [body, d2] = newBody(d, id, next.componentId);
        d = {
          ...d2,
          bodies: { ...d2.bodies, [body.id]: body },
          features: { ...d2.features, [id]: { ...next, bodyId: body.id, targetBodyIds: [] } },
        };
      } else if (next.operation !== "new" && next.bodyId) {
        d = { ...d, features: { ...d.features, [id]: { ...next, bodyId: "" } } };
        d = pruneBodies(d);
      }
    }
    return d;
  });
}

export function renameFeature(id: string, name: string): Command {
  return command("Rename", (doc) => {
    const f = doc.features[id];
    if (!f || f.name === name || name.trim() === "") return doc;
    const next: Feature =
      f.type === "sketch" ? { ...f, name, sketch: { ...f.sketch, name } } : { ...f, name };
    return { ...doc, features: { ...doc.features, [id]: next } };
  });
}

export function setFeatureSuppressed(id: string, suppressed: boolean): Command {
  return command(suppressed ? "Suppress" : "Unsuppress", (doc) => {
    const f = doc.features[id];
    if (!f || f.suppressed === suppressed) return doc;
    return { ...doc, features: { ...doc.features, [id]: { ...f, suppressed } } };
  });
}

/**
 * Delete features. Bodies created by them disappear; downstream features that referenced them
 * stay in the timeline and report a missing input on recompute, so nothing is lost silently.
 */
export function removeFeatures(ids: string[]): Command {
  return command(ids.length > 1 ? "Delete features" : "Delete feature", (doc) => {
    const doomed = new Set(ids.filter((id) => doc.features[id]));
    if (doomed.size === 0) return doc;
    const features = { ...doc.features };
    const bodies = { ...doc.bodies };
    for (const id of doomed) {
      for (const b of featureCreatedBodies(features[id]!)) delete bodies[b];
      delete features[id];
    }
    let cursor = doc.timelineCursor;
    if (cursor !== null) {
      const removedBefore = doc.timeline.slice(0, cursor).filter((id) => doomed.has(id)).length;
      cursor -= removedBefore;
    }
    return {
      ...doc,
      features,
      bodies,
      timeline: doc.timeline.filter((id) => !doomed.has(id)),
      timelineCursor: cursor,
    };
  });
}

/** Delete a body by deleting the feature that created it. */
export function removeBody(bodyId: string): Command {
  return command("Delete body", (doc) => {
    const body = doc.bodies[bodyId];
    if (!body) return doc;
    return removeFeatures([body.createdBy]).apply(doc);
  });
}

export function moveFeature(id: string, toIndex: number): Command {
  return command("Reorder timeline", (doc) => {
    const from = doc.timeline.indexOf(id);
    if (from < 0) return doc;
    const timeline = doc.timeline.slice();
    timeline.splice(from, 1);
    const to = Math.max(0, Math.min(timeline.length, toIndex));
    if (to === from) return doc;
    timeline.splice(to, 0, id);
    return { ...doc, timeline };
  });
}

export function setTimelineCursor(cursor: number | null): Command {
  return command("Move history marker", (doc) => {
    const c = cursor === null || cursor >= doc.timeline.length ? null : Math.max(0, cursor);
    return c === doc.timelineCursor ? doc : { ...doc, timelineCursor: c };
  });
}

// ------------------------------------------------------- bodies and visibility

export function renameBody(id: string, name: string): Command {
  return command("Rename body", (doc) => {
    const b = doc.bodies[id];
    if (!b || b.name === name || name.trim() === "") return doc;
    return { ...doc, bodies: { ...doc.bodies, [id]: { ...b, name } } };
  });
}

export function setBodyVisible(id: string, visible: boolean): Command {
  return command(visible ? "Show body" : "Hide body", (doc) => {
    const b = doc.bodies[id];
    if (!b || b.visible === visible) return doc;
    return { ...doc, bodies: { ...doc.bodies, [id]: { ...b, visible } } };
  });
}

export function setSketchVisible(id: string, visible: boolean): Command {
  return command(visible ? "Show sketch" : "Hide sketch", (doc) => {
    const f = doc.features[id];
    if (!f || f.type !== "sketch" || f.visible === visible) return doc;
    return { ...doc, features: { ...doc.features, [id]: { ...f, visible } } };
  });
}

/** Toggle an origin element ("XY", "XZ", "YZ", "X", "Y", "Z") or the whole origin folder. */
export function setOriginVisible(key: string | null, visible: boolean): Command {
  return command(visible ? "Show origin" : "Hide origin", (doc) => {
    if (key === null) {
      if (doc.origin.visible === visible) return doc;
      return { ...doc, origin: { ...doc.origin, visible } };
    }
    const hidden = new Set(doc.origin.hidden);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    return { ...doc, origin: { ...doc.origin, hidden: [...hidden] } };
  });
}

export function renameDocument(name: string): Command {
  return command("Rename document", (doc) => (doc.name === name ? doc : { ...doc, name }));
}

/** Store opaque workspace data (e.g. Fabrication settings) in the document. */
export function setExtension(key: string, value: unknown, label = "Change settings"): Command {
  return command(label, (doc) => ({ ...doc, extensions: { ...doc.extensions, [key]: value } }));
}
