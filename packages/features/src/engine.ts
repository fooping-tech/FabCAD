import {
  type BodyGeometry,
  type GeometryKernel,
  type HoleSpec,
  type KernelShape,
  type LoftSectionInput,
  type MeshEdgeGroup,
  type PathCurve3,
  type ShapeTransform,
  type TessellationOptions,
  edgePolyline,
  faceSilhouettes,
  nearestEdge,
  nearestVertex,
  polylineMidpoint,
} from "@fabcad/brep";
import {
  type BodyNames,
  type FaceSample,
  type NamedBody,
  distanceToFace,
  edgeFaces,
  instanceNames,
  nameEdges,
  nameSolid,
  nearestNamedEdge,
  propagateNames,
  resolveEdgeRef,
  resolveFaceRef,
  resolveVertexRef,
} from "./naming";
import {
  type BodyOperation,
  type CadDocument,
  type DynamicBodyId,
  type DynamicBodyInfo,
  type Feature,
  type ParameterEvaluation,
  type PatternAxis,
  type PatternDirection,
  type PatternSource,
  type PlaneReference,
  type Point3Ref,
  type Scope,
  dynamicBodyId,
  evaluateAs,
  evaluateParameters,
  featureConsumedBodies,
  featureExpressions,
  featureInputBodies,
  featureInputFeatures,
  featureInputPlanes,
  featureInputSketches,
  parameterScope,
  parseDynamicBodyId,
} from "@fabcad/cad-document";
import {
  type Curve2,
  ORIGIN_PLANES,
  type Plane3,
  type Profile2,
  type SolidTopology,
  type TopologyRef,
  type Vec2,
  type Vec3,
  add3,
  cross3,
  curveEnd,
  curvePointAt,
  curveStart,
  curveTangentAt,
  dist2,
  dist3,
  distanceToPlane,
  dot3,
  len3,
  makePlane,
  norm3,
  planeToWorld,
  reverseCurve,
  scale3,
  sub3,
  subCurve,
  worldToPlane,
} from "@fabcad/geometry";
import {
  type ProfileRef,
  type Sketch,
  type SketchRegion,
  type SolveStatus,
  detectProfiles,
  entityToCurves,
  getPoint,
  hitTestSketch,
  projectCurve,
  resolveProfileRefs,
  textOutlineAt,
  updateProjection,
} from "@fabcad/sketch";
import type { SketchSolver } from "@fabcad/sketch-solver";
import { type PlanePatch, facePlanePatch, offsetPlanePatch, originPlanePatch } from "./planes";
import { extrudeReach } from "./extrudeTo";
import { freeMoveSteps } from "./move";
import { resolveSketchPlane, solveSketchWithParameters } from "./sketchSolve";

/**
 * Feature Engine: evaluates the timeline of a document into bodies through the geometry
 * kernel. It owns all kernel shapes. Results are cached per feature and keyed by a hash of
 * everything the feature depends on, so a change only recomputes the features downstream of it.
 */

export type FeatureState = "ok" | "error" | "suppressed" | "rolled-back";

export interface FeatureStatus {
  id: string;
  state: FeatureState;
  message?: string;
  /** True when the result was taken from the cache. */
  cached: boolean;
}

export interface SketchStatus {
  featureId: string;
  status: SolveStatus;
  degreesOfFreedom: number;
  conflicting: string[];
  regionCount: number;
  dimensionErrors: Record<string, string>;
}

export interface BodyResult {
  id: string;
  /** Changes whenever the shape changes. */
  hash: string;
  /** Null when the caller already has the geometry for this hash. */
  geometry: BodyGeometry | null;
  /** Persistent names of the faces and edges; null together with `geometry`. */
  names: BodyNames | null;
  /**
   * Present when the body has no record in the document yet. Such bodies come from features
   * whose number of results depends on evaluated values (instances of a body pattern …). The
   * caller adds the record with `syncBodyRecords`.
   */
  record?: Omit<DynamicBodyInfo, "id">;
}

/** A construction plane as evaluated, with the patch of it that is shown. */
export interface PlaneResult extends PlanePatch {
  id: string;
}

/** A body to export, optionally placed (an instance of a component). */
export interface ExportItem {
  id: string;
  /** Name in the STEP file. */
  name?: string;
  /** Rigid placement applied to a copy of the body, for the export only. */
  steps?: ShapeTransform[];
}

export interface RecomputeResult {
  bodies: BodyResult[];
  planes: PlaneResult[];
  features: Record<string, FeatureStatus>;
  sketches: Record<string, SketchStatus>;
  /**
   * Sketches whose projected geometry moved because the body it comes from changed. The
   * document stores solved sketches, so the caller writes these back.
   */
  sketchUpdates: Record<string, Sketch>;
  parameters: ParameterEvaluation;
  durationMs: number;
}

export interface RecomputeOptions {
  /** Geometry hashes the caller already holds, by body id. */
  known?: Record<string, string>;
}

interface BodyState extends NamedBody {
  shape: KernelShape;
  hash: string;
}

/**
 * What a feature did to bodies, kept so that a pattern or a mirror can do it again somewhere
 * else: the solid it added or removed, and the bodies it did that to. A feature that created
 * a body is recorded as having joined its solid to that body: its copies become part of it.
 */
interface ToolApplication {
  tool: BodyState;
  operation: "join" | "cut" | "intersect";
  targets: string[];
}

interface CacheEntry {
  hash: string;
  /** Bodies written by the feature. */
  outputs: Map<string, BodyState>;
  /** Shapes created by the feature; released when the entry is replaced. */
  owned: KernelShape[];
  /** Empty for features that do not work with a tool (fillet, shell, move …). */
  tools: ToolApplication[];
  status: FeatureStatus;
}

/** One copy made by a pattern or a mirror: its label and how to get there from the original. */
interface PatternInstance {
  label: string;
  steps: ShapeTransform[];
}

/** More instances than this is taken to be a slip of the pen rather than a design. */
const MAX_PATTERN_INSTANCES = 2000;

/** The part of a feature that says what to do with its tool. */
interface OperationTarget {
  id: string;
  operation: BodyOperation;
  targetBodyIds: string[];
  bodyId: string;
}

interface SketchEval {
  /** The sketch as evaluated: projections refreshed and constraints solved. */
  sketch: Sketch;
  hash: string;
  plane: Plane3;
  regions: SketchRegion[];
  status: SketchStatus;
  lineEnds: (entityId: string) => [Vec3, Vec3] | null;
}

/** 53-bit string hash (cyrb53). */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const ORIGIN_AXES: Record<"X" | "Y" | "Z", Vec3> = {
  X: { x: 1, y: 0, z: 0 },
  Y: { x: 0, y: 1, z: 0 },
  Z: { x: 0, y: 0, z: 1 },
};

/**
 * Stop unless `shape` is a closed, valid solid. `empty` is what an empty result means for the
 * feature; a shape with a gap or a broken B-Rep is never reported as a success.
 */
