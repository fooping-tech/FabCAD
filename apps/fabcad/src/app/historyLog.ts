import type { BodyGeometry } from "@fabcad/brep";
import type { Vec3 } from "@fabcad/geometry";
import {
  type CadDocument,
  type Feature,
  consumedBodies,
  listFeatures,
  serializeDocument,
} from "@fabcad/cad-document";
import type { FeatureStatus } from "@fabcad/features";

/**
 * The history of the design as text, to paste into a bug report: every step of the timeline
 * with its status and settings, what the bodies look like at the end, and the project itself
 * (the same JSON as Save) so that the result can be computed again. Pure function.
 */
export function historyLog(
  doc: CadDocument,
  statuses: Record<string, FeatureStatus | undefined>,
  bodies: Record<string, { geometry: BodyGeometry } | undefined>,
  meta: {
    version: string;
    date: Date;
    project?: boolean;
    fabrication?: string[] | null;
    /** Solve state of each sketch, by feature ID. */
    sketches?: Record<string, SketchState | undefined>;
  } = {
    version: "",
    date: new Date(),
  },
): string {
  const features = listFeatures(doc);
  const cursor = doc.timelineCursor ?? features.length;
  const lines: string[] = [
    `FabCAD history log${meta.version ? ` · ${meta.version}` : ""} · ${meta.date.toISOString()}`,
    `Document: ${doc.name} · ${features.length} steps · marker after step ${cursor}`,
    "",
    "Steps:",
  ];
  features.forEach((f, i) => {
    const status = statuses[f.id];
    const state = f.suppressed
      ? "suppressed"
      : i >= cursor
        ? "rolled back"
        : status
          ? status.state + (status.message ? `: ${status.message}` : "")
          : "not computed";
    lines.push(`${i + 1}. ${f.name} [${f.type}] (${f.id}) — ${state}`);
    lines.push(`   ${describeFeature(f, doc)}`);
    const sketch = meta.sketches?.[f.id];
    if (f.type === "sketch" && sketch) lines.push(`   ${describeSketchState(sketch)}`);
  });
  lines.push("", "Bodies:");
  const records = Object.values(doc.bodies);
  const consumed = consumedBodies(doc);
  if (records.length === 0) lines.push("(none)");
  for (const b of records) {
    const g = bodies[b.id]?.geometry;
    const by = consumed.get(b.id);
    const state = by
      ? `used up by ${doc.features[by]?.name ?? by}`
      : g
        ? describeBody(g)
        : "no result";
    lines.push(`- ${b.name} (${b.id})${b.visible ? "" : " hidden"}: ${state}`);
    if (g && !by) lines.push(...bodyDetails(g).map((l) => `   ${l}`));
  }
  if (meta.fabrication) lines.push("", "Fabrication (laser):", ...meta.fabrication);
  // Left out where the log is read on screen; the copy carries it.
  if (meta.project !== false) lines.push("", "Project (JSON):", serializeDocument(doc, false));
  return lines.join("\n");
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/** What the solver says of a sketch, and how many closed profiles it has. */
export interface SketchState {
  /** `fully-constrained`, `under-constrained` or `over-constrained`. */
  status: string;
  degreesOfFreedom: number;
  profiles: number;
}

function describeSketchState(s: SketchState): string {
  const status =
    s.status === "fully-constrained"
      ? "fully constrained"
      : s.status === "over-constrained"
        ? "over-constrained"
        : `under-constrained, ${s.degreesOfFreedom} DOF`;
  return `${status} · ${s.profiles} closed profiles`;
}

/** Values longer than this are left out of the steps, so that the steps stay readable. */
const LONG = 200;

/** The settings of a step, without its large parts (the geometry of a sketch). */
function describeFeature(f: Feature, doc: CadDocument): string {
  if (f.type === "sketch") {
    const s = f.sketch;
    const counts = new Map<string, number>();
    for (const e of Object.values(s.entities)) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const plane =
      s.plane.type === "origin"
        ? s.plane.plane
        : s.plane.type === "face"
          ? `face of ${s.plane.bodyId}`
          : s.plane.type;
    const parts = [
      `plane ${plane}`,
      [...counts].map(([t, n]) => `${n} ${t}`).join(", ") || "empty",
      `${Object.keys(s.constraints).length} constraints`,
      `${Object.keys(s.dimensions).length} dimensions`,
    ];
    if (s.projections.length > 0) parts.push(`${s.projections.length} projections`);
    if (s.texts && Object.keys(s.texts).length > 0) parts.push(`${Object.keys(s.texts).length} texts`);
    return parts.join(" · ");
  }
  const names = (ids: unknown): string =>
    Array.isArray(ids) ? ids.map((id) => doc.bodies[String(id)]?.name ?? String(id)).join(", ") : "";
  const out: string[] = [];
  for (const [key, value] of Object.entries(f)) {
    if (["id", "name", "type", "suppressed", "componentId"].includes(key)) continue;
    if (key === "targetBodyIds") {
      out.push(`targets ${names(value) || "none"}`);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length > LONG) {
      // The file of an import: its size is enough here, the project below carries it.
      out.push(`${key} (${value.length} characters)`);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push(`${key} ${value}`);
    } else if (Array.isArray(value)) {
      out.push(`${key} ×${value.length}`);
    }
  }
  return out.join(" · ") || "(no settings)";
}

/** Size and make-up of a computed body: enough to tell a sound solid from a broken one. */
function describeBody(g: BodyGeometry): string {
  const kinds = new Map<string, number>();
  for (const f of g.faces) kinds.set(f.surface, (kinds.get(f.surface) ?? 0) + 1);
  const { min, max } = g.bounds;
  return [
    `volume ${round(g.volume)} mm³`,
    `area ${round(g.area)} mm²`,
    `${g.faces.length} faces (${[...kinds].map(([k, n]) => `${n} ${k}`).join(", ")})`,
    `${g.edges.length} edges`,
    `${meshPieces(g)} separate pieces`,
    `bounds (${round(min.x)}, ${round(min.y)}, ${round(min.z)}) – (${round(max.x)}, ${round(max.y)}, ${round(max.z)})`,
  ].join(" · ");
}

/** Faces listed one by one in the log; a body with more lists the first ones. */
const MAX_FACES = 40;
/** Likewise for the circles. */
const MAX_CIRCLES = 20;

const AXES: [string, number, number, number][] = [
  ["+X", 1, 0, 0], ["-X", -1, 0, 0],
  ["+Y", 0, 1, 0], ["-Y", 0, -1, 0],
  ["+Z", 0, 0, 1], ["-Z", 0, 0, -1],
];

/** `+Z` for a direction along an axis, the rounded vector otherwise. */
function direction(n: { x: number; y: number; z: number }): string {
  for (const [name, x, y, z] of AXES) if (n.x * x + n.y * y + n.z * z > 1 - 1e-6) return name;
  return `(${round(n.x)}, ${round(n.y)}, ${round(n.z)})`;
}

/**
 * The size of a body, its circles and arcs (holes, fillets) by size, and its faces with where
 * they are: what a reader who cannot see the view needs to check the shape against the design.
 */
export function bodyDetails(g: BodyGeometry): string[] {
  const { min, max } = g.bounds;
  const out = [`size ${round(max.x - min.x)} × ${round(max.y - min.y)} × ${round(max.z - min.z)} mm (X × Y × Z)`];
  const tally = (items: number[], label: (v: number) => string): string =>
    [...items.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>())]
      .sort((a, b) => a[0] - b[0])
      .map(([v, n]) => `${n} × ${label(v)}`)
      .join(", ");
  // The B-Rep often splits a circle into arcs (at its seam): arcs of the same circle are put
  // together, and they make a circle when they go all the way round.
  const groups = new Map<string, { center: Vec3; radius: number; angle: number }>();
  for (const e of g.edges) {
    if (e.curve !== "circle" || e.radius === undefined || !e.center) continue;
    const axis = e.axis ? [e.axis.x, e.axis.y, e.axis.z].map((v) => round(Math.abs(v))) : [];
    const key = [e.center.x, e.center.y, e.center.z, e.radius].map(round).concat(axis).join(",");
    const group = groups.get(key) ?? { center: e.center, radius: e.radius, angle: 0 };
    group.angle += e.closed ? 2 * Math.PI : e.length / e.radius;
    groups.set(key, group);
  }
  const full = [...groups.values()].filter((c) => c.angle > 2 * Math.PI - 1e-3);
  const arcs = [...groups.values()].filter((c) => c.angle <= 2 * Math.PI - 1e-3).map((c) => round(c.radius));
  if (full.length > 0) {
    const listed = full
      .slice(0, MAX_CIRCLES)
      .map((c) => `Ø${round(c.radius * 2)} at (${round(c.center.x)}, ${round(c.center.y)}, ${round(c.center.z)})`);
    if (full.length > MAX_CIRCLES) listed.push(`… and ${full.length - MAX_CIRCLES} more`);
    out.push(`circles (${full.length}): ${listed.join(", ")}`);
  }
  if (arcs.length > 0) out.push(`arcs: ${tally(arcs, (r) => `R${r}`)}`);
  out.push("faces:");
  for (const f of g.faces.slice(0, MAX_FACES)) {
    const c = f.center;
    const where =
      f.surface === "plane"
        ? (() => {
            const dir = direction(f.normal);
            const offset = round(c.x * f.normal.x + c.y * f.normal.y + c.z * f.normal.z);
            const axis = dir.length === 2 ? dir[1]!.toLowerCase() : null;
            return axis
              ? `facing ${dir} at ${axis} = ${round(axis === "x" ? c.x : axis === "y" ? c.y : c.z)}`
              : `facing ${dir}, ${offset} from the origin`;
          })()
        : `around (${round(c.x)}, ${round(c.y)}, ${round(c.z)})`;
    out.push(`  F${f.faceIndex} ${f.surface} ${where} · ${round(f.area)} mm²`);
  }
  if (g.faces.length > MAX_FACES) out.push(`  … and ${g.faces.length - MAX_FACES} more faces`);
  return out;
}

/** Number of pieces of the mesh that do not touch each other. */
export function meshPieces(g: BodyGeometry): number {
  const key = (i: number): string =>
    `${Math.round(g.positions[i * 3]! * 1e4)},${Math.round(g.positions[i * 3 + 1]! * 1e4)},${Math.round(g.positions[i * 3 + 2]! * 1e4)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (k: string): void => {
    if (!parent.has(k)) parent.set(k, k);
  };
  for (let t = 0; t + 2 < g.indices.length; t += 3) {
    const ks = [key(g.indices[t]!), key(g.indices[t + 1]!), key(g.indices[t + 2]!)];
    for (const k of ks) add(k);
    parent.set(find(ks[1]!), find(ks[0]!));
    parent.set(find(ks[2]!), find(ks[0]!));
  }
  const roots = new Set<string>();
  for (const k of parent.keys()) roots.add(find(k));
  return roots.size;
}
