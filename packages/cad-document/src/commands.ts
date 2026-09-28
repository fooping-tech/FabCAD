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
  type AlignFeature,
  type BodyOperation,
  type ChamferFeature,
  type CircularPatternFeature,
  type EdgeRef,
  type ExtrudeDirection,
  type ExtrudeFeature,
  type FaceRef,
  type Feature,
  type FilletFeature,
  type HoleExtent,
  type HoleFeature,
  type HoleType,
  type ImportFeature,
  type LoftFeature,
  type LoftSection,
  type MirrorFeature,
  type MirrorPlane,
  type MoveFeature,
  type MoveTransform,
  type PatternAxis,
  type PatternDirection,
  type PatternSource,
  type Point3Ref,
  type RectangularPatternFeature,
  type RevolveAxis,
  type RevolveFeature,
  type ShellFeature,
  type SketchFeature,
  type SplitFeature,
  type SplitTool,
  type SweepFeature,
  type SweepPath,
  type BooleanFeature,
  featureCreatedBodies,
  featureExpressions,
  parseDynamicBodyId,
  setFeatureExpression,
} from "./features";
import { type Parameter, type ParameterUnit, renameInExpression } from "./parameters";
import { type Command, command } from "./store";
import type { EntityId, ProfileRef } from "@fabcad/sketch";

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
    default: {
      // Every other feature: by the keys under which it reports its expressions.
      let next: Feature = feature;
      for (const e of featureExpressions(feature)) {
        next = setFeatureExpression(next, e.key, r(e.expression));
      }
      return next;
    }
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

/**
 * Records for the bodies a feature creates under a derived id (see `dynamicBodyId`), as far
 * as its definition tells which ones there are. Made by the command so that the body is there
 * in the same undo step; bodies that only evaluation can tell follow through
 * `syncBodyRecords`.
 */
