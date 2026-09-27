import type { Vec2 } from "@fabcad/geometry";

/**
 * ASCII DXF reader (R12 to 2018). Pure string parsing, no DOM or Node APIs and no third-party
 * library. The result is a neutral 2D drawing in the units of the file; `importDxfIntoSketch`
 * turns it into sketch entities in millimetres.
 *
 * Supported entities: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE / VERTEX / SEQEND (2D and 3D
 * polylines, not meshes), ELLIPSE, SPLINE, POINT and INSERT (block references are expanded:
 * translation, rotation, scale, mirroring, rectangular arrays and nested blocks).
 * Everything else (TEXT, MTEXT, HATCH, DIMENSION, …) is counted in `skipped`.
 */

export type DxfUnit = "mm" | "inch" | "cm" | "m" | "unitless";

export interface DxfDrawing {
  /** From $INSUNITS (0 unitless, 1 inch, 4 mm, 5 cm, 6 m); "unitless" when absent or unknown. */
  units: DxfUnit;
  /** $MEASUREMENT (0 imperial, 1 metric) when present: a hint for the UI when units are unitless. */
  measurement?: "imperial" | "metric";
  /** Layers of the LAYER table, followed by layers that are only referenced by entities. */
  layers: { name: string; color?: number }[];
  entities: DxfEntity[];
  /** Entity types that were present but are not supported, with counts (e.g. { TEXT: 3, HATCH: 1 }). */
  skipped: Record<string, number>;
  warnings: string[];
}

export type DxfEntity =
  | { type: "line"; layer: string; a: Vec2; b: Vec2 }
  | { type: "circle"; layer: string; center: Vec2; radius: number }
  /** Angles in radians, normalised to [0, 2π); the arc runs counter-clockwise from start to end. */
  | {
      type: "arc";
      layer: string;
      center: Vec2;
      radius: number;
      startAngle: number;
      endAngle: number;
    }
  /** LWPOLYLINE and POLYLINE / VERTEX / SEQEND. `bulge` belongs to the segment leaving the vertex. */
  | { type: "polyline"; layer: string; closed: boolean; vertices: { point: Vec2; bulge: number }[] }
  /**
   * `majorAxis` is the end of the major axis relative to the centre, `ratio` = minor / major.
   * The curve is centre + cos(t)·majorAxis + sin(t)·ratio·perp(majorAxis) and runs
   * counter-clockwise from `startParam` to `endParam` (radians); 0 and 2π for a full ellipse.
   */
  | {
      type: "ellipse";
      layer: string;
      center: Vec2;
      majorAxis: Vec2;
      ratio: number;
      startParam: number;
      endParam: number;
    }
  | {
      type: "spline";
      layer: string;
      degree: number;
      closed: boolean;
      controlPoints: Vec2[];
      fitPoints: Vec2[];
      knots: number[];
      /** Only present for rational splines (NURBS), one weight per control point. */
      weights?: number[];
    }
  | { type: "point"; layer: string; at: Vec2 };

export class DxfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DxfParseError";
  }
}

// ---------------------------------------------------------------------------------------------
// Tokens and records
// ---------------------------------------------------------------------------------------------

interface Pair {
  code: number;
  value: string;
}

/** One entity / table entry: the value of its group 0 and the pairs up to the next group 0. */
interface RawRecord {
  type: string;
  pairs: Pair[];
}

const BINARY_SENTINEL = "AutoCAD Binary DXF";

function tokenize(text: string): Pair[] {
  let source = text;
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  if (source.trimStart().startsWith(BINARY_SENTINEL)) {
    throw new DxfParseError(
      "This is a binary DXF file. Only ASCII DXF is supported: save the drawing as ASCII DXF and import it again.",
    );
  }
  if (source.slice(0, 4096).includes("\u0000")) {
    throw new DxfParseError("The file contains binary data and is not an ASCII DXF file.");
  }
  const lines = source.split(/\r\n|\r|\n/);
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  if (start === end) throw new DxfParseError("The file is empty.");

  const pairs: Pair[] = [];
  for (let i = start; i + 1 < end; i += 2) {
    const codeText = lines[i]!.trim();
    if (!/^-?\d+$/.test(codeText)) {
      const shown = codeText.length > 40 ? `${codeText.slice(0, 40)}…` : codeText;
      throw new DxfParseError(
        `Not a DXF file: line ${i + 1} should be a group code but is "${shown}".`,
      );
    }
    pairs.push({ code: Number(codeText), value: lines[i + 1]!.trim() });
  }
  if (pairs.length === 0) throw new DxfParseError("Not a DXF file: no group code / value pairs.");
  return pairs;
}

