import {
  type BodyGeometry,
  type GeometryKernel,
  type KernelShape,
  edgePolyline,
  nearestEdge,
  nearestVertex,
} from "@fabcad/brep";
import {
  type BodyNames,
  type FaceSample,
  type NamedBody,
  distanceToFace,
  nameSolid,
  nearestNamedEdge,
  propagateNames,
  resolveEdgeRef,
  resolveFaceRef,
} from "./naming";
import {
  type CadDocument,
  type Feature,
  type ParameterEvaluation,
  type Scope,
  evaluateAs,
  evaluateParameters,
  featureConsumedBodies,
  featureInputBodies,
  parameterScope,
} from "@fabcad/cad-document";
import {
  type Plane3,
  type Profile2,
  type SolidTopology,
  type TopologyRef,
  type Vec3,
  add3,
  curveStart,
  distanceToPlane,
  dot3,
  len3,
  makePlane,
  norm3,
  planeToWorld,
  scale3,
  sub3,
  worldToPlane,
} from "@fabcad/geometry";
import {
  type ProfileRef,
  type Sketch,
  type SketchRegion,
  type SolveStatus,
  detectProfiles,
  getPoint,
  hitTestSketch,
  projectPolyline,
  resolveProfileRef,
  updateProjection,
} from "@fabcad/sketch";
import type { SketchSolver } from "@fabcad/sketch-solver";
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
}

export interface RecomputeResult {
  bodies: BodyResult[];
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

interface CacheEntry {
  hash: string;
  /** Bodies written by the feature. */
  outputs: Map<string, BodyState>;
  /** Shapes created by the feature; released when the entry is replaced. */
  owned: KernelShape[];
  status: FeatureStatus;
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

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class FeatureEngine {
  private cache = new Map<string, CacheEntry>();
  private bodies = new Map<string, BodyState>();
  private topologyCache = new Map<string, { hash: string; topology: SolidTopology }>();
  private sketches = new Map<string, SketchEval>();
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
        this.applyOutputs(feature, cached.outputs, bodies);
        statuses[id] = { ...cached.status, cached: true };
        continue;
      }

      this.lastEvaluated.push(id);
      const entry: CacheEntry = {
        hash,
        outputs: new Map(),
        owned: [],
        status: { id, state: "ok", cached: false },
      };
      try {
        await this.evaluate(feature, scope, sketches, bodies, entry);
      } catch (err) {
        entry.outputs.clear();
        entry.status = {
          id,
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          cached: false,
        };
      }
      if (cached) this.release(cached, entry);
      this.cache.set(id, entry);
      if (entry.status.state === "ok") this.applyOutputs(feature, entry.outputs, bodies);
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
      if (!doc.bodies[id]) continue;
      const known = options.known?.[id] === state.hash;
      results.push({
        id,
        hash: state.hash,
        geometry: known ? null : state.geometry,
        names: known ? null : state.names,
      });
    }
    for (const id of [...this.topologyCache.keys()]) {
      if (!bodies.has(id)) this.topologyCache.delete(id);
    }