function derivedBodies(doc: CadDocument, feature: Feature): BodyRecord[] {
  const out: BodyRecord[] = [];
  const used = new Set(Object.values(doc.bodies).map((b) => b.name));
  for (const id of featureCreatedBodies(feature)) {
    const dynamic = parseDynamicBodyId(id);
    if (!dynamic || doc.bodies[id]) continue;
    const source = doc.bodies[dynamic.sourceBodyId];
    const base = `${source?.name ?? "Body"} (${feature.name})`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base} ${i}`;
    used.add(name);
    out.push({
      id,
      name,
      componentId: source?.componentId ?? feature.componentId,
      visible: true,
      createdBy: feature.id,
    });
  }
  return out;
}

/** Bodies and features named by a pattern source that exist in the document. */
function validSource(doc: CadDocument, source: PatternSource): PatternSource | null {
  if (source.kind === "bodies") {
    const bodyIds = [...new Set(source.bodyIds)].filter((b) => doc.bodies[b]);
    return bodyIds.length > 0 ? { kind: "bodies", bodyIds } : null;
  }
  const featureIds = [...new Set(source.featureIds)].filter((f) => {
    const feature = doc.features[f];
    return feature !== undefined && feature.type !== "sketch";
  });
  // In timeline order: that is the order in which their effect is applied again.
  featureIds.sort((a, b) => doc.timeline.indexOf(a) - doc.timeline.indexOf(b));
  return featureIds.length > 0 ? { kind: "features", featureIds } : null;
}

/** Component of the first thing a pattern repeats. */
function sourceComponent(doc: CadDocument, source: PatternSource): string {
  const first =
    source.kind === "bodies"
      ? doc.bodies[source.bodyIds[0] ?? ""]?.componentId
      : doc.features[source.featureIds[0] ?? ""]?.componentId;
  return first ?? doc.assembly.rootComponentId;
}

export interface HoleInput {
  bodyId: string;
  sketchId: string;
  points: EntityId[];
  holeType?: HoleType;
  diameter: string;
  extent?: HoleExtent;
  depth?: string;
  counterboreDiameter?: string;
  counterboreDepth?: string;
  countersinkDiameter?: string;
  countersinkAngle?: string;
  flip?: boolean;
}

export function addHole(input: HoleInput, out: CreatedRef = {}): Command {
  return command("Hole", (doc) => {
    const body = doc.bodies[input.bodyId];
    const sketch = doc.features[input.sketchId];
    if (!body || !sketch || sketch.type !== "sketch") return doc;
    const points = [...new Set(input.points)].filter(
      (p) => sketch.sketch.entities[p]?.type === "point",
    );
    if (points.length === 0) return doc;
    const [id, d] = allocateId(doc, "hole");
    const feature: HoleFeature = {
      id,
      type: "hole",
      name: nextFeatureName(doc, "hole"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
      sketchId: input.sketchId,
      points,
      holeType: input.holeType ?? "simple",
      diameter: input.diameter,
      extent: input.extent ?? "through-all",
      depth: input.depth ?? "10",
      counterboreDiameter: input.counterboreDiameter ?? `(${input.diameter}) * 1.8`,
      counterboreDepth: input.counterboreDepth ?? `(${input.diameter}) * 0.6`,
      countersinkDiameter: input.countersinkDiameter ?? `(${input.diameter}) * 2`,
      countersinkAngle: input.countersinkAngle ?? "90",
    };
    if (input.flip) feature.flip = true;
    out.id = id;
    out.bodyId = input.bodyId;
    return withFeature(d, feature);
  });
}

export interface RectangularPatternInput {
  source: PatternSource;
  direction: PatternDirection;
  count: string;
  distance: string;
  flip?: boolean;
  direction2?: PatternDirection;
  count2?: string;
  distance2?: string;
  flip2?: boolean;
}

export function addRectangularPattern(input: RectangularPatternInput, out: CreatedRef = {}): Command {
  return command("Rectangular pattern", (doc) => {
    const source = validSource(doc, input.source);
    if (!source) return doc;
    const [id, d] = allocateId(doc, "pattern");
    const feature: RectangularPatternFeature = {
      id,
      type: "rectangular-pattern",
      name: nextFeatureName(doc, "rectangular-pattern"),
      componentId: sourceComponent(doc, source),
      suppressed: false,
      source,
      direction: input.direction,
      count: input.count,
      distance: input.distance,
    };
    if (input.flip) feature.flip = true;
    if (input.direction2) {
      feature.direction2 = input.direction2;
      feature.count2 = input.count2 ?? "2";
      feature.distance2 = input.distance2 ?? input.distance;
      if (input.flip2) feature.flip2 = true;
    }
    out.id = id;
    return withFeature(d, feature);
  });
}

export interface CircularPatternInput {
  source: PatternSource;
  axis: PatternAxis;
  count: string;
  /** Total angle; a full turn when omitted. */
  angle?: string;
  flip?: boolean;
}

export function addCircularPattern(input: CircularPatternInput, out: CreatedRef = {}): Command {
  return command("Circular pattern", (doc) => {
    const source = validSource(doc, input.source);
    if (!source) return doc;
    const [id, d] = allocateId(doc, "pattern");
    const feature: CircularPatternFeature = {
      id,
      type: "circular-pattern",
      name: nextFeatureName(doc, "circular-pattern"),
      componentId: sourceComponent(doc, source),
      suppressed: false,
      source,
      axis: input.axis,
      count: input.count,
      angle: input.angle ?? "360",
    };
    if (input.flip) feature.flip = true;
    out.id = id;
    return withFeature(d, feature);
  });
}

export function addMirror(
  input: { source: PatternSource; plane: MirrorPlane },
  out: CreatedRef = {},
): Command {
  return command("Mirror", (doc) => {
    const source = validSource(doc, input.source);
    if (!source) return doc;
    const [id, d] = allocateId(doc, "mirror");
    const feature: MirrorFeature = {
      id,
      type: "mirror",
      name: nextFeatureName(doc, "mirror"),
      componentId: sourceComponent(doc, source),
      suppressed: false,
      source,
      plane: input.plane,
    };
    const bodies = derivedBodies(d, feature);
    out.id = id;
    if (bodies[0]) out.bodyId = bodies[0].id;
    return withFeature(d, feature, bodies);
  });
}

export function addMove(
  input: { bodyIds: string[]; transform: MoveTransform; copy?: boolean },
  out: CreatedRef = {},
): Command {
  return command(input.copy ? "Copy" : "Move", (doc) => {
    const bodyIds = [...new Set(input.bodyIds)].filter((b) => doc.bodies[b]);
    const first = doc.bodies[bodyIds[0] ?? ""];
    if (!first) return doc;
    const [id, d] = allocateId(doc, "move");
    const feature: MoveFeature = {
      id,
      type: "move",
      name: nextFeatureName(doc, "move"),
      componentId: first.componentId,
      suppressed: false,
      bodyIds,
      copy: input.copy ?? false,
      transform: input.transform,
    };
    const bodies = derivedBodies(d, feature);
    out.id = id;
    out.bodyId = bodies[0]?.id ?? first.id;
    return withFeature(d, feature, bodies);
  });
}

export type AlignInput =
  | {
      mode: "face-to-face";
      bodyId: string;
      from: FaceRef;
      to: { bodyId: string; ref: FaceRef };
      flip?: boolean;
    }
  | { mode: "point-to-point"; bodyId: string; from: Point3Ref; to: Point3Ref; flip?: boolean };

export function addAlign(input: AlignInput, out: CreatedRef = {}): Command {
  return command("Align", (doc) => {
    const body = doc.bodies[input.bodyId];
    if (!body) return doc;
    // A body cannot be aligned with itself: it would have to move away from where it goes.
    if (input.mode === "face-to-face" && input.to.bodyId === input.bodyId) return doc;
    const [id, d] = allocateId(doc, "align");
    const base = {
      id,
      type: "align" as const,
      name: nextFeatureName(doc, "align"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
    };
    const feature: AlignFeature =
      input.mode === "face-to-face"
        ? { ...base, mode: "face-to-face", from: input.from, to: input.to }
        : { ...base, mode: "point-to-point", from: input.from, to: input.to };
    if (input.flip) feature.flip = true;
    out.id = id;
    out.bodyId = input.bodyId;
    return withFeature(d, feature);
  });
}

export function addSplit(
  input: { bodyId: string; tool: SplitTool; keep?: SplitFeature["keep"] },
  out: CreatedRef = {},
): Command {
  return command("Split body", (doc) => {
    const body = doc.bodies[input.bodyId];
    if (!body) return doc;
    const [id, d] = allocateId(doc, "split");
    const feature: SplitFeature = {
      id,
      type: "split",
      name: nextFeatureName(doc, "split"),
      componentId: body.componentId,
      suppressed: false,
      bodyId: input.bodyId,
      tool: input.tool,
      keep: input.keep ?? "both",
    };
    const bodies = derivedBodies(d, feature);
    out.id = id;
    // The new body when there is one: that is what the caller cannot know by itself.
    out.bodyId = bodies[0]?.id ?? input.bodyId;
    return withFeature(d, feature, bodies);
  });
}

export interface SweepInput {
  sketchId: string;
  profiles: ProfileRef[];
  path: SweepPath;
  operation?: BodyOperation;
  targetBodyIds?: string[];
}

export function addSweep(input: SweepInput, out: CreatedRef = {}): Command {
  return command("Sweep", (doc) => {
    const sketch = doc.features[input.sketchId];
    const path = doc.features[input.path.sketchId];
    if (!sketch || sketch.type !== "sketch" || !path || path.type !== "sketch") return doc;
    if (input.profiles.length === 0 || input.path.entityIds.length === 0) return doc;
    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "sweep");
    const operation = input.operation ?? "new";
    const bodies: BodyRecord[] = [];
    let bodyId = "";
    if (operation === "new") {
      let body: BodyRecord;
      [body, d] = newBody(d, id, sketch.componentId);
      bodies.push(body);
      bodyId = body.id;
    }
    const feature: SweepFeature = {
      id,
      type: "sweep",
      name: nextFeatureName(doc, "sweep"),
      componentId: sketch.componentId,
      suppressed: false,
      sketchId: input.sketchId,
      profiles: input.profiles,
      path: { sketchId: input.path.sketchId, entityIds: [...new Set(input.path.entityIds)] },
      operation,
      targetBodyIds: operation === "new" ? [] : (input.targetBodyIds ?? []),
      bodyId,
      orientation: "perpendicular",
    };
    out.id = id;
    out.bodyId = bodyId;
    return withFeature(d, feature, bodies);
  });
}

export interface LoftInput {
  sections: LoftSection[];
  operation?: BodyOperation;
  targetBodyIds?: string[];
  ruled?: boolean;
}

export function addLoft(input: LoftInput, out: CreatedRef = {}): Command {
  return command("Loft", (doc) => {
    if (input.sections.length < 2) return doc;
    let componentId = doc.assembly.rootComponentId;
    for (const s of input.sections) {
      if (s.type === "profile") {
        const sketch = doc.features[s.sketchId];
        if (!sketch || sketch.type !== "sketch") return doc;
        componentId = sketch.componentId;
      } else if (!doc.bodies[s.bodyId]) {
        return doc;
      }
    }
    let d = doc;
    let id: string;
    [id, d] = allocateId(d, "loft");
    const operation = input.operation ?? "new";
    const bodies: BodyRecord[] = [];
    let bodyId = "";
    if (operation === "new") {
      let body: BodyRecord;
      [body, d] = newBody(d, id, componentId);
      bodies.push(body);
      bodyId = body.id;
    }
    const feature: LoftFeature = {
      id,
      type: "loft",
      name: nextFeatureName(doc, "loft"),
      componentId,
      suppressed: false,
      sections: input.sections,
      operation,
      targetBodyIds: operation === "new" ? [] : (input.targetBodyIds ?? []),
      bodyId,
    };
    if (input.ruled) feature.ruled = true;
    out.id = id;
    out.bodyId = bodyId;
    return withFeature(d, feature, bodies);
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
    // Expressions inside nested objects are patched by their path, e.g. { "transform.x": "5" }:
    // that is the key `featureExpressions` reports, and what a generic editor sends back.
    const fields: Record<string, unknown> = {};
    const paths: [string, string][] = [];
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (key.includes(".") && typeof value === "string") paths.push([key, value]);
      else fields[key] = value;
    }
    let next = { ...f, ...fields } as Feature;
    for (const [key, value] of paths) next = setFeatureExpression(next, key, value);
    let d: CadDocument = { ...doc, features: { ...doc.features, [id]: next } };
    // Bodies with a derived id that the feature creates now (a move that became a copy …).
    const derived = derivedBodies(d, next);
    if (derived.length > 0) {
      d = { ...d, bodies: { ...d.bodies } };
      for (const b of derived) d.bodies[b.id] = b;
    }
    // Switching an extrude between "new" and the modifying operations adds or drops its body.
    if (
      (next.type === "extrude" ||
        next.type === "revolve" ||
        next.type === "sweep" ||
        next.type === "loft") &&
      f.type === next.type
    ) {
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
    // Bodies with a derived id, e.g. the instances of a body pattern, go with their feature.
    for (const b of Object.keys(bodies)) {
      const dynamic = parseDynamicBodyId(b);
      if (dynamic && doomed.has(dynamic.featureId)) delete bodies[b];
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