function splitRecords(pairs: readonly Pair[]): RawRecord[] {
  const out: RawRecord[] = [];
  let current: RawRecord | undefined;
  for (const p of pairs) {
    if (p.code === 0) {
      current = { type: p.value.toUpperCase(), pairs: [] };
      out.push(current);
    } else if (current) {
      current.pairs.push(p);
    }
  }
  return out;
}

interface Sections {
  header: Pair[];
  tables: Pair[];
  blocks: Pair[];
  entities: Pair[] | null;
}

function splitSections(pairs: readonly Pair[]): Sections {
  const out: Sections = { header: [], tables: [], blocks: [], entities: null };
  let sawSection = false;
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.toUpperCase() === "SECTION") {
      sawSection = true;
      const nameAt = pairs[i + 1];
      const name = nameAt && nameAt.code === 2 ? nameAt.value.toUpperCase() : "";
      let j = i + (name ? 2 : 1);
      const body: Pair[] = [];
      while (j < pairs.length) {
        const q = pairs[j]!;
        if (q.code === 0 && (q.value.toUpperCase() === "ENDSEC" || q.value.toUpperCase() === "EOF")) break;
        body.push(q);
        j++;
      }
      if (name === "HEADER") out.header = body;
      else if (name === "TABLES") out.tables = body;
      else if (name === "BLOCKS") out.blocks = body;
      else if (name === "ENTITIES") out.entities = (out.entities ?? []).concat(body);
      i = j + 1;
      continue;
    }
    i++;
  }
  if (!sawSection) {
    // Bare entity stream without sections (written by some minimal exporters).
    const body = pairs.filter((p) => !(p.code === 0 && p.value.toUpperCase() === "EOF"));
    const known = splitRecords(body).some((r) => ENTITY_TYPES.has(r.type));
    if (known) out.entities = body;
  }
  return out;
}

const ENTITY_TYPES = new Set([
  "LINE",
  "CIRCLE",
  "ARC",
  "LWPOLYLINE",
  "POLYLINE",
  "ELLIPSE",
  "SPLINE",
  "POINT",
  "INSERT",
]);

// ---------------------------------------------------------------------------------------------
// Parse context (warnings are collected as counts and written once at the end)
// ---------------------------------------------------------------------------------------------

interface Context {
  skipped: Record<string, number>;
  warnings: string[];
  badNumbers: number;
  nonZNormals: number;
  paperSpace: number;
  hasZ: boolean;
  missingBlocks: Set<string>;
  cyclicBlocks: Set<string>;
  insertsExpanded: number;
  truncated: boolean;
}

const Z_EPS = 1e-9;
/** Upper limit of entities created by block expansion, a guard against exploding arrays. */
const MAX_ENTITIES = 500_000;
const MAX_BLOCK_DEPTH = 16;

function first(rec: RawRecord, code: number): string | undefined {
  for (const p of rec.pairs) if (p.code === code) return p.value;
  return undefined;
}

function toNumber(ctx: Context, text: string): number {
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) {
    ctx.badNumbers++;
    return 0;
  }
  return n;
}

function num(ctx: Context, rec: RawRecord, code: number, fallback: number): number {
  const text = first(rec, code);
  return text === undefined ? fallback : toNumber(ctx, text);
}

function int(ctx: Context, rec: RawRecord, code: number, fallback: number): number {
  return Math.trunc(num(ctx, rec, code, fallback));
}

function layerOf(rec: RawRecord): string {
  const name = first(rec, 8);
  return name === undefined || name === "" ? "0" : name;
}

function noteZ(ctx: Context, z: number): void {
  if (Math.abs(z) > Z_EPS) ctx.hasZ = true;
}

const TWO_PI = 2 * Math.PI;
const degToRad = (d: number): number => (d * Math.PI) / 180;
const normalizeAngle = (a: number): number => {
  const t = a % TWO_PI;
  return t < 0 ? t + TWO_PI : t;
};

// ---------------------------------------------------------------------------------------------
// Object coordinate system
// ---------------------------------------------------------------------------------------------

type Facing = "up" | "down" | "other";