    return {
      bodies: results,
      features: statuses,
      sketches: sketchStatuses,
      sketchUpdates,
      parameters,
      durationMs: Date.now() - started,
    };
  }

  /** Polyhedral topology of a body, as handed to manufacturing workspaces. */
  bodyTopology(bodyId: string): SolidTopology | null {
    const state = this.bodies.get(bodyId);
    if (!state) return null;
    const cached = this.topologyCache.get(bodyId);
    if (cached && cached.hash === state.hash) return cached.topology;
    const topology = this.kernel.topology(state.shape);
    this.topologyCache.set(bodyId, { hash: state.hash, topology });
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

  async exportSTEP(bodies: { id: string; name: string }[]): Promise<Uint8Array> {
    const shapes = bodies.flatMap((b) => {
      const s = this.bodies.get(b.id);
      return s ? [{ shape: s.shape, name: b.name }] : [];
    });
    if (shapes.length === 0) throw new Error("There is no body to export.");
    return this.kernel.exportSTEP(shapes);
  }

  async exportSTL(bodyIds: string[], binary = true): Promise<Uint8Array> {
    const shapes = bodyIds.flatMap((id) => {
      const s = this.bodies.get(id);
      return s ? [s.shape] : [];
    });
    if (shapes.length === 0) throw new Error("There is no body to export.");
    return this.kernel.exportSTL(shapes, { binary });
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
    let current = this.followFace(sketch, bodies);
    if (sketch.projections.length === 0) return current;
    const plane = resolveSketchPlane(current.plane);
    for (const ref of sketch.projections) {
      const body = bodies.get(ref.bodyId);
      if (!body) continue;
      const geometry = body.geometry;
      let points: Vec3[];
      let hint: Vec3;
      if ((ref.source ?? "edge") === "vertex") {
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
      }
      const shape = projectPolyline(plane, points);
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

  private evaluateSketch(feature: Extract<Feature, { type: "sketch" }>, scope: Scope): SketchEval {
    const info = solveSketchWithParameters(feature.sketch, this.solver, scope);
    const sketch = info.converged ? info.sketch : feature.sketch;
    const plane = resolveSketchPlane(sketch.plane);
    const regions = detectProfiles(sketch);
    const geometryKey = JSON.stringify([sketch.entities, plane]);
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
    const value = (expression: string, kind: "length" | "angle"): number =>
      evaluateAs(expression, kind, scope);
    switch (feature.type) {
      case "extrude":
        parts.push(value(feature.distance, "length"), sketches.get(feature.sketchId)?.hash ?? "");
        break;
      case "revolve":
        parts.push(value(feature.angle, "angle"), sketches.get(feature.sketchId)?.hash ?? "");
        break;
      case "fillet":
        parts.push(value(feature.radius, "length"));
        break;
      case "chamfer":
        parts.push(value(feature.distance, "length"));
        break;
      case "shell":
        parts.push(value(feature.thickness, "length"));
        break;
      default:
        break;
    }
    for (const b of featureInputBodies(feature)) parts.push([b, bodies.get(b)?.hash ?? "missing"]);
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
      const region = resolveProfileRef(sketch.regions, ref);
      if (!region) throw new Error("A selected profile no longer exists in the sketch.");
      picked.set(region.id, region);
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
          }
        }
        const entity = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return entity ? { role: "side", sketch: sketchId, entity } : { role: "side" };
      });
  }

  private applyOperation(
    feature: Extract<Feature, { type: "extrude" | "revolve" | "sweep" | "loft" }>,
    tool: KernelShape,
    toolNames: (g: BodyGeometry) => BodyNames,
    bodies: Map<string, BodyState>,
    entry: CacheEntry,
  ): void {
    entry.owned.push(tool);
    const made = this.named(tool, entry.hash, toolNames);
    if (feature.operation === "new") {
      if (!this.kernel.isValidSolid(tool)) throw new Error("The result is not a valid solid.");
      entry.outputs.set(feature.bodyId, made);
      return;
    }
    if (feature.targetBodyIds.length === 0) throw new Error("No target body selected.");
    const op =
      feature.operation === "join" ? "union" : feature.operation === "cut" ? "cut" : "intersect";
    for (const targetId of feature.targetBodyIds) {
      const target = this.requireBody(bodies, targetId);
      const result = this.kernel.boolean(op, target.shape, [tool]);
      entry.owned.push(result);
      if (!this.kernel.isValidSolid(result)) {
        throw new Error("The operation removes the whole body.");
      }
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
        const d = evaluateAs(feature.distance, "length", scope);
        if (Math.abs(d) < 1e-9) throw new Error("Distance must not be zero.");
        const [from, to] =
          feature.direction === "symmetric"
            ? [-d / 2, d / 2]
            : feature.direction === "negative"
              ? [-d, 0]
              : [0, d];
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
        if (!kernel.isValidSolid(result)) throw new Error("The result is empty.");
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
