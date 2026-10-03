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
  cross3,
  curveEnd,
  curvePointAt,
  curveStart,
  dist2,
  dist3,
  dot3,
  len3,
  makePlane,
  norm3,
  scale3,
  sub3,
  subCurve,
} from "@fabcad/geometry";
import {
  type BodyGeometry,
  type BooleanOp,
  type GeometryKernel,
  type HoleSpec,
  type KernelShape,
  KernelError,
  type LoftOptions,
  type LoftSectionInput,
  type MeshEdgeGroup,
  type MeshFaceGroup,
  type PathCurve3,
  type PointRef,
  type ShapeTransform,
  type SolidProblem,
  type SweepOptions,
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
  EXTRUSION_SURFACE: "extrusion",
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

interface BezierLike {
  IsRational(): boolean;
  NbPoles(): number;
  Pole(i: number): { X(): number; Y(): number; Z(): number };
}
interface CurveAdaptorLike {
  Bezier(): BezierLike;
  FirstParameter(): number;
  LastParameter(): number;
}

/** Control points of a polynomial Bézier edge, cut down to the part the edge uses. */
function bezierPoles(edge: replicad.Edge): Vec3[] | null {
  let curve: replicad.Curve | null = null;
  try {
    curve = edge.curve;
    const adaptor = curve.wrapped as unknown as CurveAdaptorLike;
    const bezier = adaptor.Bezier();
    if (bezier.IsRational()) return null;
    const poles: Vec3[] = [];
    for (let i = 1; i <= bezier.NbPoles(); i++) {
      const p = bezier.Pole(i);
      poles.push({ x: p.X(), y: p.Y(), z: p.Z() });
    }
    return trimBezier(poles, adaptor.FirstParameter(), adaptor.LastParameter());
  } catch {
    return null;
  } finally {
    curve?.delete();
  }
}

/** The control points of the part [u0, u1] of a Bézier curve (de Casteljau, twice). */
export function trimBezier(poles: Vec3[], u0: number, u1: number): Vec3[] {
  const split = (pts: Vec3[], t: number): [Vec3[], Vec3[]] => {
    const left: Vec3[] = [];
    const right: Vec3[] = [];
    let row = pts;
    while (row.length > 0) {
      left.push(row[0]!);
      right.unshift(row[row.length - 1]!);
      const next: Vec3[] = [];
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i]!;
        const b = row[i + 1]!;
        next.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      }
      row = next;
    }
    return [left, right];
  };
  if (Math.abs(u0) < 1e-12 && Math.abs(u1 - 1) < 1e-12) return poles;
  const [, after] = split(poles, u0);
  if (u1 >= 1 - 1e-12) return after;
  const [middle] = split(after, (u1 - u0) / (1 - u0));
  return middle;
}

/** Circle through three points in space. */
function circleThrough(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number } | null {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const n2 = n.x * n.x + n.y * n.y + n.z * n.z;
  if (n2 < 1e-18) return null;
  const ab2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const ac2 = ac.x * ac.x + ac.y * ac.y + ac.z * ac.z;
  // (|ab|² · (ac × n) − |ac|² · (ab × n)) / (2 |n|²), measured from a … with the usual signs.
  const acn = { x: ac.y * n.z - ac.z * n.y, y: ac.z * n.x - ac.x * n.z, z: ac.x * n.y - ac.y * n.x };
  const abn = { x: ab.y * n.z - ab.z * n.y, y: ab.z * n.x - ab.x * n.z, z: ab.x * n.y - ab.y * n.x };
  const k = 1 / (2 * n2);
  const o = {
    x: (ac2 * abn.x - ab2 * acn.x) * -k,
    y: (ac2 * abn.y - ab2 * acn.y) * -k,
    z: (ac2 * abn.z - ab2 * acn.z) * -k,
  };
  return {
    center: { x: a.x + o.x, y: a.y + o.y, z: a.z + o.z },
    radius: Math.hypot(o.x, o.y, o.z),
  };
}

/**
 * The parts of OpenCASCADE used directly, where Replicad has no function for the job. Replicad
 * hands out the instance untyped enough that spelling out these few members is the safer way.
 */