/**
 * Direction of the extrusion vector (group 210 / 220 / 230, default 0,0,1).
 *
 * CIRCLE, ARC, LWPOLYLINE, 2D POLYLINE and INSERT store their coordinates in the object
 * coordinate system (OCS) of that normal N. The DXF "arbitrary axis algorithm" derives the OCS
 * axes: for N close to ±Z, Ax = Wy × N and Ay = N × Ax. For N = (0,0,−1) this gives
 * Ax = (−1,0,0) and Ay = (0,1,0): the world X coordinate is the negated OCS X coordinate and
 * angles, measured counter-clockwise about N, run clockwise when seen from +Z. Such entities
 * are produced by mirroring in AutoCAD and are mapped back with `MIRROR_X`.
 */
function facing(ctx: Context, rec: RawRecord): Facing {
  const nx = num(ctx, rec, 210, 0);
  const ny = num(ctx, rec, 220, 0);
  const nz = num(ctx, rec, 230, 1);
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return "up";
  if (Math.hypot(nx, ny) / length > 1e-6) return "other";
  return nz > 0 ? "up" : "down";
}

/**
 * 2D affine map: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const MIRROR_X: Affine = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m ∘ n`: apply `n` first, then `m`. */
function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

const applyPoint = (m: Affine, p: Vec2): Vec2 => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
});

const applyVector = (m: Affine, v: Vec2): Vec2 => ({
  x: m.a * v.x + m.c * v.y,
  y: m.b * v.x + m.d * v.y,
});

const determinant = (m: Affine): number => m.a * m.d - m.b * m.c;

/** True when the map keeps circles circular (rotation, uniform scale, mirror, translation). */
function isSimilarity(m: Affine): boolean {
  const u = m.a * m.a + m.b * m.b;
  const v = m.c * m.c + m.d * m.d;
  const size = Math.max(u, v, 1e-300);
  return Math.abs(u - v) <= 1e-9 * size && Math.abs(m.a * m.c + m.b * m.d) <= 1e-9 * size;
}

/**
 * Image of the (elliptical) arc centre + cos(t)·major + sin(t)·minor, t from `start` to `end`
 * counter-clockwise, under an affine map.
 *
 * The images u, v of the two half axes are conjugate half diameters of the new ellipse and in
 * general no longer perpendicular. |P(t)|² = (u² + v²)/2 + cos(2t)·(u² − v²)/2 + sin(2t)·(u·v)
 * is largest at 2·t0 = atan2(2·u·v, u² − v²), which is where the new major axis lies; the new
 * minor axis is the point a quarter turn later. If the map mirrors, the curve runs clockwise
 * and start and end are exchanged (and negated) to keep the counter-clockwise convention.
 */
function transformConic(
  m: Affine,
  layer: string,
  center: Vec2,
  major: Vec2,
  ratio: number,
  start: number,
  end: number,
  full: boolean,
): DxfEntity {
  const u = applyVector(m, major);
  const v = applyVector(m, { x: -major.y * ratio, y: major.x * ratio });
  const t0 = 0.5 * Math.atan2(2 * (u.x * v.x + u.y * v.y), u.x * u.x + u.y * u.y - v.x * v.x - v.y * v.y);
  const c0 = Math.cos(t0);
  const s0 = Math.sin(t0);
  const newMajor = { x: c0 * u.x + s0 * v.x, y: c0 * u.y + s0 * v.y };
  const newMinor = { x: -s0 * u.x + c0 * v.x, y: -s0 * u.y + c0 * v.y };
  const majorLength = Math.hypot(newMajor.x, newMajor.y);
  const minorLength = Math.hypot(newMinor.x, newMinor.y);
  const mirrored = newMajor.x * newMinor.y - newMajor.y * newMinor.x < 0;
  const newCenter = applyPoint(m, center);
  const newRatio = majorLength > 0 ? minorLength / majorLength : 0;
  const from = mirrored ? -(end - t0) : start - t0;
  const to = mirrored ? -(start - t0) : end - t0;

  if (Math.abs(1 - newRatio) <= 1e-9) {
    if (full) return { type: "circle", layer, center: newCenter, radius: majorLength };
    const axis = Math.atan2(newMajor.y, newMajor.x);
    return {
      type: "arc",
      layer,
      center: newCenter,
      radius: majorLength,
      startAngle: normalizeAngle(from + axis),
      endAngle: normalizeAngle(to + axis),
    };
  }
  return {
    type: "ellipse",
    layer,
    center: newCenter,
    majorAxis: newMajor,
    ratio: newRatio,
    startParam: full ? 0 : normalizeAngle(from),
    endParam: full ? TWO_PI : normalizeAngle(to),
  };
}

