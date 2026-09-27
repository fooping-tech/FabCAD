/**
 * The ONLY module in FabCAD that imports Replicad / OpenCASCADE.
 */
import * as replicad from "replicad";
import {
  type Curve2,
  type Loop2,
  type Plane3,
  type Profile2,
  type SolidTopology,
  type Vec2,
  type Vec3,
  add3,
  curveEnd,
  curvePointAt,
  curveStart,
  dist2,
  dist3,
  scale3,
  subCurve,
} from "@fabcad/geometry";
import {
  type BodyGeometry,
  type BooleanOp,
  type GeometryKernel,
  type KernelShape,
  KernelError,
  type MeshEdgeGroup,
  type MeshFaceGroup,
  type PointRef,
  type SurfaceKind,
  type TessellationOptions,
} from "./kernel";
import { topologyFromGeometry } from "./topology";

type Shape3D = replicad.Shape3D;
type OpenCascadeInit = (options?: Record<string, unknown>) => Promise<unknown>;

export interface ReplicadKernelOptions {
  /** URL of the OpenCASCADE wasm file (browser) … */
  wasmUrl?: string;
  /** … or its bytes (Node, tests). */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

let ocReady: Promise<void> | null = null;

/** Load OpenCASCADE once and hand it to Replicad. */
export async function createReplicadKernel(
  options: ReplicadKernelOptions = {},
): Promise<GeometryKernel> {
  if (!ocReady) {
    ocReady = (async () => {
      const mod = (await import("replicad-opencascadejs")) as unknown as {
        default: OpenCascadeInit;
      };
      const init: Record<string, unknown> = {};
      if (options.wasmBinary) init.wasmBinary = options.wasmBinary;
      if (options.wasmUrl) {
        const url = options.wasmUrl;
        init.locateFile = () => url;
      }
      const oc = await mod.default(init);
      replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);
    })();
    ocReady.catch(() => {
      ocReady = null;
    });
  }
  await ocReady;
  return new ReplicadKernel();
}

const wrap = (shape: Shape3D): KernelShape => shape as unknown as KernelShape;
const unwrap = (shape: KernelShape): Shape3D => shape as unknown as Shape3D;
const tuple = (p: Vec2): [number, number] => [p.x, p.y];
const tuple3 = (p: Vec3): [number, number, number] => [p.x, p.y, p.z];

const SURFACES: Record<string, SurfaceKind> = {
  PLANE: "plane",
  CYLINDRE: "cylinder",
  CONE: "cone",
  SPHERE: "sphere",
  TORUS: "torus",
};

function guard<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof KernelError) throw err;
    // OpenCASCADE throws raw pointers (numbers) for C++ exceptions.
    const detail = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    throw new KernelError(detail ? `${what} failed: ${detail}` : `${what} failed.`);
  }
}

/** Break curves that Replicad's pen cannot draw in one stroke into drawable pieces. */
function drawableCurves(curve: Curve2): Curve2[] {
  if (curve.type === "arc") {
    const pieces = Math.abs(curve.sweep) > Math.PI * 1.5 ? 2 : 1;
    const out: Curve2[] = [];
    for (let i = 0; i < pieces; i++) out.push(subCurve(curve, i / pieces, (i + 1) / pieces));
    return out;
  }
  if (curve.type === "ellipseArc") {
    // Elliptical arcs are drawn as cubic Béziers, one per 45° of parameter.
    const pieces = Math.max(1, Math.ceil(Math.abs(curve.sweep) / (Math.PI / 4) - 1e-9));
    const out: Curve2[] = [];
    for (let i = 0; i < pieces; i++) {
      const u0 = curve.startParam + (curve.sweep * i) / pieces;
      const du = curve.sweep / pieces;
      const k = (4 / 3) * Math.tan(du / 4);
      const cr = Math.cos(curve.rotation);
      const sr = Math.sin(curve.rotation);
      const at = (u: number): Vec2 => {
        const lx = curve.rx * Math.cos(u);
        const ly = curve.ry * Math.sin(u);
        return { x: curve.center.x + lx * cr - ly * sr, y: curve.center.y + lx * sr + ly * cr };
      };
      const tangent = (u: number): Vec2 => {
        const lx = -curve.rx * Math.sin(u);
        const ly = curve.ry * Math.cos(u);
        return { x: lx * cr - ly * sr, y: lx * sr + ly * cr };
      };
      const p0 = at(u0);
      const p3 = at(u0 + du);
      const t0 = tangent(u0);
      const t1 = tangent(u0 + du);
      out.push({
        type: "bezier",
        p0,
        p1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
        p2: { x: p3.x - k * t1.x, y: p3.y - k * t1.y },
        p3,
      });
    }
    return out;
  }
  return [curve];
}