interface OcDeletable {
  delete(): void;
}
interface OcPipeShell extends OcDeletable {
  SetTransitionMode(mode: unknown): void;
  SetMode(binormal: unknown): void;
  Add(profile: unknown, withContact: boolean, withCorrection: boolean): void;
  Build(): void;
  IsDone(): boolean;
  MakeSolid(): boolean;
  Shape(): unknown;
}
interface OcAnalyzer extends OcDeletable {
  IsValid(): boolean;
}
interface OcShapeList extends OcDeletable {
  Append(shape: unknown): void;
}
interface OcThickSolid extends OcDeletable {
  MakeThickSolidByJoin(
    shape: unknown,
    closingFaces: OcShapeList,
    offset: number,
    tolerance: number,
    mode: unknown,
    intersection: boolean,
    selfInter: boolean,
    join: unknown,
    removeIntEdges: boolean,
  ): void;
  Shape(): unknown;
}
interface OcSubset {
  BRepCheck_Analyzer: new (
    shape: unknown,
    geomControls: boolean,
    parallel: boolean,
    exact: boolean,
  ) => OcAnalyzer;
  BRep_Tool: { IsClosed(shape: unknown): boolean };
  BRepOffsetAPI_MakeThickSolid: new () => OcThickSolid;
  NCollection_List_TopoDS_Shape: new () => OcShapeList;
  BRepOffset_Mode: { BRepOffset_Skin: unknown };
  GeomAbs_JoinType: { GeomAbs_Arc: unknown };
  BRepPrimAPI_MakePrism: new (shape: unknown, v: OcDeletable, copy: boolean, canonize: boolean) => OcDeletable & {
    Shape(): unknown;
  };
  gp_Vec: new (x: number, y: number, z: number) => OcDeletable;
  BRepOffsetAPI_MakePipeShell: new (spine: unknown) => OcPipeShell;
  BRepBuilderAPI_TransitionMode: { BRepBuilderAPI_RightCorner: unknown };
  gp_Dir: new (x: number, y: number, z: number) => OcDeletable;
}
const openCascade = (): OcSubset => replicad.getOC() as unknown as OcSubset;

type RawShape = Parameters<typeof replicad.cast>[0];

function asShape3D(shape: replicad.AnyShape, what: string): Shape3D {
  if (shape.isNull || !("solids" in shape || "faces" in shape)) {
    throw new KernelError(`${what} did not produce a solid.`);
  }
  return shape as Shape3D;
}

/** Throw unless the shape is a solid with volume; `advice` tells the user what to try. */
function requireSolid(shape: Shape3D, what: string, advice: string): Shape3D {
  let volume = 0;
  try {
    volume = shape.isNull ? 0 : replicad.measureVolume(shape);
  } catch {
    volume = 0;
  }
  if (!(Math.abs(volume) > 1e-9)) throw new KernelError(`${what} failed: ${advice}`);
  return shape;
}

/** Wire of the outer boundary of a profile, placed on its plane. */
function outerWire(profile: Profile2, plane: Plane3): replicad.Wire {
  const sketch = loopToDrawing(profile.outer).sketchOnPlane(toReplicadPlane(plane));
  return (sketch as replicad.Sketch).wire;
}