/** True when the parameter range of an ellipse covers the whole ellipse. */
export function isFullEllipse(startParam: number, endParam: number): boolean {
  const sweep = normalizeAngle(endParam - startParam);
  return sweep < 1e-9 || TWO_PI - sweep < 1e-9;
}

export interface BulgeArc {
  center: Vec2;
  radius: number;
  /** Counter-clockwise from `startAngle` to `endAngle`, radians. */
  startAngle: number;
  endAngle: number;
  /**
   * True for a negative bulge: the polyline travels the arc clockwise from `a` to `b`, so the
   * counter-clockwise arc starts at `b` and ends at `a`.
   */
  clockwise: boolean;
}

/**
 * Arc of a bulged polyline segment from `a` to `b`.
 *
 * The bulge is tan(θ/4), θ being the included angle of the arc, positive when the arc runs
 * counter-clockwise from `a` to `b`. With the chord length d:
 * - sagitta s = |bulge|·d/2 and radius r = d·(1 + bulge²) / (4·|bulge|);
 * - the centre lies on the perpendicular bisector of the chord, at the signed distance
 *   d·(1 − bulge²) / (4·bulge) to the left of the direction a → b (negative = to the right;
 *   zero for a half circle, bulge = ±1).
 * Returns null for a straight or zero-length segment.
 */
export function bulgeArc(a: Vec2, b: Vec2, bulge: number): BulgeArc | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12 || d < 1e-12) return null;
  const offset = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (a.x + b.x) / 2 - dy * offset, y: (a.y + b.y) / 2 + dx * offset };
  const radius = (d * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const angleA = normalizeAngle(Math.atan2(a.y - center.y, a.x - center.x));
  const angleB = normalizeAngle(Math.atan2(b.y - center.y, b.x - center.x));
  const clockwise = bulge < 0;
  return {
    center,
    radius,
    startAngle: clockwise ? angleB : angleA,
    endAngle: clockwise ? angleA : angleB,
    clockwise,
  };
}