function requireSolid(kernel: GeometryKernel, shape: KernelShape, empty: string): void {
  const problem = kernel.solidProblem(shape);
  if (problem === "empty") throw new Error(empty);
  if (problem === "open") {
    throw new Error("The result is not a closed solid: some edges do not join two faces.");
  }
  if (problem === "invalid") throw new Error("The result is not a valid solid.");
}

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class FeatureEngine {
  private cache = new Map<string, CacheEntry>();
  private bodies = new Map<string, BodyState>();
  private topologyCache = new Map<
    string,
    { hash: string; facets: string; topology: SolidTopology }
  >();
  private sketches = new Map<string, SketchEval>();
  /** Construction planes evaluated so far by the recompute under way, by feature id. */
  private planes = new Map<string, PlaneResult>();
  /** Results of the features that ran without error in the recompute under way, by feature id. */
  private ran = new Map<string, CacheEntry>();
  private features: Record<string, Feature> = {};
  /** Number of features actually evaluated (not served from cache) by the last recompute. */
  lastEvaluated: string[] = [];

  constructor(
    private readonly kernel: GeometryKernel,
    private readonly solver: SketchSolver,
  ) {}

  async recompute(doc: CadDocument, options: RecomputeOptions = {}): Promise<RecomputeResult> {
    const started = Date.now();
    const parameters = evaluateParameters(doc.parameters);
    const scope = parameterScope(parameters);
    const statuses: Record<string, FeatureStatus> = {};
    const sketchStatuses: Record<string, SketchStatus> = {};
    const bodies = new Map<string, BodyState>();
    const sketches = new Map<string, SketchEval>();
    const sketchUpdates: Record<string, Sketch> = {};
    const used = new Set<string>();
    this.lastEvaluated = [];
    this.ran = new Map();
    this.features = doc.features;
    this.planes = new Map();

    const limit = doc.timelineCursor ?? doc.timeline.length;
    for (let index = 0; index < doc.timeline.length; index++) {
      const id = doc.timeline[index]!;
      const feature = doc.features[id];
      if (!feature) continue;
      if (index >= limit) {
        statuses[id] = { id, state: "rolled-back", cached: false };
        continue;
      }
      if (feature.suppressed) {
        statuses[id] = { id, state: "suppressed", cached: false };
        continue;
      }
      if (feature.type === "offset-plane") {
        try {
          this.planes.set(id, this.evaluateOffsetPlane(feature, scope, bodies));
          statuses[id] = { id, state: "ok", cached: false };
        } catch (err) {
          statuses[id] = {
            id,
            state: "error",
            message: err instanceof Error ? err.message : String(err),
            cached: false,
          };
        }
        continue;
      }
      if (feature.type === "sketch") {
        try {
          const projected = this.reproject(feature.sketch, bodies);
          const evaluated = this.evaluateSketch(
            projected === feature.sketch ? feature : { ...feature, sketch: projected },
            scope,
          );
          if (projected !== feature.sketch) sketchUpdates[id] = evaluated.sketch;
          sketches.set(id, evaluated);
          sketchStatuses[id] = evaluated.status;
          const dimensionError = Object.values(evaluated.status.dimensionErrors)[0];
          statuses[id] =
            evaluated.status.status === "over-constrained"
              ? { id, state: "error", message: "Sketch is over-constrained.", cached: false }
              : dimensionError
                ? { id, state: "error", message: `Dimension: ${dimensionError}`, cached: false }
                : { id, state: "ok", cached: false };
        } catch (err) {
          statuses[id] = {
            id,
            state: "error",
            message: err instanceof Error ? err.message : String(err),
            cached: false,
          };
        }
        continue;
      }

      used.add(id);
      let hash: string;
      try {
        hash = this.inputHash(feature, scope, sketches, bodies);
      } catch (err) {
        statuses[id] = {
          id,
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          cached: false,
        };
        continue;
      }
      const cached = this.cache.get(id);
      if (cached && cached.hash === hash) {
        if (cached.status.state === "ok") {
          this.applyOutputs(feature, cached.outputs, bodies);
          this.ran.set(id, cached);
        }
        statuses[id] = { ...cached.status, cached: true };
        continue;
      }

      this.lastEvaluated.push(id);
      const entry: CacheEntry = {
        hash,
        outputs: new Map(),
        owned: [],
        tools: [],
        status: { id, state: "ok", cached: false },
      };
      try {
        await this.evaluate(feature, scope, sketches, bodies, entry);
      } catch (err) {
        entry.outputs.clear();
        entry.tools = [];
        entry.status = {
          id,
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          cached: false,
        };
      }
      if (cached) this.release(cached, entry);
      this.cache.set(id, entry);
      if (entry.status.state === "ok") {
        this.applyOutputs(feature, entry.outputs, bodies);
        this.ran.set(id, entry);
      }
      statuses[id] = entry.status;
    }

    // Forget cache entries of features that no longer run.
    for (const [id, entry] of this.cache) {
      if (!used.has(id)) {
        this.release(entry);
        this.cache.delete(id);
      }
    }

    this.bodies = bodies;
    this.sketches = sketches;

    const results: BodyResult[] = [];
    for (const [id, state] of bodies) {
      // A body without a record is reported when its id says which feature made it.
      const dynamic = doc.bodies[id] ? null : parseDynamicBodyId(id);
      if (!doc.bodies[id] && !dynamic) continue;
      const known = options.known?.[id] === state.hash;
      const result: BodyResult = {
        id,
        hash: state.hash,
        geometry: known ? null : state.geometry,
        names: known ? null : state.names,
      };
      if (dynamic) result.record = this.describeDynamicBody(doc, dynamic);
      results.push(result);
    }
    for (const id of [...this.topologyCache.keys()]) {
      if (!bodies.has(id)) this.topologyCache.delete(id);
    }

    return {
      bodies: results,
      planes: [...this.planes.values()],
      features: statuses,
      sketches: sketchStatuses,
      sketchUpdates,
      parameters,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Polyhedral topology of a body, as handed to manufacturing workspaces. `options` says how
   * finely curved faces are facetted; without them the kernel uses its own default.
   */
  bodyTopology(bodyId: string, options?: TessellationOptions): SolidTopology | null {
    const state = this.bodies.get(bodyId);
    if (!state) return null;
    const facets = options ? `${options.tolerance ?? ""}/${options.angularTolerance ?? ""}` : "";
    const cached = this.topologyCache.get(bodyId);
    if (cached && cached.hash === state.hash && cached.facets === facets) return cached.topology;
    const topology = options ? this.kernel.topology(state.shape, options) : this.kernel.topology(state.shape);
    this.topologyCache.set(bodyId, { hash: state.hash, facets, topology });
    return topology;
  }

  bodyGeometry(bodyId: string): BodyGeometry | null {
    return this.bodies.get(bodyId)?.geometry ?? null;
  }

  bodyNames(bodyId: string): BodyNames | null {
    return this.bodies.get(bodyId)?.names ?? null;
  }

  bodyIds(): string[] {
    return [...this.bodies.keys()];
  }

  sketchRegions(featureId: string): SketchRegion[] {
    return this.sketches.get(featureId)?.regions ?? [];
  }

  /**
   * STEP of bodies. A body may be listed more than once, each time placed by its own `steps`
   * (the instances of a component); the placed copies exist only for the export.
   */
  async exportSTEP(bodies: ExportItem[]): Promise<Uint8Array> {
    return this.withPlaced(bodies, (shapes) =>
      this.kernel.exportSTEP(shapes.map((s, i) => ({ shape: s, name: bodies[i]!.name ?? "" }))),
    );
  }

  /** STL of bodies, placed like `exportSTEP`. */
  async exportSTL(bodies: ExportItem[], binary = true): Promise<Uint8Array> {
    return this.withPlaced(bodies, (shapes) => this.kernel.exportSTL(shapes, { binary }));
  }

  private async withPlaced(
    items: ExportItem[],
    write: (shapes: KernelShape[]) => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    const made: KernelShape[] = [];
    try {
      const shapes: KernelShape[] = [];
      for (const item of items) {
        const s = this.bodies.get(item.id);
        if (!s) throw new Error(`"${item.name ?? item.id}" has no geometry at the current history position.`);
        if (item.steps && item.steps.length > 0) {
          const placed = this.kernel.transform(s.shape, item.steps);
          made.push(placed);
          shapes.push(placed);
        } else {
          shapes.push(s.shape);
        }
      }
      if (shapes.length === 0) throw new Error("There is no body to export.");
      return await write(shapes);
    } finally {
      for (const shape of made) this.kernel.dispose(shape);
    }
  }

  dispose(): void {
    for (const entry of this.cache.values()) this.release(entry);
    this.cache.clear();
    this.bodies.clear();
    this.topologyCache.clear();
  }

  // ------------------------------------------------------------------ internals

  private release(entry: CacheEntry, replacement?: CacheEntry): void {
    const keep = new Set<KernelShape>(replacement?.owned ?? []);
    for (const shape of entry.owned) {
      if (!keep.has(shape)) this.kernel.dispose(shape);
    }
  }

  private applyOutputs(
    feature: Feature,
    outputs: Map<string, BodyState>,
    bodies: Map<string, BodyState>,
  ): void {
    for (const [id, state] of outputs) bodies.set(id, state);
    for (const id of featureConsumedBodies(feature)) bodies.delete(id);
  }

  /**
   * Project the source geometry of every projection again, from the bodies as they are at this
   * point of the timeline. Returns the same sketch object when nothing moved.
   */
  private reproject(sketch: Sketch, bodies: Map<string, BodyState>): Sketch {
    let current = this.followPlane(this.followFace(sketch, bodies));
    if (sketch.projections.length === 0) return current;
    const plane = resolveSketchPlane(current.plane);
    for (const ref of sketch.projections) {
      const body = bodies.get(ref.bodyId);
      if (!body) continue;
      const geometry = body.geometry;
      let points: Vec3[];
      let hint: Vec3;
      let bezier: Vec3[] | undefined;
      let exact: MeshEdgeGroup | undefined;
      if (ref.source === "silhouette") {
        const index = ref.ref
          ? (resolveFaceRef(ref.ref, body)?.index ?? -1)
          : ref.index !== undefined && ref.count === geometry.faces.length
            ? ref.index
            : -1;
        if (index < 0) continue;
        // The silhouette nearest to where it was: a face can have several.
        let best: Vec3[] | null = null;
        let bestD = Infinity;
        for (const chain of faceSilhouettes(geometry, index, plane.normal)) {
          const mid = polylineMidpoint(chain);
          const d = Math.hypot(mid.x - ref.hint.x, mid.y - ref.hint.y, mid.z - ref.hint.z);
          if (d < bestD) {
            bestD = d;
            best = chain;
          }
        }
        if (!best) continue;
        points = best;
        hint = polylineMidpoint(best);
      } else if ((ref.source ?? "edge") === "vertex") {
        // Vertices have no name of their own: the index holds while the body keeps its
        // structure, then the position decides.
        const total = geometry.vertices.length / 3;
        const i = ref.index;
        const v =
          i !== undefined && ref.count === total && i < total
            ? {
                x: geometry.vertices[i * 3]!,
                y: geometry.vertices[i * 3 + 1]!,
                z: geometry.vertices[i * 3 + 2]!,
              }
            : nearestVertex(geometry, ref.hint);
        if (!v) continue;
        points = [v];
        hint = v;
      } else {
        let edge = ref.ref ? geometry.edges[resolveEdgeRef(ref.ref, body)?.index ?? -1] : undefined;
        if (!edge) {
          edge =
            ref.index !== undefined && ref.count === geometry.edges.length
              ? (geometry.edges[ref.index] ?? undefined)
              : undefined;
        }
        edge ??= nearestEdge(geometry, ref.hint) ?? undefined;
        if (!edge) continue;
        points = edgePolyline(geometry, edge);
        hint = edge.midpoint;
        bezier = edge.bezier;
        exact = edge;
      }
      const shape = projectCurve(plane, points, bezier, exact);
      const live = current.projections.find((r) => r.id === ref.id);
      if (!shape || !live) continue;
      current = updateProjection(current, live, shape, hint) ?? current;
    }
    return current;
  }

  /** A sketch drawn on a face of a body stays on that face when the body changes. */
  private followFace(sketch: Sketch, bodies: Map<string, BodyState>): Sketch {
    const plane = sketch.plane;
    if (plane.type !== "face" || !plane.ref) return sketch;
    const body = bodies.get(plane.bodyId);
    const found = body ? resolveFaceRef(plane.ref, body) : null;
    const face = found && body ? body.geometry.faces[found.index] : undefined;
    if (!face || face.surface !== "plane") return sketch;
    const n = norm3(face.normal);
    const d = n.x * face.center.x + n.y * face.center.y + n.z * face.center.z;
    const origin = { x: n.x * d, y: n.y * d, z: n.z * d };
    const next = makePlane(origin, n, plane.plane.xDir);
    const same =
      Math.hypot(
        next.origin.x - plane.plane.origin.x,
        next.origin.y - plane.plane.origin.y,
        next.origin.z - plane.plane.origin.z,
      ) < 1e-9 &&
      Math.hypot(
        next.normal.x - plane.plane.normal.x,
        next.normal.y - plane.plane.normal.y,
        next.normal.z - plane.plane.normal.z,
      ) < 1e-9;
    return same ? sketch : { ...sketch, plane: { ...plane, plane: next, hint: face.center } };
  }

  /** A sketch drawn on a construction plane stays on it when the plane moves. */
  private followPlane(sketch: Sketch): Sketch {
    const plane = sketch.plane;
    if (plane.type !== "plane") return sketch;
    const next = this.planes.get(plane.featureId)?.plane;
    if (!next || JSON.stringify(next) === JSON.stringify(plane.plane)) return sketch;
    return { ...sketch, plane: { ...plane, plane: next } };
  }

  private evaluateOffsetPlane(
    feature: Extract<Feature, { type: "offset-plane" }>,
    scope: Scope,
    bodies: Map<string, BodyState>,
  ): PlaneResult {
    const offset = evaluateAs(feature.offset, "length", scope);
    if (!Number.isFinite(offset)) throw new Error("The offset is not a number.");
    const patch = offsetPlanePatch(this.planePatch(feature.base, bodies), offset);
    return { id: feature.id, ...patch };
  }

  /** A plane together with the square patch of it that the view shows. */
  private planePatch(ref: PlaneReference, bodies: Map<string, BodyState>): PlanePatch {
    if (ref.type === "origin-plane") return originPlanePatch(ref.plane);
    if (ref.type === "plane") {
      const found = this.planes.get(ref.featureId);
      if (!found) throw new Error("The plane this feature refers to is missing or suppressed.");
      return found;
    }
    const body = this.requireBody(bodies, ref.bodyId);
    const { index } = this.planeOfFace(body, ref.ref);
    const patch = facePlanePatch(body.geometry, index);
    if (!patch) throw new Error("The selected face is not planar. Select a flat face.");
    return patch;
  }

  private evaluateSketch(feature: Extract<Feature, { type: "sketch" }>, scope: Scope): SketchEval {
    const info = solveSketchWithParameters(feature.sketch, this.solver, scope);
    const sketch = info.converged ? info.sketch : feature.sketch;
    const plane = resolveSketchPlane(sketch.plane);
    const regions = detectProfiles(sketch);
    // Texts count through the key of their outlines, not through the outlines themselves.
    const texts = Object.values(sketch.texts ?? {}).map((t) => [
      t.id,
      t.origin,
      t.construction === true,
      t.outline?.key ?? null,
      t.outline?.rotation ?? 0,
    ]);
    const geometryKey = JSON.stringify([sketch.entities, plane, texts]);
    return {
      sketch,
      hash: hashString(geometryKey),
      plane,
      regions,
      status: {
        featureId: feature.id,
        status: info.status,
        degreesOfFreedom: info.degreesOfFreedom,
        conflicting: info.conflicting,
        regionCount: regions.length,
        dimensionErrors: info.dimensionErrors,
      },
      lineEnds: (entityId) => {
        const e = sketch.entities[entityId];
        if (!e || e.type !== "line") return null;
        return [
          planeToWorld(plane, getPoint(sketch, e.p1)),
          planeToWorld(plane, getPoint(sketch, e.p2)),
        ];
      },
    };
  }

  private inputHash(
    feature: Feature,
    scope: Scope,
    sketches: Map<string, SketchEval>,
    bodies: Map<string, BodyState>,
  ): string {
    // The display name does not influence geometry.
    const { name: _name, ...definition } = feature;
    void _name;
    const parts: unknown[] = [feature.type === "import" ? { ...definition, data: hashString(feature.data) } : definition];
    for (const e of featureExpressions(feature)) {
      parts.push(evaluateAs(e.expression, e.kind, scope));
    }
    for (const id of featureInputSketches(feature)) parts.push(sketches.get(id)?.hash ?? "");
    // A pattern of features repeats what those features did when they ran.
    for (const id of featureInputFeatures(feature)) {
      parts.push([id, this.ran.get(id)?.hash ?? "missing"]);
    }
    for (const id of featureInputPlanes(feature)) {
      parts.push([id, this.planes.get(id)?.plane ?? "missing"]);
    }
    const lookup = (id: string): Feature | undefined => this.features[id];
    for (const b of featureInputBodies(feature, lookup)) {
      parts.push([b, bodies.get(b)?.hash ?? "missing"]);
    }
    return hashString(JSON.stringify(parts));
  }

  private requireBody(bodies: Map<string, BodyState>, id: string): BodyState {
    const b = bodies.get(id);
    if (!b) throw new Error("A body used by this feature no longer exists.");
    return b;
  }

  private resolveProfiles(
    sketches: Map<string, SketchEval>,
    sketchId: string,
    refs: ProfileRef[],
  ): { sketch: SketchEval; profiles: Profile2[] } {
    const sketch = sketches.get(sketchId);
    if (!sketch) throw new Error("The sketch used by this feature is missing or suppressed.");
    if (refs.length === 0) throw new Error("No profile selected.");
    const picked = new Map<string, SketchRegion>();
    for (const ref of refs) {
      const regions = resolveProfileRefs(sketch.regions, ref);
      if (regions.length === 0) {
        throw new Error(
          ref.textId !== undefined
            ? "The selected text no longer exists in the sketch or has no outline."
            : "A selected profile no longer exists in the sketch.",
        );
      }
      for (const region of regions) picked.set(region.id, region);
    }
    return { sketch, profiles: [...picked.values()].map((r) => r.profile) };
  }

  /** Tessellate a shape and put it into the form bodies are kept in. */
  private named(shape: KernelShape, hash: string, names: (g: BodyGeometry) => BodyNames): BodyState {
    const geometry = this.kernel.tessellate(shape);
    return { shape, hash, geometry, names: names(geometry) };
  }

  /**
   * Names for a solid swept from sketch profiles. `toSketch` maps a point on a side face back
   * to the point of the sketch it was generated from; `cap` tells the end faces apart.
   */
  private sweptNames(
    featureId: string,
    sketch: SketchEval,
    sketchId: string,
    cap: (sample: FaceSample, surface: string) => "start" | "end" | null,
    toSketch: (p: Vec3) => { x: number; y: number } | null,
  ): (g: BodyGeometry) => BodyNames {
    return (g) =>
      nameSolid(g, featureId, (faceIndex, samples) => {
        const first = samples[0];
        if (!first) return null;
        const role = cap(first, g.faces[faceIndex]!.surface);
        if (role) return { role };
        // The sketch curve that most of the samples lie on.
        const votes = new Map<string, number>();
        for (const s of samples) {
          const p = toSketch(s.point);
          if (!p) continue;
          const hit = hitTestSketch(sketch.sketch, p, 0.2, { points: false });
          const e = hit ? sketch.sketch.entities[hit.id] : undefined;
          if (hit && e && e.type !== "point" && !e.construction) {
            votes.set(hit.id, (votes.get(hit.id) ?? 0) + 1);
            continue;
          }
          // Faces made from the outline of a text are named after the text.
          const text = sketch.sketch.texts ? textOutlineAt(sketch.sketch, p, 0.2) : null;
          if (text) votes.set(text, (votes.get(text) ?? 0) + 1);
        }
        const entity = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return entity ? { role: "side", sketch: sketchId, entity } : { role: "side" };
      });
  }

  private applyOperation(
    feature: OperationTarget,
    tool: KernelShape,
    toolNames: (g: BodyGeometry) => BodyNames,
    bodies: Map<string, BodyState>,
    entry: CacheEntry,
  ): void {
    entry.owned.push(tool);
    const made = this.named(tool, entry.hash, toolNames);
    if (feature.operation === "new") {
      requireSolid(this.kernel, tool, "The result is not a valid solid.");
      entry.outputs.set(feature.bodyId, made);
      entry.tools.push({ tool: made, operation: "join", targets: [feature.bodyId] });
      return;
    }
    if (feature.targetBodyIds.length === 0) throw new Error("No target body selected.");
    entry.tools.push({
      tool: made,
      operation: feature.operation,
      targets: feature.targetBodyIds.slice(),
    });
    const op =
      feature.operation === "join" ? "union" : feature.operation === "cut" ? "cut" : "intersect";
    for (const targetId of feature.targetBodyIds) {
      const target = this.requireBody(bodies, targetId);
      const result = this.kernel.boolean(op, target.shape, [tool]);
      entry.owned.push(result);
      requireSolid(this.kernel, result, "The operation removes the whole body.");
      entry.outputs.set(
        targetId,
        this.named(result, hashString(entry.hash + targetId), (g) =>
          propagateNames([target, made], g, feature.id),
        ),
      );
    }
  }

  /** Indices of the edges that references point at, in the body as it is now. */
  private edgeSelection(refs: TopologyRef[], body: BodyState): { index: number; point: Vec3 }[] {
    const out = new Map<number, { index: number; point: Vec3 }>();
    for (const ref of refs) {
      const found = resolveEdgeRef(ref, body);
      if (found) out.set(found.index, { index: found.index, point: ref.point });
    }
    return [...out.values()];
  }

  private faceSelection(refs: TopologyRef[], body: BodyState): { index: number; point: Vec3 }[] {
    const out = new Map<number, { index: number; point: Vec3 }>();
    for (const ref of refs) {
      const found = resolveFaceRef(ref, body);
      if (found) out.set(found.index, { index: found.index, point: ref.point });
    }
    return [...out.values()];
  }

  // ------------------------------------------------------- dynamic bodies

  /** What the document needs to know to make a record for a body with a derived id. */
  private describeDynamicBody(doc: CadDocument, id: DynamicBodyId): Omit<DynamicBodyInfo, "id"> {
    const owner = doc.features[id.featureId];
    // The source may be a derived body itself: follow it down to a body with a record.
    let source = doc.bodies[id.sourceBodyId];
    for (let next = parseDynamicBodyId(id.sourceBodyId); !source && next; ) {
      source = doc.bodies[next.sourceBodyId];
      next = parseDynamicBodyId(next.sourceBodyId);
    }
    const base = source?.name ?? "Body";
    const by = owner?.name ?? "copy";
    const single = owner?.type === "mirror" || owner?.type === "move" || owner?.type === "split";
    return {
      createdBy: id.featureId,
      sourceBodyId: id.sourceBodyId,
      suggestedName: single ? `${base} (${by})` : `${base} (${by} ${id.instance})`,
      componentId: source?.componentId ?? owner?.componentId ?? doc.assembly.rootComponentId,
    };
  }

  // ------------------------------------------------------------ references

  private requireSketch(sketches: Map<string, SketchEval>, id: string): SketchEval {
    const sketch = sketches.get(id);
    if (!sketch) throw new Error("The sketch used by this feature is missing or suppressed.");
    return sketch;
  }

  /**
   * A line in space from a direction or axis reference. `circular` allows the edge to be a
   * circle or an arc, whose axis is then the line.
   */
  private resolveAxis(
    ref: PatternDirection | PatternAxis,
    sketches: Map<string, SketchEval>,
    bodies: Map<string, BodyState>,
    circular: boolean,
  ): { origin: Vec3; direction: Vec3 } {
    if (ref.type === "origin-axis") {
      return { origin: { x: 0, y: 0, z: 0 }, direction: ORIGIN_AXES[ref.axis] };
    }
    if (ref.type === "sketch-line") {
      const ends = this.requireSketch(sketches, ref.sketchId).lineEnds(ref.entityId);
      if (!ends || dist3(ends[0], ends[1]) < 1e-9) {
        throw new Error("The sketch line that gives the direction no longer exists.");
      }
      return { origin: ends[0], direction: norm3(sub3(ends[1], ends[0])) };
    }
    const body = this.requireBody(bodies, ref.bodyId);
    const found = resolveEdgeRef(ref.ref, body);
    const edge = found ? body.geometry.edges[found.index] : undefined;
    if (!edge) throw new Error("The edge that gives the direction no longer exists.");
    if (edge.curve === "line" && dist3(edge.from, edge.to) > 1e-9) {
      return { origin: edge.from, direction: norm3(sub3(edge.to, edge.from)) };
    }
    if (circular && edge.curve === "circle" && edge.center) {
      // The plane of the circle from three of its points that are well apart.
      const pts = edgePolyline(body.geometry, edge);
      const a = pts[0];
      const b = pts[Math.floor(pts.length / 3)];
      const c = pts[Math.floor((2 * pts.length) / 3)];
      const normal = a && b && c ? cross3(sub3(b, a), sub3(c, a)) : { x: 0, y: 0, z: 0 };
      if (len3(normal) > 1e-12) return { origin: edge.center, direction: norm3(normal) };
    }
    throw new Error(
      circular
        ? "Select a straight edge, or a circular edge for its axis."
        : "Select a straight edge for the direction.",
    );
  }

  private resolvePlane(ref: PlaneReference, bodies: Map<string, BodyState>): Plane3 {
    if (ref.type === "origin-plane") return ORIGIN_PLANES[ref.plane];
    if (ref.type === "plane") return this.planePatch(ref, bodies).plane;
    const body = this.requireBody(bodies, ref.bodyId);
    return this.planeOfFace(body, ref.ref).plane;
  }

  /** The plane of a planar face, its normal pointing out of the body. */
  private planeOfFace(body: BodyState, ref: TopologyRef): { plane: Plane3; index: number } {
    const found = resolveFaceRef(ref, body);
    const face = found ? body.geometry.faces[found.index] : undefined;
    if (!found || !face) throw new Error("The selected face no longer exists.");
    if (face.surface !== "plane") throw new Error("The selected face is not planar. Select a flat face.");
    return { plane: makePlane(face.center, face.normal), index: found.index };
  }

  private resolvePoint(
    ref: Point3Ref,
    sketches: Map<string, SketchEval>,
    bodies: Map<string, BodyState>,
  ): Vec3 {
    if (ref.type === "fixed") return ref.point;
    if (ref.type === "sketch-point") {
      const sketch = this.requireSketch(sketches, ref.sketchId);
      const e = sketch.sketch.entities[ref.entityId];
      if (!e || e.type !== "point") throw new Error("The selected sketch point no longer exists.");
      return planeToWorld(sketch.plane, e);
    }
    const point = resolveVertexRef(ref, this.requireBody(bodies, ref.bodyId));
    if (!point) throw new Error("The selected vertex no longer exists.");
    return point;
  }

  /** A count: a whole number of at least one. Values in between are rounded. */
  private evaluateCount(expression: string, scope: Scope, what: string): number {
    const value = evaluateAs(expression, "none", scope);
    if (!Number.isFinite(value)) throw new Error(`${what} is not a number.`);
    const count = Math.round(value);
    if (count < 1) throw new Error(`${what} must be at least 1.`);
    return count;
  }

  // -------------------------------------------------------------- patterns

  /** The copies a pattern makes, without the original. */
  private patternInstances(
    feature: Extract<Feature, { type: "rectangular-pattern" | "circular-pattern" | "mirror" }>,
    scope: Scope,
    sketches: Map<string, SketchEval>,
    bodies: Map<string, BodyState>,
  ): PatternInstance[] {
    if (feature.type === "mirror") {
      const plane = this.resolvePlane(feature.plane, bodies);
      return [{ label: "1", steps: [{ type: "mirror", origin: plane.origin, normal: plane.normal }] }];
    }
    const out: PatternInstance[] = [];
    if (feature.type === "circular-pattern") {
      const axis = this.resolveAxis(feature.axis, sketches, bodies, true);
      const count = this.evaluateCount(feature.count, scope, "The number of instances");
      const total = evaluateAs(feature.angle, "angle", scope) * (feature.flip ? -1 : 1);
      if (!Number.isFinite(total)) throw new Error("The angle is not a number.");
      if (count > 1 && Math.abs(total) < 1e-9) throw new Error("The angle must not be zero.");
      if (count > MAX_PATTERN_INSTANCES) {
        throw new Error(`A pattern can have at most ${MAX_PATTERN_INSTANCES} instances.`);
      }
      // A full turn: the last instance would land on the first, so the turn is divided by the
      // number of instances, not by the number of gaps.
      const full = Math.abs(total) >= 360 - 1e-9;
      const step = full ? (Math.sign(total) * 360) / count : total / Math.max(1, count - 1);
      for (let i = 1; i < count; i++) {
        out.push({
          label: String(i),
          steps: [{ type: "rotate", origin: axis.origin, axis: axis.direction, angle: step * i }],
        });
      }
      return out;
    }
    const first = this.resolveAxis(feature.direction, sketches, bodies, false).direction;
    const count = this.evaluateCount(feature.count, scope, "The number of instances");
    const spacing = evaluateAs(feature.distance, "length", scope) * (feature.flip ? -1 : 1);
    if (!Number.isFinite(spacing)) throw new Error("The spacing is not a number.");
    if (count > 1 && Math.abs(spacing) < 1e-9) throw new Error("The spacing must not be zero.");
    let second: Vec3 = { x: 0, y: 0, z: 0 };
    let count2 = 1;
    let spacing2 = 0;
    if (feature.direction2) {
      second = this.resolveAxis(feature.direction2, sketches, bodies, false).direction;
      count2 = this.evaluateCount(feature.count2 ?? "1", scope, "The number of instances in the second direction");
      spacing2 = evaluateAs(feature.distance2 ?? "0", "length", scope) * (feature.flip2 ? -1 : 1);
      if (!Number.isFinite(spacing2)) throw new Error("The spacing in the second direction is not a number.");
      if (count2 > 1 && Math.abs(spacing2) < 1e-9) {
        throw new Error("The spacing in the second direction must not be zero.");
      }
      if (count2 > 1 && len3(cross3(first, second)) < 1e-9) {
        throw new Error("The two directions of the pattern are parallel. Select another second direction.");
      }
    }
    if (count * count2 > MAX_PATTERN_INSTANCES) {
      throw new Error(`A pattern can have at most ${MAX_PATTERN_INSTANCES} instances.`);
    }
    for (let j = 0; j < count2; j++) {
      for (let i = 0; i < count; i++) {
        if (i === 0 && j === 0) continue;
        const vector = add3(scale3(first, spacing * i), scale3(second, spacing2 * j));
        // The first row is numbered like a pattern in one direction, so that adding a second
        // direction later does not rename what is there.
        out.push({ label: j === 0 ? String(i) : `${i}.${j}`, steps: [{ type: "translate", vector }] });
      }
    }
    return out;
  }

  /** A copy of a shape at a pattern instance, named after the instance. */
  private instanceOf(
    source: BodyState,
    instance: PatternInstance,
    featureId: string,
    hash: string,
    entry: CacheEntry,
  ): BodyState {
    const shape = this.kernel.transform(source.shape, instance.steps);
    entry.owned.push(shape);
    return this.named(shape, hash, (g) => {
      const names = instanceNames(source.names, g, featureId, instance.label);
      // A copy that lost the structure of its source has nothing to inherit names by.
      return names ?? nameSolid(g, featureId, () => ({ role: "face", instance: instance.label }));
    });
  }

  private applyPattern(
    feature: { id: string; source: PatternSource },
    instances: PatternInstance[],
    bodies: Map<string, BodyState>,
    entry: CacheEntry,
  ): void {
    const source = feature.source;
    if (source.kind === "bodies") {
      if (source.bodyIds.length === 0) throw new Error("Select at least one body.");
      for (const bodyId of source.bodyIds) {
        const body = this.requireBody(bodies, bodyId);
        for (const instance of instances) {
          const id = dynamicBodyId(feature.id, bodyId, instance.label);
          entry.outputs.set(
            id,
            this.instanceOf(body, instance, feature.id, hashString(entry.hash + id), entry),
          );
        }
      }
      return;
    }

    if (source.featureIds.length === 0) throw new Error("Select at least one feature.");
    const applications: ToolApplication[] = [];
    for (const id of source.featureIds) {
      const name = this.features[id]?.name ?? id;
      const done = this.ran.get(id);
      if (!done) {
        throw new Error(
          `"${name}" did not produce a result: it is missing, suppressed, failed or comes later in the timeline.`,
        );
      }
      if (done.tools.length === 0) {
        throw new Error(
          `"${name}" cannot be repeated: only features that add or remove material (Extrude, Revolve, Sweep, Loft, Hole and patterns of them) can. Pattern the body instead.`,
        );
      }
      applications.push(...done.tools);
    }

    // Bodies as they are being built up, with everything whose faces they may inherit.
    const work = new Map<string, { shape: KernelShape; inputs: NamedBody[] }>();
    applications.forEach((application, k) => {
      const copies = instances.map((instance) => {
        const hash = hashString(`${entry.hash}:${k}:${instance.label}`);
        const copy = this.instanceOf(application.tool, instance, feature.id, hash, entry);
        entry.tools.push({ tool: copy, operation: application.operation, targets: application.targets });
        return copy;
      });
      if (copies.length === 0) return;
      const op =
        application.operation === "join" ? "union" : application.operation === "cut" ? "cut" : "intersect";
      for (const targetId of application.targets) {
        let state = work.get(targetId);
        if (!state) {
          const target = this.requireBody(bodies, targetId);
          state = { shape: target.shape, inputs: [target] };
          work.set(targetId, state);
        }
        const result = this.kernel.boolean(op, state.shape, copies.map((c) => c.shape));
        entry.owned.push(result);
        requireSolid(this.kernel, result, "The pattern removes the whole body.");
        state.shape = result;
        state.inputs.push(...copies);
      }
    });
    for (const [targetId, state] of work) {
      const inputs = state.inputs;
      entry.outputs.set(
        targetId,
        this.named(state.shape, hashString(entry.hash + targetId), (g) =>
          propagateNames(inputs, g, feature.id),
        ),
      );
    }
  }

  // ------------------------------------------------------------------ move

  /** A body after a rigid move. Its topology is that of the source: the names carry over. */
  private moved(source: BodyState, steps: ShapeTransform[], hash: string, entry: CacheEntry): BodyState {
    const shape = this.kernel.transform(source.shape, steps);
    entry.owned.push(shape);
    return this.named(shape, hash, (g) => {
      if (g.faces.length !== source.names.faces.length) {
        throw new Error("The body changed its structure while it was moved.");
      }
      return g.edges.length === source.names.edges.length
        ? source.names
        : { faces: source.names.faces, edges: nameEdges(g, source.names.faces) };
    });
  }

  // ----------------------------------------------------------------- sweep

  /**
   * Put the curves of a path in order, each one turned so that it starts where the one before
   * ends. The path starts at the end that is nearer to `near` (sketch coordinates).
   */
  private orderPath(
    sketch: SketchEval,
    entityIds: string[],
    near: (p: Vec2) => number,
  ): { curves: Curve2[]; closed: boolean } {
    const tolerance = 1e-6;
    const pieces = [...new Set(entityIds)].map((id) => {
      const e = sketch.sketch.entities[id];
      if (!e || e.type === "point") throw new Error("A curve of the path no longer exists in the sketch.");
      if (e.type === "ellipse") {
        throw new Error("An ellipse cannot be used as a path. Use lines, arcs, circles and splines.");
      }
      const curves = entityToCurves(sketch.sketch, e);
      const first = curves[0];
      const last = curves[curves.length - 1];
      if (!first || !last) throw new Error("A curve of the path is empty.");
      return { curves, start: curveStart(first), end: curveEnd(last) };
    });
    if (pieces.length === 0) throw new Error("Select a path.");

    const reversed = (curves: Curve2[]): Curve2[] => curves.map(reverseCurve).reverse();
    const selfClosed = pieces.filter((p) => dist2(p.start, p.end) < tolerance);
    if (selfClosed.length > 0) {
      // A circle or a closed spline is a path by itself.
      if (pieces.length > 1) throw new Error("The path branches: a closed curve cannot be joined by others.");
      return { curves: pieces[0]!.curves, closed: true };
    }

    const ends = pieces.flatMap((p) => [p.start, p.end]);
    const degree = (p: Vec2): number => ends.filter((q) => dist2(p, q) < tolerance).length;
    if (ends.some((p) => degree(p) > 2)) {
      throw new Error("The path branches: more than two curves meet in one point.");
    }
    const open = ends.filter((p) => degree(p) === 1);
    if (open.length > 2) throw new Error("The curves of the path are not connected end to end.");
    const closed = open.length === 0;
    const candidates = closed ? ends : open;
    let at = candidates[0]!;
    for (const p of candidates) if (near(p) < near(at) - 1e-9) at = p;

    const rest = pieces.slice();
    const curves: Curve2[] = [];
    while (rest.length > 0) {
      const here = at;
      const k = rest.findIndex(
        (p) => dist2(p.start, here) < tolerance || dist2(p.end, here) < tolerance,
      );
      if (k < 0) throw new Error("The curves of the path are not connected end to end.");
      const piece = rest.splice(k, 1)[0]!;
      const forward = dist2(piece.start, here) < tolerance;
      curves.push(...(forward ? piece.curves : reversed(piece.curves)));
      at = forward ? piece.end : piece.start;
    }
    return { curves, closed };
  }

  /** Curves of a sketch as pieces of a path in space. */
  private pathInSpace(curves: Curve2[], plane: Plane3): PathCurve3[] {
    const at = (p: Vec2): Vec3 => planeToWorld(plane, p);
    const out: PathCurve3[] = [];
    for (const c of curves) {
      if (c.type === "line") {
        if (dist2(c.a, c.b) > 1e-9) out.push({ type: "line", from: at(c.a), to: at(c.b) });
      } else if (c.type === "arc") {
        // Three points fix an arc well only while it is clearly less than a full turn.
        const n = Math.max(1, Math.ceil(Math.abs(c.sweep) / Math.PI - 1e-9));
        for (let i = 0; i < n; i++) {
          const part = subCurve(c, i / n, (i + 1) / n);
          out.push({
            type: "arc",
            from: at(curveStart(part)),
            via: at(curvePointAt(part, 0.5)),
            to: at(curveEnd(part)),
          });
        }
      } else if (c.type === "bezier") {
        out.push({ type: "bezier", points: [at(c.p0), at(c.p1), at(c.p2), at(c.p3)] });
      } else {
        throw new Error("An ellipse cannot be used as a path. Use lines, arcs, circles and splines.");
      }
    }
    if (out.length === 0) throw new Error("The path has no length.");
    return out;
  }

  // ------------------------------------------------------------------ hole

  /**
   * Direction in which a hole is drilled: against the normal of the sketch plane. Only a
   * sketch that is not on a face can have the whole body on the normal side of its plane;
   * there the hole goes the other way, because that is where the material is.
   */
  private holeDirection(sketch: SketchEval, body: BodyState, flip: boolean): Vec3 {
    const plane = sketch.plane;
    let direction = scale3(plane.normal, -1);
    if (sketch.sketch.plane.type !== "face") {
      const { min, max } = body.geometry.bounds;
      let lowest = Infinity;
      let highest = -Infinity;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            const h = distanceToPlane(plane, { x, y, z });
            lowest = Math.min(lowest, h);
            highest = Math.max(highest, h);
          }
        }
      }
      if (lowest > -1e-6 && highest > 1e-6) direction = plane.normal;
    }
    return flip ? scale3(direction, -1) : direction;
  }

  private async evaluate(
    feature: Exclude<Feature, { type: "sketch" }>,
    scope: Scope,
    sketches: Map<string, SketchEval>,
    bodies: Map<string, BodyState>,
    entry: CacheEntry,
  ): Promise<void> {
    const kernel = this.kernel;
    switch (feature.type) {
      case "extrude": {
        const { sketch, profiles } = this.resolveProfiles(
          sketches,
          feature.sketchId,
          feature.profiles,
        );
        let from: number;
        let to: number;
        if (feature.to) {
          // Up to the target, measured again every time, on whichever side it is.
          const target = feature.to;
          const reach = extrudeReach(
            sketch.plane,
            target.type === "origin-plane" || target.type === "face" || target.type === "plane"
              ? { plane: this.resolvePlane(target, bodies) }
              : { point: this.resolvePoint(target, sketches, bodies) },
          );
          [from, to] = reach < 0 ? [reach, 0] : [0, reach];
        } else {
          const d = evaluateAs(feature.distance, "length", scope);
          if (Math.abs(d) < 1e-9) throw new Error("Distance must not be zero.");
          [from, to] =
            feature.direction === "symmetric"
              ? [-d / 2, d / 2]
              : feature.direction === "negative"
                ? [-d, 0]
                : [0, d];
        }
        const tool = kernel.extrude(profiles, sketch.plane, from, to);
        const plane = sketch.plane;
        // "start" is the end of the extrusion that lies on the sketch side.
        const near = Math.abs(from) <= Math.abs(to) ? from : to;
        const names = this.sweptNames(
          feature.id,
          sketch,
          feature.sketchId,
          (s, surface) => {
            if (surface !== "plane") return null;
            const along = dot3(s.normal, plane.normal);
            if (Math.abs(along) < 0.999) return null;
            const h = distanceToPlane(plane, s.point);
            return Math.abs(h - near) < 1e-6 ? "start" : "end";
          },
          (p) => worldToPlane(plane, p),
        );
        this.applyOperation(feature, tool, names, bodies, entry);
        return;
      }
      case "revolve": {
        const { sketch, profiles } = this.resolveProfiles(
          sketches,
          feature.sketchId,
          feature.profiles,
        );
        const angle = evaluateAs(feature.angle, "angle", scope);
        let origin: Vec3 = { x: 0, y: 0, z: 0 };
        let direction: Vec3;
        if (feature.axis.type === "origin-axis") {
          direction = ORIGIN_AXES[feature.axis.axis];
        } else {
          const ends = sketch.lineEnds(feature.axis.entityId);
          if (!ends) throw new Error("The revolve axis no longer exists in the sketch.");
          origin = ends[0];
          direction = norm3(sub3(ends[1], ends[0]));
        }
        const tool = kernel.revolve(profiles, sketch.plane, origin, direction, angle);
        const plane = sketch.plane;
        const full = Math.abs(Math.abs(angle) - 360) < 1e-9;
        // Side of the axis on which the profile lies, within the sketch plane.
        const inside = profiles[0] ? curveStart(profiles[0].outer.curves[0]!) : { x: 0, y: 0 };
        const reference = sub3(planeToWorld(plane, inside), origin);
        const axial = dot3(reference, direction);
        const radial = norm3(sub3(reference, scale3(direction, axial)));
        const names = this.sweptNames(
          feature.id,
          sketch,
          feature.sketchId,
          (s, surface) => {
            if (full || surface !== "plane") return null;
            // The end faces contain the axis: their normal is perpendicular to it.
            if (Math.abs(dot3(s.normal, direction)) > 1e-3) return null;
            const inPlane = Math.abs(distanceToPlane(plane, s.point)) < 1e-6;
            return inPlane && Math.abs(dot3(s.normal, plane.normal)) > 0.999 ? "start" : "end";
          },
          (p) => {
            // Turn the point back about the axis into the sketch plane.
            const rel = sub3(p, origin);
            const a = dot3(rel, direction);
            const r = len3(sub3(rel, scale3(direction, a)));
            return worldToPlane(plane, add3(origin, add3(scale3(direction, a), scale3(radial, r))));
          },
        );
        this.applyOperation(feature, tool, names, bodies, entry);
        return;
      }
      case "boolean": {
        const target = this.requireBody(bodies, feature.targetBodyId);
        const tools = feature.toolBodyIds.map((id) => this.requireBody(bodies, id));
        const result = kernel.boolean(
          feature.operation,
          target.shape,
          tools.map((t) => t.shape),
        );
        entry.owned.push(result);
        requireSolid(kernel, result, "The result is empty.");
        entry.outputs.set(
          feature.targetBodyId,
          this.named(result, entry.hash, (g) => propagateNames([target, ...tools], g, feature.id)),
        );
        return;
      }
      case "fillet":
      case "chamfer": {
        const body = this.requireBody(bodies, feature.bodyId);
        const size =
          feature.type === "fillet"
            ? evaluateAs(feature.radius, "length", scope)
            : evaluateAs(feature.distance, "length", scope);
        const edges = this.edgeSelection(feature.edges, body);
        if (edges.length === 0) throw new Error("The selected edge no longer exists.");
        const result =
          feature.type === "fillet"
            ? kernel.fillet(body.shape, edges, size)
            : kernel.chamfer(body.shape, edges, size);
        entry.owned.push(result);
        // A valid body must not come out broken: OpenCASCADE may return a fillet that does not
        // close up (a tiny radius where faces meet tangentially) without reporting it.
        if (kernel.solidProblem(body.shape) === null && kernel.solidProblem(result) !== null) {
          const what = feature.type === "fillet" ? "fillet" : "chamfer";
          throw new Error(
            `The ${what} gives a broken solid. Try another size, or leave out edges along which faces meet tangentially.`,
          );
        }
        const indices = edges.map((e) => e.index);
        entry.outputs.set(
          feature.bodyId,
          this.named(result, entry.hash, (g) =>
            propagateNames([body], g, feature.id, (_i, samples) => {
              const of = nearestNamedEdge(body, indices, samples);
              return of ? { role: feature.type, of: [of] } : { role: feature.type };
            }),
          ),
        );
        return;
      }
      case "shell": {
        const body = this.requireBody(bodies, feature.bodyId);
        const thickness = evaluateAs(feature.thickness, "length", scope);
        const faces = this.faceSelection(feature.faces, body);
        if (faces.length === 0) throw new Error("The selected face no longer exists.");
        const result = kernel.shell(body.shape, faces, thickness);
        entry.owned.push(result);
        const removed = new Set(faces.map((f) => f.index));
        entry.outputs.set(
          feature.bodyId,
          this.named(result, entry.hash, (g) =>
            propagateNames(
              [body],
              g,
              feature.id,
              (_i, samples) => {
              const s = samples[0];
              if (!s) return null;
              // The rim of an opening lies where the removed face was.
              for (const k of removed) {
                const hit = distanceToFace(body.geometry, k, s.point);
                const name = body.names.faces[k]?.key;
                if (name && hit.distance < 2e-3 && Math.abs(dot3(hit.normal, s.normal)) > 0.985) {
                  return { role: "rim", of: [name] };
                }
              }
              // An inner wall lies one wall thickness inside the outer face it follows.
              const out = add3(s.point, scale3(s.normal, -thickness));
              let best: string | null = null;
              let bestD = Math.max(1e-3, thickness * 0.02);
              body.geometry.faces.forEach((_f, k) => {
                if (removed.has(k)) return;
                const hit = distanceToFace(body.geometry, k, out);
                if (hit.distance < bestD && Math.abs(dot3(hit.normal, s.normal)) > 0.985) {
                  bestD = hit.distance;
                  best = body.names.faces[k]?.key ?? null;
                }
              });
              return best ? { role: "shell", of: [best] } : { role: "shell" };
              },
              (_input, k) => removed.has(k),
            ),
          ),
        );
        return;
      }
      case "hole": {
        const body = this.requireBody(bodies, feature.bodyId);
        const sketch = this.requireSketch(sketches, feature.sketchId);
        if (feature.points.length === 0) throw new Error("Select at least one sketch point.");
        const direction = this.holeDirection(sketch, body, feature.flip ?? false);
        const diameter = evaluateAs(feature.diameter, "length", scope);
        if (!(diameter > 0)) throw new Error("The hole diameter must be positive.");
        const counterbore =
          feature.holeType === "counterbore"
            ? {
                diameter: evaluateAs(feature.counterboreDiameter, "length", scope),
                depth: evaluateAs(feature.counterboreDepth, "length", scope),
              }
            : undefined;
        const countersink =
          feature.holeType === "countersink"
            ? {
                diameter: evaluateAs(feature.countersinkDiameter, "length", scope),
                angle: evaluateAs(feature.countersinkAngle, "angle", scope),
              }
            : undefined;
        const blind = feature.extent === "distance" ? evaluateAs(feature.depth, "length", scope) : 0;
        if (feature.extent === "distance" && !(blind > 0)) {
          throw new Error("The hole depth must be positive.");
        }
        const { min, max } = body.geometry.bounds;
        const holes = feature.points.map((id) => {
          const e = sketch.sketch.entities[id];
          if (!e || e.type !== "point") {
            throw new Error("A point of this hole no longer exists in the sketch.");
          }
          const position = planeToWorld(sketch.plane, e);
          let depth = blind;
          if (feature.extent === "through-all") {
            // As far as the body reaches in the drilling direction, whatever its size.
            let reach = -Infinity;
            for (const x of [min.x, max.x]) {
              for (const y of [min.y, max.y]) {
                for (const z of [min.z, max.z]) {
                  reach = Math.max(reach, dot3(sub3({ x, y, z }, position), direction));
                }
              }
            }
            if (!(reach > 1e-9)) {
              throw new Error("The hole points away from the body. Flip its direction.");
            }
            depth = reach + 1;
          }
          const spec: HoleSpec = { position, direction, diameter, depth };
          if (counterbore) spec.counterbore = counterbore;
          if (countersink) spec.countersink = countersink;
          return { id, spec };
        });
        const tool = kernel.hole(holes.map((h) => h.spec));
        const names = (g: BodyGeometry): BodyNames =>
          nameSolid(g, feature.id, (faceIndex, samples) => {
            const s = samples[0];
            if (!s) return null;
            // The hole whose axis the face lies closest to.
            let best = holes[0]!;
            let bestD = Infinity;
            let depth = 0;
            for (const h of holes) {
              const rel = sub3(s.point, h.spec.position);
              const along = dot3(rel, direction);
              const radial = len3(sub3(rel, scale3(direction, along)));
              if (radial < bestD) {
                bestD = radial;
                best = h;
                depth = along;
              }
            }
            const surface = g.faces[faceIndex]!.surface;
            let role = "hole";
            if (surface === "plane") {
              role =
                depth < 1e-6
                  ? "hole-top"
                  : counterbore && Math.abs(depth - counterbore.depth) < 1e-6
                    ? "counterbore-bottom"
                    : "hole-bottom";
            } else if (surface === "cone") {
              role = "countersink";
            } else if (counterbore && depth < counterbore.depth) {
              role = "counterbore";
            }
            return { role, sketch: feature.sketchId, entity: best.id };
          });
        this.applyOperation(
          { id: feature.id, operation: "cut", targetBodyIds: [feature.bodyId], bodyId: "" },
          tool,
          names,
          bodies,
          entry,
        );
        const after = entry.outputs.get(feature.bodyId);
        if (after && !(after.geometry.volume < body.geometry.volume - 1e-9)) {
          throw new Error(
            "The hole does not remove any material. Check where its points are and flip its direction.",
          );
        }
        return;
      }
      case "rectangular-pattern":
      case "circular-pattern":
      case "mirror": {
        const instances = this.patternInstances(feature, scope, sketches, bodies);
        this.applyPattern(feature, instances, bodies, entry);
        return;
      }
      case "move": {
        if (feature.bodyIds.length === 0) throw new Error("Select at least one body.");
        const t = feature.transform;
        let steps: ShapeTransform[];
        if (t.type === "translate") {
          const vector = {
            x: evaluateAs(t.x, "length", scope),
            y: evaluateAs(t.y, "length", scope),
            z: evaluateAs(t.z, "length", scope),
          };
          if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
            throw new Error("The distance is not a number.");
          }
          steps = [{ type: "translate", vector }];
        } else if (t.type === "rotate") {
          const axis = this.resolveAxis(t.axis, sketches, bodies, true);
          const angle = evaluateAs(t.angle, "angle", scope);
          if (!Number.isFinite(angle)) throw new Error("The angle is not a number.");
          steps = [{ type: "rotate", origin: axis.origin, axis: axis.direction, angle }];
        } else if (t.type === "free") {
          const length = (e: string): number => evaluateAs(e, "length", scope);
          const angle = (e: string): number => evaluateAs(e, "angle", scope);
          const translation = { x: length(t.x), y: length(t.y), z: length(t.z) };
          const angles = { x: angle(t.rx), y: angle(t.ry), z: angle(t.rz) };
          if (![translation.x, translation.y, translation.z].every(Number.isFinite)) {
            throw new Error("The distance is not a number.");
          }
          if (![angles.x, angles.y, angles.z].every(Number.isFinite)) {
            throw new Error("The angle is not a number.");
          }
          steps = freeMoveSteps(t.pivot, translation, angles);
        } else {
          const from = this.resolvePoint(t.from, sketches, bodies);
          const to = this.resolvePoint(t.to, sketches, bodies);
          steps = [{ type: "translate", vector: sub3(to, from) }];
        }
        for (const bodyId of feature.bodyIds) {
          const body = this.requireBody(bodies, bodyId);
          const id = feature.copy ? dynamicBodyId(feature.id, bodyId, 1) : bodyId;
          entry.outputs.set(id, this.moved(body, steps, hashString(entry.hash + id), entry));
        }
        return;
      }
      case "align": {
        const body = this.requireBody(bodies, feature.bodyId);
        const steps: ShapeTransform[] = [];
        if (feature.mode === "point-to-point") {
          const from = this.resolvePoint(feature.from, sketches, bodies);
          const to = this.resolvePoint(feature.to, sketches, bodies);
          steps.push({ type: "translate", vector: sub3(to, from) });
        } else {
          if (feature.to.bodyId === feature.bodyId) {
            throw new Error("Select a face of another body to align with.");
          }
          const from = this.planeOfFace(body, feature.from).plane;
          const to = this.planeOfFace(this.requireBody(bodies, feature.to.bodyId), feature.to.ref).plane;
          // Faces that touch look at each other: the normals are opposite.
          const target = feature.flip ? to.normal : scale3(to.normal, -1);
          const turn = cross3(from.normal, target);
          const sine = len3(turn);
          const cosine = dot3(from.normal, target);
          if (sine > 1e-9) {
            steps.push({
              type: "rotate",
              origin: from.origin,
              axis: norm3(turn),
              angle: (Math.atan2(sine, cosine) * 180) / Math.PI,
            });
          } else if (cosine < 0) {
            // Half a turn, about any line in the face.
            steps.push({ type: "rotate", origin: from.origin, axis: from.xDir, angle: 180 });
          }
          // The turn is about the centre of the face, which therefore stays where it is.
          steps.push({ type: "translate", vector: sub3(to.origin, from.origin) });
        }
        entry.outputs.set(feature.bodyId, this.moved(body, steps, entry.hash, entry));
        return;
      }
      case "split": {
        const body = this.requireBody(bodies, feature.bodyId);
        const plane = this.resolvePlane(feature.tool, bodies);
        const { positive, negative } = kernel.split(body.shape, plane);
        if (positive) entry.owned.push(positive);
        if (negative) entry.owned.push(negative);
        if (!positive || !negative) throw new Error("The plane does not cut the body.");
        const part = (shape: KernelShape, id: string): void => {
          entry.outputs.set(
            id,
            this.named(shape, hashString(entry.hash + id), (g) =>
              propagateNames([body], g, feature.id, () => ({ role: "split" })),
            ),
          );
        };
        part(feature.keep === "negative" ? negative : positive, feature.bodyId);
        if (feature.keep === "both") part(negative, dynamicBodyId(feature.id, feature.bodyId, 1));
        return;
      }
      case "sweep": {
        const { sketch, profiles } = this.resolveProfiles(
          sketches,
          feature.sketchId,
          feature.profiles,
        );
        const pathSketch = this.requireSketch(sketches, feature.path.sketchId);
        const plane = sketch.plane;
        const pathPlane = pathSketch.plane;
        // The sweep starts at the end of the path that lies at the profile.
        const inside = profiles[0] ? curveStart(profiles[0].outer.curves[0]!) : { x: 0, y: 0 };
        const reference = planeToWorld(plane, inside);
        const { curves, closed } = this.orderPath(pathSketch, feature.path.entityIds, (p) => {
          const world = planeToWorld(pathPlane, p);
          return Math.abs(distanceToPlane(plane, world)) * 1e3 + dist3(world, reference);
        });
        const tool = kernel.sweep(profiles, plane, this.pathInSpace(curves, pathPlane), {
          pathNormal: pathPlane.normal,
        });

        // The frame that carries the profile: the tangent of the path, the normal of the plane
        // the path lies in, and the direction perpendicular to both.
        const m = pathPlane.normal;
        const frame = (k: number, t: number): { origin: Vec3; tangent: Vec3; side: Vec3 } => {
          const c = curves[k]!;
          const d = curveTangentAt(c, t);
          const tangent = norm3(add3(scale3(pathPlane.xDir, d.x), scale3(pathPlane.yDir, d.y)));
          return { origin: planeToWorld(pathPlane, curvePointAt(c, t)), tangent, side: cross3(m, tangent) };
        };
        const start = frame(0, 0);
        const end = frame(curves.length - 1, 1);
        /** Where the point `p`, taken to lie in the section at (k, t), was in the profile. */
        const back = (p: Vec3, k: number, t: number): Vec3 => {
          const f = frame(k, t);
          const rel = sub3(p, f.origin);
          return add3(
            start.origin,
            add3(
              scale3(start.tangent, dot3(rel, f.tangent)),
              add3(scale3(start.side, dot3(rel, f.side)), scale3(m, dot3(rel, m))),
            ),
          );
        };
        const steps = 48;
        const toProfile = (p: Vec3): Vec3 => {
          // The section through p is the one that takes p back into the plane of the profile.
          let best: { k: number; t: number; miss: number; far: number } | null = null;
          for (let k = 0; k < curves.length; k++) {
            let before = distanceToPlane(plane, back(p, k, 0));
            for (let i = 0; i < steps; i++) {
              const t0 = i / steps;
              const t1 = (i + 1) / steps;
              const after = distanceToPlane(plane, back(p, k, t1));
              const candidates: { t: number; miss: number }[] = [
                { t: t0, miss: Math.abs(before) },
                { t: t1, miss: Math.abs(after) },
              ];
              if (before * after < 0) {
                let lo = t0;
                let hi = t1;
                let atLo = before;
                for (let n = 0; n < 40; n++) {
                  const mid = (lo + hi) / 2;
                  const v = distanceToPlane(plane, back(p, k, mid));
                  if (atLo * v <= 0) hi = mid;
                  else {
                    lo = mid;
                    atLo = v;
                  }
                }
                candidates.push({ t: (lo + hi) / 2, miss: 0 });
              }
              for (const c of candidates) {
                const far = dist3(p, frame(k, c.t).origin);
                if (
                  !best ||
                  c.miss < best.miss - 1e-6 ||
                  (Math.abs(c.miss - best.miss) <= 1e-6 && far < best.far)
                ) {
                  best = { k, t: c.t, miss: c.miss, far };
                }
              }
              before = after;
            }
          }
          return best ? back(p, best.k, best.t) : p;
        };
        // The end face is the plane of the profile, carried to the end of the path.
        const carried = (v: Vec3): Vec3 =>
          add3(
            scale3(end.tangent, dot3(v, start.tangent)),
            add3(scale3(end.side, dot3(v, start.side)), scale3(m, dot3(v, m))),
          );
        const endNormal = carried(plane.normal);
        const endOrigin = add3(end.origin, carried(sub3(plane.origin, start.origin)));
        const names = this.sweptNames(
          feature.id,
          sketch,
          feature.sketchId,
          (s, surface) => {
            if (closed || surface !== "plane") return null;
            if (
              Math.abs(distanceToPlane(plane, s.point)) < 1e-5 &&
              Math.abs(dot3(s.normal, plane.normal)) > 0.999
            ) {
              return "start";
            }
            return Math.abs(dot3(sub3(s.point, endOrigin), endNormal)) < 1e-4 &&
              Math.abs(dot3(s.normal, endNormal)) > 0.999
              ? "end"
              : null;
          },
          (p) => worldToPlane(plane, toProfile(p)),
        );
        this.applyOperation(feature, tool, names, bodies, entry);
        return;
      }
      case "loft": {
        if (feature.sections.length < 2) throw new Error("Select at least two sections.");
        const sections = feature.sections.map((section) => {
          if (section.type === "profile") {
            const { sketch, profiles } = this.resolveProfiles(sketches, section.sketchId, [
              section.profile,
            ]);
            const profile = profiles[0];
            if (!profile) throw new Error("A selected profile no longer exists in the sketch.");
            const input: LoftSectionInput = { type: "profile", profile, plane: sketch.plane };
            return { input, plane: sketch.plane, sketch, sketchId: section.sketchId, body: null };
          }
          const body = this.requireBody(bodies, section.bodyId);
          const { plane, index } = this.planeOfFace(body, section.ref);
          const input: LoftSectionInput = { type: "face", shape: body.shape, faceIndex: index };
          return { input, plane, sketch: null, sketchId: "", body };
        });
        const tool = kernel.loft(
          sections.map((s) => s.input),
          { ruled: feature.ruled ?? false },
        );
        const first = sections[0]!.plane;
        const last = sections[sections.length - 1]!.plane;
        const names = (g: BodyGeometry): BodyNames => {
          const adjacency = edgeFaces(g);
          const inPlane = (plane: Plane3, points: Vec3[]): boolean =>
            points.length > 0 && points.every((p) => Math.abs(distanceToPlane(plane, p)) < 1e-4);
          return nameSolid(g, feature.id, (faceIndex, samples) => {
            if (g.faces[faceIndex]!.surface === "plane" && samples.length > 0) {
              const points = samples.map((s) => s.point);
              const parallel = (plane: Plane3): boolean =>
                samples.every((s) => Math.abs(dot3(s.normal, plane.normal)) > 0.999);
              if (inPlane(first, points) && parallel(first)) return { role: "start" };
              if (inPlane(last, points) && parallel(last)) return { role: "end" };
            }
            // A side face is named after the curve of the first section it starts from.
            for (const section of sections) {
              for (let e = 0; e < g.edges.length; e++) {
                if (!adjacency[e]!.includes(faceIndex)) continue;
                const edge = g.edges[e]!;
                const points = edgePolyline(g, edge);
                if (!inPlane(section.plane, points)) continue;
                // Not a point of the polyline: a straight edge has only its two ends.
                const middle = edge.midpoint;
                if (section.sketch) {
                  const hit = hitTestSketch(
                    section.sketch.sketch,
                    worldToPlane(section.plane, middle),
                    0.2,
                    { points: false },
                  );
                  const entity = hit ? section.sketch.sketch.entities[hit.id] : undefined;
                  if (hit && entity && entity.type !== "point" && !entity.construction) {
                    return { role: "side", sketch: section.sketchId, entity: hit.id };
                  }
                } else if (section.body) {
                  const all = section.body.geometry.edges.map((_e, i) => i);
                  const of = nearestNamedEdge(section.body, all, [
                    { point: middle, normal: section.plane.normal },
                  ]);
                  if (of) return { role: "side", of: [of] };
                }
              }
            }
            return { role: "side" };
          });
        };
        this.applyOperation(feature, tool, names, bodies, entry);
        return;
      }
      case "import": {
        const shapes = await kernel.importSTEP(decodeBase64(feature.data));
        entry.owned.push(...shapes);
        const shape =
          shapes.length === 1 ? shapes[0]! : kernel.boolean("union", shapes[0]!, shapes.slice(1));
        if (shapes.length > 1) entry.owned.push(shape);
        // An imported body has no history: its faces are numbered as they come.
        entry.outputs.set(
          feature.bodyId,
          this.named(shape, entry.hash, (g) =>
            nameSolid(g, feature.id, (i) => ({ role: "import", entity: String(i) })),
          ),
        );
        return;
      }
    }
  }
}