function loopToDrawing(loop: Loop2): replicad.Drawing {
  const curves = loop.curves.flatMap(drawableCurves).filter((c) => {
    return c.type !== "line" || dist2(c.a, c.b) > 1e-9;
  });
  if (curves.length === 0) throw new KernelError("Profile loop is empty.");
  const start = curveStart(curves[0]!);
  const pen = replicad.draw(tuple(start));
  curves.forEach((c, i) => {
    // Snap the final end point onto the start so that the loop closes exactly.
    const end = i === curves.length - 1 ? start : curveEnd(c);
    switch (c.type) {
      case "line":
        pen.lineTo(tuple(end));
        break;
      case "arc":
        pen.threePointsArcTo(tuple(end), tuple(curvePointAt(c, 0.5)));
        break;
      case "bezier":
        pen.cubicBezierCurveTo(tuple(end), tuple(c.p1), tuple(c.p2));
        break;
      case "ellipseArc":
        throw new KernelError("Unexpected elliptical arc.");
    }
  });
  return pen.close();
}

function profileToDrawing(profile: Profile2): replicad.Drawing {
  let drawing = loopToDrawing(profile.outer);
  for (const hole of profile.holes) drawing = drawing.cut(loopToDrawing(hole));
  return drawing;
}

function toReplicadPlane(plane: Plane3, offset = 0): replicad.Plane {
  const origin = add3(plane.origin, scale3(plane.normal, offset));
  return new replicad.Plane(tuple3(origin), tuple3(plane.xDir), tuple3(plane.normal));
}

function fuseAll(shapes: Shape3D[]): Shape3D {
  let result = shapes[0];
  if (!result) throw new KernelError("Nothing to build: no profile selected.");
  for (let i = 1; i < shapes.length; i++) result = result.fuse(shapes[i]!);
  return result;
}

const vec = (v: { x: number; y: number; z: number }): Vec3 => ({ x: v.x, y: v.y, z: v.z });

class ReplicadKernel implements GeometryKernel {
  readonly name = "replicad-opencascade";