function transformEntity(m: Affine, e: DxfEntity): DxfEntity[] {
  switch (e.type) {
    case "line":
      return [{ ...e, a: applyPoint(m, e.a), b: applyPoint(m, e.b) }];
    case "point":
      return [{ ...e, at: applyPoint(m, e.at) }];
    case "circle":
      return [transformConic(m, e.layer, e.center, { x: e.radius, y: 0 }, 1, 0, TWO_PI, true)];
    case "arc":
      return [
        transformConic(m, e.layer, e.center, { x: e.radius, y: 0 }, 1, e.startAngle, e.endAngle, false),
      ];
    case "ellipse":
      return [
        transformConic(
          m,
          e.layer,
          e.center,
          e.majorAxis,
          e.ratio,
          e.startParam,
          e.endParam,
          isFullEllipse(e.startParam, e.endParam),
        ),
      ];
    case "spline": {
      // B-splines (also rational ones) are affinely invariant: mapping the points is exact.
      const out: DxfEntity = {
        ...e,
        controlPoints: e.controlPoints.map((p) => applyPoint(m, p)),
        fitPoints: e.fitPoints.map((p) => applyPoint(m, p)),
      };
      return [out];
    }
    case "polyline": {
      const hasBulge = e.vertices.some((v) => v.bulge !== 0);
      if (!hasBulge || isSimilarity(m)) {
        // A mirror turns counter-clockwise arcs into clockwise ones: the bulge changes sign.
        const sign = determinant(m) < 0 ? -1 : 1;
        return [
          {
            ...e,
            vertices: e.vertices.map((v) => ({ point: applyPoint(m, v.point), bulge: v.bulge * sign })),
          },
        ];
      }
      // Non-uniform scale: circular arcs become elliptical, which a polyline cannot hold.
      const out: DxfEntity[] = [];
      const n = e.vertices.length;
      const count = e.closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const from = e.vertices[i]!;
        const to = e.vertices[(i + 1) % n]!;
        const arc = bulgeArc(from.point, to.point, from.bulge);
        if (arc) {
          out.push(
            transformConic(
              m,
              e.layer,
              arc.center,
              { x: arc.radius, y: 0 },
              1,
              arc.startAngle,
              arc.endAngle,
              false,
            ),
          );
        } else {
          out.push({
            type: "line",
            layer: e.layer,
            a: applyPoint(m, from.point),
            b: applyPoint(m, to.point),
          });
        }
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

interface InsertRef {
  type: "insert";
  layer: string;
  block: string;
  at: Vec2;
  scaleX: number;
  scaleY: number;
  /** Radians. */
  rotation: number;
  columns: number;
  rows: number;
  columnSpacing: number;
  rowSpacing: number;
  mirrored: boolean;
}

type Item = DxfEntity | InsertRef;

function skip(ctx: Context, type: string): void {
  ctx.skipped[type] = (ctx.skipped[type] ?? 0) + 1;
}

/** Entities in the OCS: checks the normal and mirrors the entity when it faces −Z. */
function pushOcs(ctx: Context, rec: RawRecord, out: Item[], entity: DxfEntity): void {
  const f = facing(ctx, rec);
  if (f === "other") {
    ctx.nonZNormals++;
    return;
  }
  if (f === "up") out.push(entity);
  else out.push(...transformEntity(MIRROR_X, entity));
}

function readLwPolyline(ctx: Context, rec: RawRecord): DxfEntity {
  const vertices: { point: Vec2; bulge: number }[] = [];
  let current: { point: Vec2; bulge: number } | undefined;
  let flags = 0;
  for (const p of rec.pairs) {
    switch (p.code) {
      case 70:
        flags = Math.trunc(toNumber(ctx, p.value));
        break;
      case 38:
        noteZ(ctx, toNumber(ctx, p.value));
        break;
      case 10:
        current = { point: { x: toNumber(ctx, p.value), y: 0 }, bulge: 0 };
        vertices.push(current);
        break;
      case 20:
        if (current) current.point.y = toNumber(ctx, p.value);
        break;
      case 42:
        if (current) current.bulge = toNumber(ctx, p.value);
        break;
      default:
        break;
    }
  }
  return { type: "polyline", layer: layerOf(rec), closed: (flags & 1) !== 0, vertices };
}

function readSpline(ctx: Context, rec: RawRecord): DxfEntity {
  const controlPoints: Vec2[] = [];
  const fitPoints: Vec2[] = [];
  const knots: number[] = [];
  const weights: number[] = [];
  let flags = 0;
  let degree = 3;
  let lastControl: Vec2 | undefined;
  let lastFit: Vec2 | undefined;
  for (const p of rec.pairs) {
    switch (p.code) {
      case 70:
        flags = Math.trunc(toNumber(ctx, p.value));
        break;
      case 71:
        degree = Math.trunc(toNumber(ctx, p.value));
        break;
      case 40:
        knots.push(toNumber(ctx, p.value));
        break;
      case 41:
        weights.push(toNumber(ctx, p.value));
        break;
      case 10:
        lastControl = { x: toNumber(ctx, p.value), y: 0 };
        controlPoints.push(lastControl);
        break;
      case 20:
        if (lastControl) lastControl.y = toNumber(ctx, p.value);
        break;
      case 11:
        lastFit = { x: toNumber(ctx, p.value), y: 0 };
        fitPoints.push(lastFit);
        break;
      case 21:
        if (lastFit) lastFit.y = toNumber(ctx, p.value);
        break;
      case 30:
      case 31:
        noteZ(ctx, toNumber(ctx, p.value));
        break;
      default:
        break;
    }
  }
  const entity: DxfEntity = {
    type: "spline",
    layer: layerOf(rec),
    degree,
    closed: (flags & 1) !== 0,
    controlPoints,
    fitPoints,
    knots,
  };
  const rational =
    weights.length === controlPoints.length &&
    weights.length > 0 &&
    weights.some((w) => Math.abs(w - weights[0]!) > 1e-12);
  if (rational) entity.weights = weights;
  return entity;
}

function readItems(ctx: Context, records: readonly RawRecord[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const layer = layerOf(rec);

    if (rec.type === "POLYLINE") {
      // The vertices follow as separate records up to SEQEND.
      const vertexRecords: RawRecord[] = [];
      let j = i + 1;
      while (j < records.length && records[j]!.type === "VERTEX") {
        vertexRecords.push(records[j]!);
        j++;
      }
      if (j < records.length && records[j]!.type === "SEQEND") j++;
      i = j - 1;
      if (first(rec, 67) === "1") {
        ctx.paperSpace++;
        continue;
      }
      const flags = int(ctx, rec, 70, 0);
      if ((flags & (16 | 64)) !== 0) {
        skip(ctx, "POLYLINE (mesh)");
        continue;
      }
      const is3d = (flags & 8) !== 0;
      if (!is3d) noteZ(ctx, num(ctx, rec, 30, 0));
      const vertices: { point: Vec2; bulge: number }[] = [];
      for (const v of vertexRecords) {
        // Bit 16: control point of a spline-fit polyline, not part of the drawn curve.
        if ((int(ctx, v, 70, 0) & 16) !== 0) continue;
        if (is3d) noteZ(ctx, num(ctx, v, 30, 0));
        vertices.push({
          point: { x: num(ctx, v, 10, 0), y: num(ctx, v, 20, 0) },
          bulge: is3d ? 0 : num(ctx, v, 42, 0),
        });
      }
      const entity: DxfEntity = { type: "polyline", layer, closed: (flags & 1) !== 0, vertices };
      // 3D polylines are stored in world coordinates, 2D polylines in the OCS.
      if (is3d) out.push(entity);
      else pushOcs(ctx, rec, out, entity);
      continue;
    }

    if (rec.type === "VERTEX" || rec.type === "SEQEND" || rec.type === "ENDBLK") continue;
    if (first(rec, 67) === "1") {
      ctx.paperSpace++;
      continue;
    }

    switch (rec.type) {
      case "LINE": {
        noteZ(ctx, num(ctx, rec, 30, 0));
        noteZ(ctx, num(ctx, rec, 31, 0));
        out.push({
          type: "line",
          layer,
          a: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
          b: { x: num(ctx, rec, 11, 0), y: num(ctx, rec, 21, 0) },
        });
        break;
      }
      case "POINT": {
        noteZ(ctx, num(ctx, rec, 30, 0));
        out.push({ type: "point", layer, at: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) } });
        break;
      }
      case "CIRCLE": {
        noteZ(ctx, num(ctx, rec, 30, 0));
        pushOcs(ctx, rec, out, {
          type: "circle",
          layer,
          center: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
          radius: num(ctx, rec, 40, 0),
        });
        break;
      }
      case "ARC": {
        noteZ(ctx, num(ctx, rec, 30, 0));
        pushOcs(ctx, rec, out, {
          type: "arc",
          layer,
          center: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
          radius: num(ctx, rec, 40, 0),
          startAngle: normalizeAngle(degToRad(num(ctx, rec, 50, 0))),
          endAngle: normalizeAngle(degToRad(num(ctx, rec, 51, 0))),
        });
        break;
      }
      case "LWPOLYLINE": {
        pushOcs(ctx, rec, out, readLwPolyline(ctx, rec));
        break;
      }
      case "ELLIPSE": {
        // Centre and major axis are world coordinates; the normal only gives the direction of
        // rotation: about −Z the parameter runs clockwise when seen from +Z.
        const f = facing(ctx, rec);
        if (f === "other") {
          ctx.nonZNormals++;
          break;
        }
        noteZ(ctx, num(ctx, rec, 30, 0));
        noteZ(ctx, num(ctx, rec, 31, 0));
        const start = num(ctx, rec, 41, 0);
        const end = num(ctx, rec, 42, TWO_PI);
        const full = isFullEllipse(start, end);
        out.push({
          type: "ellipse",
          layer,
          center: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
          majorAxis: { x: num(ctx, rec, 11, 0), y: num(ctx, rec, 21, 0) },
          ratio: num(ctx, rec, 40, 1),
          startParam: full ? 0 : f === "up" ? start : normalizeAngle(-end),
          endParam: full ? TWO_PI : f === "up" ? end : normalizeAngle(-start),
        });
        break;
      }
      case "SPLINE": {
        if (facing(ctx, rec) === "other") {
          ctx.nonZNormals++;
          break;
        }
        out.push(readSpline(ctx, rec));
        break;
      }
      case "INSERT": {
        const f = facing(ctx, rec);
        if (f === "other") {
          ctx.nonZNormals++;
          break;
        }
        noteZ(ctx, num(ctx, rec, 30, 0));
        out.push({
          type: "insert",
          layer,
          block: first(rec, 2) ?? "",
          at: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
          scaleX: num(ctx, rec, 41, 1),
          scaleY: num(ctx, rec, 42, 1),
          rotation: degToRad(num(ctx, rec, 50, 0)),
          columns: Math.max(1, int(ctx, rec, 70, 1)),
          rows: Math.max(1, int(ctx, rec, 71, 1)),
          columnSpacing: num(ctx, rec, 44, 0),
          rowSpacing: num(ctx, rec, 45, 0),
          mirrored: f === "down",
        });
        break;
      }
      default:
        if (rec.type !== "") skip(ctx, rec.type);
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

interface Block {
  name: string;
  base: Vec2;
  records: RawRecord[];
  /** Parsed on first use, so that unsupported entities of unused blocks are not reported. */
  items?: Item[];
}

function readBlocks(ctx: Context, pairs: readonly Pair[]): Map<string, Block> {
  const blocks = new Map<string, Block>();
  let current: Block | undefined;
  for (const rec of splitRecords(pairs)) {
    if (rec.type === "BLOCK") {
      current = {
        name: first(rec, 2) ?? "",
        base: { x: num(ctx, rec, 10, 0), y: num(ctx, rec, 20, 0) },
        records: [],
      };
      blocks.set(current.name.toUpperCase(), current);
    } else if (rec.type === "ENDBLK") {
      current = undefined;
    } else if (current) {
      current.records.push(rec);
    }
  }
  return blocks;
}

/**
 * Matrices of a block reference, one per array cell:
 * OCS mirror ∘ translate(insertion point) ∘ rotate ∘ translate(cell) ∘ scale ∘ translate(−base).
 */
function insertMatrices(ref: InsertRef, base: Vec2): Affine[] {
  const c = Math.cos(ref.rotation);
  const s = Math.sin(ref.rotation);
  const out: Affine[] = [];
  for (let row = 0; row < ref.rows; row++) {
    for (let column = 0; column < ref.columns; column++) {
      const local: Affine = {
        a: ref.scaleX,
        b: 0,
        c: 0,
        d: ref.scaleY,
        e: -base.x * ref.scaleX + column * ref.columnSpacing,
        f: -base.y * ref.scaleY + row * ref.rowSpacing,
      };
      const placed: Affine = { a: c, b: s, c: -s, d: c, e: ref.at.x, f: ref.at.y };
      const m = compose(placed, local);
      out.push(ref.mirrored ? compose(MIRROR_X, m) : m);
    }
  }
  return out;
}

function expandItems(
  ctx: Context,
  blocks: Map<string, Block>,
  items: readonly Item[],
  matrix: Affine | null,
  inheritedLayer: string | null,
  stack: readonly string[],
  out: DxfEntity[],
): void {
  for (const item of items) {
    if (out.length >= MAX_ENTITIES) {
      ctx.truncated = true;
      return;
    }
    // Block geometry on layer "0" takes the layer of the block reference.
    const layer = item.layer === "0" && inheritedLayer !== null ? inheritedLayer : item.layer;
    if (item.type !== "insert") {
      const entity: DxfEntity = layer === item.layer ? item : { ...item, layer };
      if (matrix) out.push(...transformEntity(matrix, entity));
      else out.push(entity);
      continue;
    }
    const key = item.block.toUpperCase();
    const block = blocks.get(key);
    if (!block) {
      ctx.missingBlocks.add(item.block);
      continue;
    }
    if (stack.includes(key) || stack.length >= MAX_BLOCK_DEPTH) {
      ctx.cyclicBlocks.add(item.block);
      continue;
    }
    block.items ??= readItems(ctx, block.records);
    ctx.insertsExpanded++;
    for (const m of insertMatrices(item, block.base)) {
      expandItems(ctx, blocks, block.items, matrix ? compose(matrix, m) : m, layer, [...stack, key], out);
      if (ctx.truncated) return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Header and tables
// ---------------------------------------------------------------------------------------------

const INSUNITS: Record<number, DxfUnit> = { 0: "unitless", 1: "inch", 4: "mm", 5: "cm", 6: "m" };

const INSUNITS_NAMES: Record<number, string> = {
  2: "feet",
  3: "miles",
  7: "kilometres",
  8: "microinches",
  9: "mils",
  10: "yards",
  11: "ångströms",
  12: "nanometres",
  13: "microns",
  14: "decimetres",
  15: "decametres",
  16: "hectometres",
  17: "gigametres",
  18: "astronomical units",
  19: "light years",
  20: "parsecs",
};

function readHeader(
  ctx: Context,
  pairs: readonly Pair[],
): { units: DxfUnit; measurement?: "imperial" | "metric" } {
  let variable = "";
  let units: DxfUnit = "unitless";
  let measurement: "imperial" | "metric" | undefined;
  for (const p of pairs) {
    if (p.code === 9) {
      variable = p.value.toUpperCase();
    } else if (p.code === 70 && variable === "$INSUNITS") {
      const value = Math.trunc(toNumber(ctx, p.value));
      const unit = INSUNITS[value];
      if (unit) {
        units = unit;
      } else {
        const name = INSUNITS_NAMES[value];
        ctx.warnings.push(
          `The unit of the file ($INSUNITS ${value}${name ? `, ${name}` : ""}) is not supported; the drawing is treated as unitless.`,
        );
      }
    } else if (p.code === 70 && variable === "$MEASUREMENT") {
      measurement = Math.trunc(toNumber(ctx, p.value)) === 0 ? "imperial" : "metric";
    }
  }
  return measurement ? { units, measurement } : { units };
}

function readLayers(ctx: Context, pairs: readonly Pair[]): { name: string; color?: number }[] {
  const out: { name: string; color?: number }[] = [];
  let table = "";
  for (const rec of splitRecords(pairs)) {
    if (rec.type === "TABLE") {
      table = (first(rec, 2) ?? "").toUpperCase();
    } else if (rec.type === "ENDTAB") {
      table = "";
    } else if (rec.type === "LAYER" && table === "LAYER") {
      const name = first(rec, 2);
      if (name === undefined || name === "" || out.some((l) => l.name === name)) continue;
      const colorText = first(rec, 62);
      if (colorText === undefined) {
        out.push({ name });
      } else {
        // A negative colour number means that the layer is switched off.
        out.push({ name, color: Math.abs(Math.trunc(toNumber(ctx, colorText))) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function parseDxf(text: string): DxfDrawing {
  if (typeof text !== "string" || text.trim() === "") throw new DxfParseError("The file is empty.");
  const pairs = tokenize(text);
  const sections = splitSections(pairs);
  if (sections.entities === null) {
    throw new DxfParseError("Not a DXF drawing: the file has no ENTITIES section and no entities.");
  }

  const ctx: Context = {
    skipped: {},
    warnings: [],
    badNumbers: 0,
    nonZNormals: 0,
    paperSpace: 0,
    hasZ: false,
    missingBlocks: new Set(),
    cyclicBlocks: new Set(),
    insertsExpanded: 0,
    truncated: false,
  };

  const header = readHeader(ctx, sections.header);
  const layers = readLayers(ctx, sections.tables);
  const blocks = readBlocks(ctx, sections.blocks);
  const items = readItems(ctx, splitRecords(sections.entities));
  const entities: DxfEntity[] = [];
  expandItems(ctx, blocks, items, null, null, [], entities);

  for (const e of entities) {
    if (!layers.some((l) => l.name === e.layer)) layers.push({ name: e.layer });
  }

  const warnings = ctx.warnings;
  const skippedTotal = Object.values(ctx.skipped).reduce((sum, n) => sum + n, 0);
  if (skippedTotal > 0) {
    const list = Object.entries(ctx.skipped)
      .map(([type, n]) => `${type} × ${n}`)
      .join(", ");
    warnings.push(`${plural(skippedTotal, "entity was", "entities were")} not imported because the type is not supported: ${list}.`);
  }
  if (ctx.nonZNormals > 0) {
    warnings.push(
      `${plural(ctx.nonZNormals, "entity was", "entities were")} ignored because they do not lie in a plane parallel to the XY plane (extrusion direction other than ±Z).`,
    );
  }
  if (ctx.hasZ) {
    warnings.push("The drawing contains Z coordinates. They were dropped: the import is 2D.");
  }
  if (ctx.paperSpace > 0) {
    warnings.push(`${plural(ctx.paperSpace, "paper space entity was", "paper space entities were")} ignored.`);
  }
  if (ctx.missingBlocks.size > 0) {
    warnings.push(
      `Block references to undefined blocks were ignored: ${[...ctx.missingBlocks].join(", ")}.`,
    );
  }
  if (ctx.cyclicBlocks.size > 0) {
    warnings.push(
      `Block references nested too deeply or referring to themselves were ignored: ${[...ctx.cyclicBlocks].join(", ")}.`,
    );
  }
  if (ctx.truncated) {
    warnings.push(`The drawing was cut off after ${MAX_ENTITIES} entities.`);
  }
  if (ctx.badNumbers > 0) {
    warnings.push(`${plural(ctx.badNumbers, "malformed number was", "malformed numbers were")} read as 0.`);
  }

  const drawing: DxfDrawing = {
    units: header.units,
    layers,
    entities,
    skipped: ctx.skipped,
    warnings,
  };
  if (header.measurement) drawing.measurement = header.measurement;
  return drawing;
}