function pathToWire(path: PathCurve3[]): replicad.Wire {
  const edges = path.map((c) => {
    switch (c.type) {
      case "line":
        return replicad.makeLine(tuple3(c.from), tuple3(c.to));
      case "arc":
        return replicad.makeThreePointArc(tuple3(c.from), tuple3(c.via), tuple3(c.to));
      case "bezier":
        return replicad.makeBezierCurve(c.points.map(tuple3));
    }
  });
  return replicad.assembleWire(edges);
}

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
      this.checkBoolean(op, target, tools, wrap(result));
      return wrap(result);
    });
  }

  /**
   * OpenCASCADE can return a broken shape from a Boolean of valid solids without reporting an
   * error. Refuse it rather than pass it on: an open shell, a B-Rep that fails the checker, or a
   * volume that the operation cannot produce (a union smaller than one of its inputs).
   */
  private checkBoolean(
    op: BooleanOp,
    target: KernelShape,
    tools: KernelShape[],
    result: KernelShape,
  ): void {
    const inputs = [target, ...tools];
    if (inputs.some((s) => this.solidProblem(s) !== null)) return;
    const problem = this.solidProblem(result);
    if (problem === "open" || problem === "invalid") {
      throw new KernelError(
        `Boolean failed: the result is not a closed solid (${problem === "open" ? "some edges do not join two faces" : "the B-Rep is invalid"}).`,
      );
    }
    if (problem === "empty") return;
    const volumes = inputs.map((s) => replicad.measureVolume(unwrap(s)));
    const volume = replicad.measureVolume(unwrap(result));
    const tolerance = 1e-6 * Math.max(...volumes) + 1e-6;
    const wrong =
      op === "union"
        ? volume < Math.max(...volumes) - tolerance
        : op === "cut"
          ? volume > volumes[0]! + tolerance
          : volume > Math.min(...volumes) + tolerance;
    if (wrong) {
      throw new KernelError(
        `Boolean failed: the result has a volume that a ${op} of these bodies cannot have.`,
      );
    }
  }

  private findEdges(shape: Shape3D, refs: PointRef[]): replicad.Edge[] {
    const edges = shape.edges;
    if (refs.length > 0 && refs.every((r) => r.index !== undefined && edges[r.index])) {
      return [...new Set(refs.map((r) => r.index!))].map((i) => edges[i]!);
    }
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
    if (refs.length > 0 && refs.every((r) => r.index !== undefined && faces[r.index])) {
      return [...new Set(refs.map((r) => r.index!))].map((i) => faces[i]!);
    }
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
      const before = replicad.measureVolume(s);
      // OpenCASCADE can give the input back unchanged when the offset fails.
      const shrunk = (r: Shape3D | null): r is Shape3D => {
        if (!r) return false;
        const after = replicad.measureVolume(r);
        return after > 1e-9 && after < before - 1e-9;
      };
      let result: Shape3D | null = null;
      try {
        result = s.shell(thickness, (f) => f.inList(list));
      } catch {
        result = null;
      }
      if (shrunk(result)) return wrap(result);
      // The offset fails, among others, where an opened face has a pocket in it. Hollow the
      // body without openings and cut the openings out instead.
      const opened = this.shellByCutting(s, list, thickness);
      if (shrunk(opened) && this.solidProblem(wrap(opened)) === null) return wrap(opened);
      throw new KernelError(
        "Shell failed: OpenCASCADE cannot offset the faces of this body. Try a smaller thickness, " +
          "Shell before Fillet, or open a flat face.",
      );
    });
  }

  /**
   * A shell made in two steps: the body hollowed with no opening (the body minus its inward
   * offset), then the lid over the inside cut away under each opened face.
   * Gives the same body as the offset with openings, which OpenCASCADE does not always manage.
   * Flat opened faces only: the lid of a curved face is not a straight prism. Null on failure.
   */
  private shellByCutting(s: Shape3D, faces: replicad.Face[], thickness: number): Shape3D | null {
    if (faces.some((f) => f.geomType !== "PLANE")) return null;
    const oc = openCascade();
    const owned: OcDeletable[] = [];
    try {
      const none = new oc.NCollection_List_TopoDS_Shape();
      const builder = new oc.BRepOffsetAPI_MakeThickSolid();
      owned.push(none, builder);
      builder.MakeThickSolidByJoin(
        s.wrapped,
        none,
        -thickness,
        1e-3,
        oc.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        oc.GeomAbs_JoinType.GeomAbs_Arc,
        false,
      );
      // Without openings the result is the offset surface: a closed shell around the inside.
      const offset = replicad.cast(builder.Shape() as RawShape);
      const inside =
        offset instanceof replicad.Shell ? replicad.makeSolid([offset]) : (offset as Shape3D);
      let result = s.cut(inside);
      // The opening is the lid over the inside: the faces of the inside that lie under an
      // opened face, pushed out through it. The walls around it stay whole.
      const lids: replicad.Face[] = [];
      for (const face of faces) {
        const n = vec(face.normalAt());
        const c = vec(face.center);
        for (const g of inside.faces) {
          if (g.geomType !== "PLANE" || lids.includes(g)) continue;
          const m = vec(g.normalAt());
          const below = dot3(sub3(vec(g.center), c), n);
          if (dot3(m, n) > 1 - 1e-6 && Math.abs(below + thickness) < 1e-4) lids.push(g);
        }
      }
      if (lids.length === 0) return null;
      const depth = thickness * (1 + 1e-3);
      for (const lid of lids) {
        const n = vec(lid.normalAt());
        const v = new oc.gp_Vec(n.x * depth, n.y * depth, n.z * depth);
        const prism = new oc.BRepPrimAPI_MakePrism(lid.wrapped, v, false, true);
        owned.push(v, prism);
        result = result.cut(replicad.cast(prism.Shape() as RawShape) as Shape3D);
      }
      return result;
    } catch {
      return null;
    } finally {
      for (const o of owned) o.delete();
    }
  }

  hole(holes: HoleSpec[]): KernelShape {
    if (holes.length === 0) throw new KernelError("Hole: select at least one point.");
    const solids = holes.map((h) => {
      const r = h.diameter / 2;
      if (!(r > 0)) throw new KernelError("The hole diameter must be positive.");
      if (!(h.depth > 0)) throw new KernelError("The hole depth must be positive.");
      // Half of the cross-section, x = distance from the axis, y = depth: turned about the
      // axis it gives the cylinder, the counterbore and the countersink in one solid.
      const outline: Vec2[] = [{ x: 0, y: 0 }];
      if (h.counterbore) {
        const R = h.counterbore.diameter / 2;
        if (!(R > r)) {
          throw new KernelError("The counterbore diameter must be larger than the hole diameter.");
        }
        if (!(h.counterbore.depth > 0)) {
          throw new KernelError("The counterbore depth must be positive.");
        }
        if (!(h.counterbore.depth < h.depth)) {
          throw new KernelError("The counterbore must be less deep than the hole.");
        }
        outline.push({ x: R, y: 0 }, { x: R, y: h.counterbore.depth }, { x: r, y: h.counterbore.depth });
      } else if (h.countersink) {
        const R = h.countersink.diameter / 2;
        if (!(R > r)) {
          throw new KernelError("The countersink diameter must be larger than the hole diameter.");
        }
        if (!(h.countersink.angle > 0 && h.countersink.angle < 180)) {
          throw new KernelError("The countersink angle must be between 0° and 180°.");
        }
        const height = (R - r) / Math.tan((h.countersink.angle * Math.PI) / 360);
        if (!(height < h.depth)) {
          throw new KernelError(
            "The countersink is deeper than the hole. Use a larger angle, a smaller countersink diameter or a deeper hole.",
          );
        }
        outline.push({ x: R, y: 0 }, { x: r, y: height });
      } else {
        outline.push({ x: r, y: 0 });
      }
      outline.push({ x: r, y: h.depth }, { x: 0, y: h.depth });
      const curves: Curve2[] = outline.map((a, i) => ({
        type: "line",
        a,
        b: outline[(i + 1) % outline.length]!,
      }));
      const axis = norm3(h.direction);
      if (len3(axis) < 0.5) throw new KernelError("The hole has no direction.");
      const side = makePlane(h.position, axis).xDir;
      // A plane through the axis: x runs away from the axis, y along it.
      const plane = makePlane(h.position, cross3(side, axis), side);
      return unwrap(this.revolve([{ outer: { curves }, holes: [] }], plane, h.position, axis, 360));
    });
    return guard("Hole", () =>
      wrap(requireSolid(fuseAll(solids), "Hole", "the hole has no volume. Check its sizes.")),
    );
  }

  transform(shape: KernelShape, steps: ShapeTransform[]): KernelShape {
    return guard("Move", () => {
      const source = unwrap(shape);
      let current: RawShape = source.wrapped;
      const release = (): void => {
        if (current !== source.wrapped) (current as unknown as OcDeletable).delete();
      };
      for (const step of steps) {
        let next: RawShape;
        if (step.type === "translate") {
          next = replicad.translate(current, tuple3(step.vector));
        } else if (step.type === "rotate") {
          if (len3(step.axis) < 1e-9) throw new KernelError("The rotation axis has no direction.");
          next = replicad.rotate(current, step.angle, tuple3(step.origin), tuple3(norm3(step.axis)));
        } else {
          if (len3(step.normal) < 1e-9) throw new KernelError("The mirror plane has no normal.");
          next = replicad.mirror(current, tuple3(norm3(step.normal)), tuple3(step.origin));
        }
        release();
        current = next;
      }
      // Without steps the result is still a shape of its own: the caller owns what it gets.
      if (current === source.wrapped) current = replicad.translate(current, [0, 0, 0]);
      return wrap(asShape3D(replicad.cast(current), "Move"));
    });
  }

  split(
    shape: KernelShape,
    plane: Plane3,
  ): { positive: KernelShape | null; negative: KernelShape | null } {
    return guard("Split", () => {
      const s = unwrap(shape);
      const half = (keep: "positive" | "negative"): KernelShape | null => {
        const part = s.cutPlane(toReplicadPlane(plane), 0, keep);
        if (!part) return null;
        if (part.isNull || !(replicad.measureVolume(part) > 1e-9)) {
          part.delete();
          return null;
        }
        return wrap(part as Shape3D);
      };
      return { positive: half("positive"), negative: half("negative") };
    });
  }

  sweep(
    profiles: Profile2[],
    plane: Plane3,
    path: PathCurve3[],
    options: SweepOptions = {},
  ): KernelShape {
    if (path.length === 0) throw new KernelError("Sweep: select a path.");
    return guard("Sweep", () => {
      const oc = openCascade();
      const advice =
        "the profile cannot follow this path. Check that the path does not bend more tightly than the profile is wide.";
      const along = (wire: replicad.Wire): Shape3D => {
        const spine = pathToWire(path);
        const builder = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
        try {
          builder.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
          if (options.pathNormal && len3(options.pathNormal) > 1e-9) {
            const n = norm3(options.pathNormal);
            const direction = new oc.gp_Dir(n.x, n.y, n.z);
            builder.SetMode(direction);
            direction.delete();
          }
          builder.Add(wire.wrapped, false, false);
          builder.Build();
          if (!builder.IsDone()) throw new KernelError(`Sweep failed: ${advice}`);
          builder.MakeSolid();
          const solid = asShape3D(replicad.cast(builder.Shape() as RawShape), "Sweep");
          return requireSolid(solid, "Sweep", advice);
        } finally {
          builder.delete();
          spine.delete();
          wire.delete();
        }
      };
      const solids = profiles.map((p) => {
        let solid = along(outerWire(p, plane));
        for (const hole of p.holes) {
          solid = solid.cut(along(outerWire({ outer: hole, holes: [] }, plane)));
        }
        return solid;
      });
      return wrap(requireSolid(fuseAll(solids), "Sweep", advice));
    });
  }

  loft(sections: LoftSectionInput[], options: LoftOptions = {}): KernelShape {
    if (sections.length < 2) throw new KernelError("Loft: select at least two sections.");
    return guard("Loft", () => {
      const wires = sections.map((section) => {
        if (section.type === "profile") {
          if (section.profile.holes.length > 0) {
            throw new KernelError(
              "Loft: a section with a hole in it is not supported. Select profiles without inner loops.",
            );
          }
          return outerWire(section.profile, section.plane);
        }
        const face = unwrap(section.shape).faces[section.faceIndex];
        if (!face) throw new KernelError("Loft: a selected face no longer exists.");
        if (face.geomType !== "PLANE") {
          throw new KernelError("Loft: only planar faces can be used as a section.");
        }
        return face.outerWire();
      });
      try {
        const solid = replicad.loft(wires, { ruled: options.ruled ?? false });
        return wrap(
          requireSolid(
            solid,
            "Loft",
            "the sections do not enclose a volume. Check that they do not lie in the same plane and do not cross each other.",
          ),
        );
      } finally {
        for (const w of wires) w.delete();
      }
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
        let area = 0;
        if (face) {
          surface = SURFACES[face.geomType] ?? "other";
          center = vec(face.center);
          normal = vec(face.normalAt());
          area = replicad.measureArea(face);
        }
        return { faceIndex: i, start: g.start, count: g.count, surface, center, normal, area };
      });

      const edgeMesh = s.meshEdges({ tolerance, angularTolerance });
      const brepEdges = s.edges;
      const edgeGroups: MeshEdgeGroup[] = edgeMesh.edgeGroups.map((g, i) => {
        const edge = brepEdges[i];
        const type = edge?.geomType;
        const zero = { x: 0, y: 0, z: 0 };
        const from = edge ? vec(edge.startPoint) : zero;
        const to = edge ? vec(edge.endPoint) : zero;
        const midpoint = edge ? vec(edge.pointAt(0.5)) : zero;
        const group: MeshEdgeGroup = {
          edgeIndex: i,
          start: g.start,
          count: g.count,
          midpoint,
          curve: type === "LINE" ? "line" : type === "CIRCLE" ? "circle" : "other",
          length: edge ? edge.length : 0,
          from,
          to,
          closed: dist3(from, to) < 1e-7 && (edge?.length ?? 0) > 1e-7,
        };
        if (edge && type === "BEZIER_CURVE") {
          const poles = bezierPoles(edge);
          if (poles) group.bezier = poles;
        }
        if (edge && type === "CIRCLE") {
          // Three points on the curve give the circle exactly.
          const circle = circleThrough(vec(edge.pointAt(0)), vec(edge.pointAt(1 / 3)), vec(edge.pointAt(2 / 3)));
          if (circle) {
            group.radius = circle.radius;
            group.center = circle.center;
          }
        }
        return group;
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
    return this.solidProblem(shape) === null;
  }

  solidProblem(shape: KernelShape): SolidProblem | null {
    let s: Shape3D;
    try {
      s = unwrap(shape);
      if (s.isNull || s.faces.length === 0 || !(replicad.measureVolume(s) > 1e-9)) return "empty";
    } catch {
      return "empty";
    }
    try {
      const oc = openCascade();
      // Every edge of a shell must join exactly two faces, or the "solid" has a gap.
      for (const shell of replicad.iterTopo(s.wrapped, "shell")) {
        if (!oc.BRep_Tool.IsClosed(shell)) return "open";
      }
      const analyzer = new oc.BRepCheck_Analyzer(s.wrapped, true, false, false);
      const valid = analyzer.IsValid();
      analyzer.delete();
      return valid ? null : "invalid";
    } catch {
      return "invalid";
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
