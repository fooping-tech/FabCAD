import {
  type SolidTopology,
  type TopoFace,
  type Vec2,
  type Vec3,
  degToRad,
  dist2,
  dist3,
  dot3,
  edgeInteriorAngle,
  faceLoops2D,
  facePlane,
  radToDeg,
  sub3,
  worldToPlane,
} from "@fabcad/geometry";
import { type CadBody, type MaterialProfile, describeMaterial } from "@fabcad/fabrication-core";

/**
 * Board body classification: decides, before anything is compiled, what a body is in terms of
 * rigid board.
 *
 *   classifyBoardBody(body, material)
 *     ├─ flat part        the body IS the sheet: a 2D profile as thick as the material
 *     ├─ rectangular box  a cuboid, made from six panels
 *     └─ unsupported      everything else; nothing is fabricated
 *
 * The decision uses the polyhedral topology only (faces, loops, normals, edges, dihedral
 * angles). It never looks at names, at how the body was modelled, or at the world axes.
 *
 * A dedicated generator (e.g. a parametric case) does not go through this function: it builds
 * its panels from its own specification and can use the panel compilers directly.
 */
export type BoardBodyKind = "flat-part" | "rectangular-box" | "unsupported";

export type BoardUnsupportedCode =
  | "invalid-topology"
  | "not-closed"
  | "thickness-mismatch"
  | "curved-faces"
  | "non-right-angle"
  | "not-a-box"
  | "box-too-small";

export interface BoardClassifierOptions {
  /** Allowed difference between body thickness and material thickness (mm). Default 0.1. */
  thicknessTolerance?: number;
  /** Allowed deviation from 90° / 180° (degrees). Default 1. */
  angleTolerance?: number;
  /** Distance below which two points are the same, a point lies on a plane (mm). Default 0.01. */
  positionTolerance?: number;
}

export interface FlatPartInfo {
  /** Major face the part is drawn from (the one seen from the positive side of the axes). */
  face: number;
  /** The other major face. */
  opposite: number;
  /** Distance between the two major faces (mm). */
  thickness: number;
}

export interface RectangularBoxInfo {
  /** The three pairs of opposite faces (face ids, lower id first). */
  pairs: [number, number][];
  /** Edge lengths of the cuboid, ascending (mm). */
  size: [number, number, number];
}

export interface BoardClassification {
  kind: BoardBodyKind;
  /** "Flat Part", "Rectangular Box" or "Unsupported body". */
  label: string;
  reasonCode?: BoardUnsupportedCode;
  /** One sentence saying why the body is unsupported. */
  reason?: string;
  flatPart?: FlatPartInfo;
  box?: RectangularBoxInfo;
}

export const BOARD_KIND_LABELS: Record<BoardBodyKind, string> = {
  "flat-part": "Flat Part",
  "rectangular-box": "Rectangular Box",
  unsupported: "Unsupported body",
};

/** What board fabrication can do, for messages. */
export const BOARD_SUPPORT_TEXT =
  "FabCAD currently supports automatic board fabrication only for flat sheet parts " +
  "(a 2D profile as thick as the material) and rectangular boxes.";

interface Tolerances {
  thickness: number;
  angle: number;
  position: number;
}

const round = (value: number): string => String(Math.round(value * 100) / 100);

function unsupported(reasonCode: BoardUnsupportedCode, reason: string): BoardClassification {
  return { kind: "unsupported", label: BOARD_KIND_LABELS.unsupported, reasonCode, reason };
}

/** Every index used by faces and edges exists, every loop is a polygon. */
function isWellFormed(topology: SolidTopology | null | undefined): topology is SolidTopology {
  if (!topology || !Array.isArray(topology.vertices)) return false;
  if (!Array.isArray(topology.faces) || !Array.isArray(topology.edges)) return false;
  if (topology.faces.length === 0) return false;
  const vertexOk = (v: number): boolean => Number.isInteger(v) && topology.vertices[v] !== undefined;
  for (let i = 0; i < topology.faces.length; i++) {
    const face = topology.faces[i]!;
    // Faces are addressed by id throughout the topology helpers.
    if (face.id !== i || !face.normal || !Array.isArray(face.loops) || face.loops.length === 0) {
      return false;
    }
    for (const loop of face.loops) {
      if (!Array.isArray(loop) || loop.length < 3 || !loop.every(vertexOk)) return false;
    }
  }
  for (const edge of topology.edges) {
    if (!vertexOk(edge.a) || !vertexOk(edge.b) || !Array.isArray(edge.faces)) return false;
    if (!edge.faces.every((f) => topology.faces[f] !== undefined)) return false;
  }
  return true;
}