  extrude(profiles: Profile2[], plane: Plane3, from: number, to: number): KernelShape {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo < 1e-9) throw new KernelError("Extrude distance must not be zero.");
    return guard("Extrude", () => {
      const solids = profiles.map((p) => {
        const sketch = profileToDrawing(p).sketchOnPlane(toReplicadPlane(plane, lo));
        return (sketch as replicad.Sketch).extrude(hi - lo) as Shape3D;
      });
      return wrap(fuseAll(solids));
    });
  }

  revolve(
    profiles: Profile2[],
    plane: Plane3,
    axisOrigin: Vec3,
    axisDirection: Vec3,
    angle: number,
  ): KernelShape {
    if (Math.abs(angle) < 1e-9) throw new KernelError("Revolve angle must not be zero.");
    return guard("Revolve", () => {
      const solids = profiles.map((p) => {
        const sketch = profileToDrawing(p).sketchOnPlane(toReplicadPlane(plane));
        return (sketch as replicad.Sketch).revolve(tuple3(axisDirection), {
          origin: tuple3(axisOrigin),
          angle: Math.max(-360, Math.min(360, angle)),
        }) as Shape3D;
      });
      return wrap(fuseAll(solids));
    });
  }

  boolean(op: BooleanOp, target: KernelShape, tools: KernelShape[]): KernelShape {
    return guard("Boolean", () => {
      let result = unwrap(target);
      for (const tool of tools) {
        const t = unwrap(tool);
        if (op === "union") result = result.fuse(t);
        else if (op === "cut") result = result.cut(t);
        else result = result.intersect(t);
      }
      return wrap(result);
    });
  }

  private findEdges(shape: Shape3D, refs: PointRef[]): replicad.Edge[] {
    const edges = shape.edges;
    const samples = edges.map((e) => {
      const pts: Vec3[] = [];
      for (let i = 0; i <= 8; i++) pts.push(vec(e.pointAt(i / 8)));
      return pts;
    });
    const picked = new Set<number>();
    for (const ref of refs) {
      let best = -1;
      let bestD = Infinity;
      samples.forEach((pts, i) => {
        for (const p of pts) {
          const d = dist3(p, ref.point);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      });
      if (best >= 0) picked.add(best);
    }
    return [...picked].map((i) => edges[i]!);
  }

  private findFaces(shape: Shape3D, refs: PointRef[]): replicad.Face[] {
    const faces = shape.faces;
    const info = faces.map((f) => ({ center: vec(f.center), normal: vec(f.normalAt()) }));
    const picked = new Set<number>();
    for (const ref of refs) {
      let best = -1;
      let bestScore = Infinity;
      info.forEach((f, i) => {
        let score = dist3(f.center, ref.point);
        if (ref.normal) {
          const dot =
            f.normal.x * ref.normal.x + f.normal.y * ref.normal.y + f.normal.z * ref.normal.z;
          // Faces pointing the wrong way are heavily penalised.
          score += (1 - dot) * 1000;
        }
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best >= 0) picked.add(best);
    }
    return [...picked].map((i) => faces[i]!);
  }

  fillet(shape: KernelShape, edges: PointRef[], radius: number): KernelShape {
    if (radius <= 0) throw new KernelError("Fillet radius must be positive.");
    return guard("Fillet", () => {
      const s = unwrap(shape);
      const list = this.findEdges(s, edges);
      if (list.length === 0) throw new KernelError("Fillet: no edge selected.");
      return wrap(s.fillet(radius, (e) => e.inList(list)));
    });
  }

  chamfer(shape: KernelShape, edges: PointRef[], distance: number): KernelShape {
    if (distance <= 0) throw new KernelError("Chamfer distance must be positive.");
    return guard("Chamfer", () => {
      const s = unwrap(shape);
      const list = this.findEdges(s, edges);
      if (list.length === 0) throw new KernelError("Chamfer: no edge selected.");
      return wrap(s.chamfer(distance, (e) => e.inList(list)));
    });
  }

  shell(shape: KernelShape, openFaces: PointRef[], thickness: number): KernelShape {
    if (thickness <= 0) throw new KernelError("Shell thickness must be positive.");
    return guard("Shell", () => {
      const s = unwrap(shape);
      const list = this.findFaces(s, openFaces);
      if (list.length === 0) throw new KernelError("Shell: select at least one face to remove.");
      const result = s.shell(thickness, (f) => f.inList(list));
      // OpenCASCADE can give the input back unchanged when the offset fails.
      const before = replicad.measureVolume(s);
      const after = replicad.measureVolume(result);
      if (!(after > 1e-9) || after >= before - 1e-9) {
        throw new KernelError(
          "Shell failed: the thickness does not fit this shape. Try a smaller value.",
        );
      }
      return wrap(result);
    });
  }

  tessellate(shape: KernelShape, options: TessellationOptions = {}): BodyGeometry {
    return guard("Tessellation", () => {
      const s = unwrap(shape);
      const tolerance = options.tolerance ?? 0.05;
      const angularTolerance = options.angularTolerance ?? 0.3;
      const mesh = s.mesh({ tolerance, angularTolerance });
      const brepFaces = s.faces;
      const faces: MeshFaceGroup[] = mesh.faceGroups.map((g, i) => {
        const face = brepFaces[i];
        let center: Vec3 = { x: 0, y: 0, z: 0 };
        let normal: Vec3 = { x: 0, y: 0, z: 1 };
        let surface: SurfaceKind = "other";
        if (face) {
          surface = SURFACES[face.geomType] ?? "other";
          center = vec(face.center);
          normal = vec(face.normalAt());
        }
        return { faceIndex: i, start: g.start, count: g.count, surface, center, normal };
      });

      const edgeMesh = s.meshEdges({ tolerance, angularTolerance });
      const brepEdges = s.edges;
      const edgeGroups: MeshEdgeGroup[] = edgeMesh.edgeGroups.map((g, i) => {
        const edge = brepEdges[i];
        const type = edge?.geomType;
        return {
          edgeIndex: i,
          start: g.start,
          count: g.count,
          midpoint: edge ? vec(edge.pointAt(0.5)) : { x: 0, y: 0, z: 0 },
          curve: type === "LINE" ? "line" : type === "CIRCLE" ? "circle" : "other",
          length: edge ? edge.length : 0,
        };
      });

      const seen = new Set<string>();
      const vertices: number[] = [];
      for (const e of brepEdges) {
        for (const p of [e.startPoint, e.endPoint]) {
          const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          vertices.push(p.x, p.y, p.z);
        }
      }

      const box = s.boundingBox.bounds;
      return {
        positions: Float32Array.from(mesh.vertices),
        normals: Float32Array.from(mesh.normals),
        indices: Uint32Array.from(mesh.triangles),
        faces,
        edgePositions: Float32Array.from(edgeMesh.lines),
        edges: edgeGroups,
        vertices: Float32Array.from(vertices),
        bounds: {
          min: { x: box[0][0], y: box[0][1], z: box[0][2] },
          max: { x: box[1][0], y: box[1][1], z: box[1][2] },
        },
        volume: replicad.measureVolume(s),
        area: replicad.measureArea(s),
      };
    });
  }

  topology(shape: KernelShape, options: TessellationOptions = {}): SolidTopology {
    // Curved faces become facets: a coarser angular tolerance keeps their number practical.
    const geometry = this.tessellate(shape, {
      tolerance: options.tolerance ?? 0.1,
      angularTolerance: options.angularTolerance ?? Math.PI / 12,
    });
    return topologyFromGeometry(geometry);
  }

  async importSTEP(data: Uint8Array): Promise<KernelShape[]> {
    try {
      const blob = new Blob([data as unknown as BlobPart]);
      const shape = await replicad.importSTEP(blob);
      const solids = (shape as unknown as { solids?: Shape3D[] }).solids;
      if (solids && solids.length > 0) return solids.map(wrap);
      return [wrap(shape as Shape3D)];
    } catch (err) {
      throw new KernelError(
        `STEP import failed${err instanceof Error && err.message ? `: ${err.message}` : "."}`,
      );
    }
  }

  async exportSTEP(shapes: { shape: KernelShape; name: string }[]): Promise<Uint8Array> {
    const blob = guard("STEP export", () =>
      replicad.exportSTEP(
        shapes.map((s) => ({ shape: unwrap(s.shape), name: s.name })),
        { unit: "MM", modelUnit: "MM" },
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  }

  async exportSTL(
    shapes: KernelShape[],
    options: TessellationOptions & { binary?: boolean } = {},
  ): Promise<Uint8Array> {
    const blob = guard("STL export", () => {
      const list = shapes.map(unwrap);
      const shape = list.length === 1 ? list[0]! : replicad.makeCompound(list);
      return shape.blobSTL({
        tolerance: options.tolerance ?? 0.02,
        angularTolerance: options.angularTolerance ?? 0.2,
        binary: options.binary ?? true,
      });
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  isValidSolid(shape: KernelShape): boolean {
    try {
      const s = unwrap(shape);
      return !s.isNull && s.faces.length > 0 && replicad.measureVolume(s) > 1e-9;
    } catch {
      return false;
    }
  }

  dispose(shape: KernelShape): void {
    try {
      unwrap(shape).delete();
    } catch {
      // Already released.
    }
  }
}
