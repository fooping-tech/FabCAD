import type { BodyGeometry } from "@fabcad/brep";
import { type CadDocument, type Feature, listFeatures, serializeDocument } from "@fabcad/cad-document";
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
  meta: { version: string; date: Date } = { version: "", date: new Date() },
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
  });
  lines.push("", "Bodies:");
  const records = Object.values(doc.bodies);
  if (records.length === 0) lines.push("(none)");
  for (const b of records) {
    const g = bodies[b.id]?.geometry;
    lines.push(`- ${b.name} (${b.id})${b.visible ? "" : " hidden"}: ${g ? describeBody(g) : "no result"}`);
  }
  lines.push("", "Project (JSON):", serializeDocument(doc, false));
  return lines.join("\n");
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

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
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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