function isClosed(topology: SolidTopology): boolean {
  if (topology.edges.length === 0) return false;
  // Every side of every loop must be an edge shared by exactly two faces.
  const known = new Set<string>();
  for (const edge of topology.edges) {
    if (edge.faces.length !== 2 || edge.faces[0] === edge.faces[1]) return false;
    known.add(edge.a < edge.b ? `${edge.a}_${edge.b}` : `${edge.b}_${edge.a}`);
  }
  for (const face of topology.faces) {
    for (const loop of face.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        if (!known.has(a < b ? `${a}_${b}` : `${b}_${a}`)) return false;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------------------- flat part

/** Same polygon, whatever the start vertex and the direction of travel. */
function sameLoop(a: readonly Vec2[], b: readonly Vec2[], tol: number): boolean {
  const n = a.length;
  if (n !== b.length || n === 0) return false;
  for (let start = 0; start < n; start++) {
    if (dist2(a[0]!, b[start]!) > tol) continue;
    for (const dir of [1, -1]) {
      let ok = true;
      for (let k = 1; k < n && ok; k++) {
        ok = dist2(a[k]!, b[(((start + dir * k) % n) + n) % n]!) <= tol;
      }
      if (ok) return true;
    }
  }
  return false;
}

/** Every loop of `a` has exactly one partner in `b` (outer with outer, holes with holes). */
function sameLoops(a: readonly Vec2[][], b: readonly Vec2[][], tol: number): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!sameLoop(a[0]!, b[0]!, tol)) return false;
  const used = new Set<number>();
  for (let i = 1; i < a.length; i++) {
    let match = -1;
    for (let j = 1; j < b.length && match < 0; j++) {
      if (!used.has(j) && sameLoop(a[i]!, b[j]!, tol)) match = j;
    }
    if (match < 0) return false;
    used.add(match);
  }
  return true;
}

/**
 * Distance between faces `f` and `g` when the solid is the profile of `f` swept along its
 * normal up to `g`, `null` otherwise:
 *
 * - `f` and `g` are planar with anti-parallel normals, `g` lies behind `f`;
 * - both have the same loops when projected along the normal (outline and holes);
 * - every other face is a side wall: its normal is perpendicular to the normal of `f` and each
 *   of its vertices lies in the plane of `f` or in the plane of `g`. Facets of a curved wall
 *   (a round hole, a disc) qualify like any other wall.
 */
function sweepDistance(
  topology: SolidTopology,
  f: TopoFace,
  g: TopoFace,
  tol: Tolerances,
): number | null {
  if (f.surface !== "plane" || g.surface !== "plane") return null;
  if (f.loops.length !== g.loops.length) return null;
  const n = f.normal;
  if (dot3(n, g.normal) > -Math.cos(tol.angle)) return null;
  const origin = topology.vertices[f.loops[0]![0]!]!;
  const height = (p: Vec3): number => dot3(sub3(p, origin), n);
  const distance = -height(topology.vertices[g.loops[0]![0]!]!);
  if (!(distance > tol.position)) return null;

  const onF = (v: number): boolean => Math.abs(height(topology.vertices[v]!)) <= tol.position;
  const onG = (v: number): boolean =>
    Math.abs(height(topology.vertices[v]!) + distance) <= tol.position;
  if (!f.loops.every((loop) => loop.every(onF))) return null;
  if (!g.loops.every((loop) => loop.every(onG))) return null;

  const maxSlope = Math.sin(tol.angle);
  for (const face of topology.faces) {
    if (face === f || face === g) continue;
    if (Math.abs(dot3(face.normal, n)) > maxSlope) return null;
    let touchesF = false;
    let touchesG = false;
    for (const loop of face.loops) {
      for (const v of loop) {
        if (onF(v)) touchesF = true;
        else if (onG(v)) touchesG = true;
        else return null;
      }
    }
    // A wall joins the two profiles.
    if (!touchesF || !touchesG) return null;
  }

  const plane = facePlane(topology, f);
  const loopsF = faceLoops2D(topology, f, plane);
  const loopsG = g.loops.map((loop) => loop.map((v) => worldToPlane(plane, topology.vertices[v]!)));
  if (!sameLoops(loopsF, loopsG, tol.position)) return null;
  return distance;
}

/** True when `a` is the face seen from the positive side of the axes (Z, then Y, then X). */
function facesPositive(normal: Vec3): boolean {
  for (const c of [normal.z, normal.y, normal.x]) {
    if (Math.abs(c) > 1e-6) return c > 0;
  }
  return true;
}

interface FlatSearch {
  match?: FlatPartInfo;
  /**
   * A profile whose thickness is not the material thickness, but which is too thin to be
   * anything but a sheet: two panels of the material do not fit into it.
   */
  mismatch?: FlatPartInfo;
}

function findFlatPart(topology: SolidTopology, thickness: number, tol: Tolerances): FlatSearch {
  const result: FlatSearch = {};
  const planar = topology.faces.filter((face) => face.surface === "plane");
  for (let i = 0; i < planar.length; i++) {
    for (let j = i + 1; j < planar.length; j++) {
      const a = planar[i]!;
      const b = planar[j]!;
      const distance = sweepDistance(topology, a, b, tol);
      if (distance === null) continue;
      const [face, opposite] = facesPositive(a.normal) ? [a, b] : [b, a];
      const info: FlatPartInfo = { face: face.id, opposite: opposite.id, thickness: distance };
      if (Math.abs(distance - thickness) <= tol.thickness + 1e-9) {
        result.match = info;
        return result;
      }
      if (distance <= 2 * thickness + tol.thickness) result.mismatch ??= info;
    }
  }
  return result;
}

// ------------------------------------------------------------------------- rectangular box

type BoxCheck =
  | { ok: true; info: RectangularBoxInfo }
  | { ok: false; code: BoardUnsupportedCode; reason: string };

function checkRectangularBox(topology: SolidTopology, tol: Tolerances): BoxCheck {
  const { faces, edges } = topology;
  const curved = new Set<number>();
  for (const face of faces) if (face.surface !== "plane") curved.add(face.sourceFace);
  if (curved.size > 0) {
    return {
      ok: false,
      code: "curved-faces",
      reason:
        `This body has ${curved.size} curved face${curved.size === 1 ? "" : "s"}. ` +
        "Rigid board cannot be bent.",
    };
  }

  // Dihedral angles first: they give the most useful reason.
  let oblique: number | undefined;
  let concave = false;
  for (const edge of edges) {
    const theta = edgeInteriorAngle(topology, edge);
    if (theta === null) continue;
    if (Math.abs(theta - Math.PI / 2) <= tol.angle + 1e-9) continue;
    if (Math.abs(theta - 1.5 * Math.PI) <= tol.angle + 1e-9) concave = true;
    else oblique ??= theta;
  }
  if (oblique !== undefined) {
    return {
      ok: false,
      code: "non-right-angle",
      reason:
        `This body contains non-90° panel joints (faces meet at ${round(radToDeg(oblique))}°). ` +
        "Bevel and miter joints are not supported.",
    };
  }

  const notBox = (detail: string): BoxCheck => ({
    ok: false,
    code: "not-a-box",
    reason: `This body is not a rectangular box: ${detail}.`,
  });
  if (faces.length !== 6) {
    return notBox(`it has ${faces.length} faces${concave ? " and inner corners" : ""}, a box has 6`);
  }
  if (concave) return notBox("it has inner corners");
  const used = new Set<number>();
  for (const face of faces) {
    if (face.loops.length !== 1) return notBox("a face has an opening");
    if (face.loops[0]!.length !== 4) return notBox("a face is not a rectangle");
    for (const v of face.loops[0]!) used.add(v);
  }
  if (used.size !== 8) return notBox(`it has ${used.size} corners, a box has 8`);
  if (edges.length !== 12) return notBox(`it has ${edges.length} edges, a box has 12`);

  // Three pairs of opposite faces.
  const limit = -Math.cos(tol.angle);
  const partner = new Map<number, number>();
  for (const face of faces) {
    const opposite = faces.filter((g) => g !== face && dot3(face.normal, g.normal) <= limit);
    if (opposite.length !== 1) return notBox("its faces do not form three opposite pairs");
    partner.set(face.id, opposite[0]!.id);
  }
  const pairs: [number, number][] = [];
  for (const [a, b] of partner) {
    if (partner.get(b) !== a) return notBox("its faces do not form three opposite pairs");
    // Opposite faces never share an edge.
    if (edges.some((e) => e.faces.includes(a) && e.faces.includes(b))) {
      return notBox("opposite faces touch");
    }
    if (a < b) pairs.push([a, b]);
  }
  if (pairs.length !== 3) return notBox("its faces do not form three opposite pairs");

  // Three edge lengths, four edges each.
  const lengths = edges
    .map((e) => dist3(topology.vertices[e.a]!, topology.vertices[e.b]!))
    .sort((x, y) => x - y);
  const size: [number, number, number] = [lengths[0]!, lengths[4]!, lengths[8]!];
  for (let k = 0; k < 3; k++) {
    const group = lengths.slice(k * 4, k * 4 + 4);
    if (group[3]! - group[0]! > 2 * tol.position + 1e-6 * group[3]!) {
      return notBox("its edges do not have three lengths");
    }
  }
  if (!(size[0] > tol.position)) return notBox("it has no volume");
  return { ok: true, info: { pairs, size } };
}

// ------------------------------------------------------------------------------ classifier

/** Classify a body for board fabrication. Deterministic; never throws. */
export function classifyBoardBody(
  body: CadBody,
  material: MaterialProfile,
  options: BoardClassifierOptions = {},
): BoardClassification {
  const positive = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const tol: Tolerances = {
    thickness: positive(options.thicknessTolerance, 0.1),
    angle: degToRad(positive(options.angleTolerance, 1)),
    position: positive(options.positionTolerance, 0.01),
  };
  const what = describeMaterial(material);
  try {
    const topology = body?.topology;
    if (!isWellFormed(topology)) {
      return unsupported("invalid-topology", "This body has no usable solid geometry.");
    }
    if (!isClosed(topology)) {
      return unsupported(
        "not-closed",
        "This body is not a closed solid: some edges do not join exactly two faces.",
      );
    }

    const flat = findFlatPart(topology, material.thickness, tol);
    if (flat.match) {
      return { kind: "flat-part", label: BOARD_KIND_LABELS["flat-part"], flatPart: flat.match };
    }

    const box = checkRectangularBox(topology, tol);
    if (box.ok) {
      // Two opposite panels and something between them must fit into every direction.
      if (box.info.size[0] <= 2 * material.thickness + tol.thickness) {
        if (flat.mismatch) return unsupported("thickness-mismatch", mismatchText(flat.mismatch, what));
        return unsupported(
          "box-too-small",
          `This box is ${round(box.info.size[0])} mm in its smallest direction, which leaves no ` +
            `room between two panels of ${what}.`,
        );
      }
      return {
        kind: "rectangular-box",
        label: BOARD_KIND_LABELS["rectangular-box"],
        box: box.info,
      };
    }
    if (flat.mismatch) return unsupported("thickness-mismatch", mismatchText(flat.mismatch, what));
    return unsupported(box.code, box.reason);
  } catch {
    return unsupported("invalid-topology", "This body has no usable solid geometry.");
  }
}

function mismatchText(info: FlatPartInfo, what: string): string {
  return (
    `This body is a flat profile ${round(info.thickness)} mm thick, but the material is ${what}. ` +
    "A flat part must be as thick as the material."
  );
}
