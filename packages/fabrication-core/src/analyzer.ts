import {
  type SolidTopology,
  type TopoEdge,
  type Vec3,
  dist3,
  edgeInteriorAngle,
  lerp3,
  radToDeg,
} from "@fabcad/geometry";
import type {
  CadBody,
  FabricationAnalysis,
  FabricationWarning,
  MaterialProfile,
} from "./types";

/**
 * The Fabrication Analyzer. It only inspects the polyhedral topology of a body (faces, edges,
 * dihedral angles) and never looks at how the body was modelled.
 */

/** Human readable material description, e.g. `5.5 mm MDF`. */
export function describeMaterial(material: MaterialProfile): string {
  const base = material.name
    .replace(/\s*\d+(?:[.,]\d+)?\s*mm\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${formatNumber(material.thickness)} mm ${base.length > 0 ? base : material.category}`;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function edgeMidpoint(topology: SolidTopology, edge: TopoEdge): Vec3 | undefined {
  const a = topology.vertices[edge.a];
  const b = topology.vertices[edge.b];
  return a && b ? lerp3(a, b, 0.5) : undefined;
}

/** Material independent analysis: face kinds, closedness. */
export function analyzeBody(body: CadBody): FabricationAnalysis {
  const { topology } = body;
  const warnings: FabricationWarning[] = [];
  let planarFaces = 0;
  const curvedSources = new Set<number>();
  for (const face of topology.faces) {
    if (face.surface === "curved") curvedSources.add(face.sourceFace);
    else planarFaces++;
  }
  if (curvedSources.size > 0) {
    warnings.push({
      code: "curved-face",
      severity: "warning",
      message:
        `"${body.name}" has ${curvedSources.size} curved face(s). ` +
        "Curved faces cannot be made from rigid board; they are approximated by facets for paper.",
    });
  }
  let closed = topology.faces.length > 0;
  let open = 0;
  let firstOpen: TopoEdge | undefined;
  for (const edge of topology.edges) {
    if (edge.faces.length !== 2) {
      closed = false;
      open++;
      firstOpen ??= edge;
    }
  }
  if (open > 0 && firstOpen) {
    warnings.push({
      code: "non-manifold",
      severity: "warning",
      message:
        `"${body.name}" is not a closed solid: ${open} edge(s) do not join exactly two faces. ` +
        "These edges are left as plain cut edges.",
      position: edgeMidpoint(topology, firstOpen),
    });
  }
  return { planarFaces, curvedFaces: curvedSources.size, closed, warnings };
}

export interface BoardFeasibilityOptions {
  /** Dihedral angles below this (degrees) are reported as `acute-angle`. Default 60. */
  acuteAngle?: number;
  /** Edges shorter than `shortEdgeFactor × thickness` are reported as `short-edge`. Default 3. */
  shortEdgeFactor?: number;
}

export interface BoardEdgeIssue {
  /** Id of the topology edge the warning is about. */
  edge: number;
  warning: FabricationWarning;
}

/**
 * Thickness-aware checks of every crease between two planar faces. Returned per topology edge
 * so strategies can attach their own connection ids.
 */
export function boardEdgeIssues(
  body: CadBody,
  material: MaterialProfile,
  opts: BoardFeasibilityOptions = {},
): BoardEdgeIssue[] {
  const { topology } = body;
  const acute = opts.acuteAngle ?? 60;
  const minLength = (opts.shortEdgeFactor ?? 3) * material.thickness;
  const what = describeMaterial(material);
  const issues: BoardEdgeIssue[] = [];
  for (const edge of topology.edges) {
    if (edge.faces.length !== 2) continue;
    const f = topology.faces[edge.faces[0]!];
    const g = topology.faces[edge.faces[1]!];
    if (!f || !g || f.surface !== "plane" || g.surface !== "plane") continue;
    const a = topology.vertices[edge.a];
    const b = topology.vertices[edge.b];
    if (!a || !b) continue;
    const position = lerp3(a, b, 0.5);
    const theta = edgeInteriorAngle(topology, edge);
    if (theta !== null) {
      const deg = radToDeg(theta);
      if (deg > 180 + 1e-6) {
        issues.push({
          edge: edge.id,
          warning: {
            code: "concave-corner",
            severity: "warning",
            message:
              `This corner cannot be reproduced accurately with ${what}: ` +
              `concave corner (interior angle ${deg.toFixed(1)}°), the panels only touch along a line.`,
            position,
          },
        });
      } else if (deg < acute - 1e-6) {
        issues.push({
          edge: edge.id,
          warning: {
            code: "acute-angle",
            severity: "warning",
            message:
              `This corner cannot be reproduced accurately with ${what}: ` +
              `the angle between the panels is only ${deg.toFixed(1)}°.`,
            position,
          },
        });
      }
    }
    const length = dist3(a, b);
    if (length < minLength - 1e-9) {
      issues.push({
        edge: edge.id,
        warning: {
          code: "short-edge",
          severity: "info",
          message:
            `This edge (${length.toFixed(1)} mm) is short for ${what}; ` +
            `edges should be at least ${formatNumber(minLength)} mm long.`,
          position,
        },
      });
    }
  }
  return issues;
}

/** Thickness-aware feasibility warnings for rigid board materials. */
export function analyzeBoardFeasibility(
  body: CadBody,
  material: MaterialProfile,
  opts: BoardFeasibilityOptions = {},
): FabricationWarning[] {
  return boardEdgeIssues(body, material, opts).map((i) => i.warning);
}

/** Remove warnings that say the same thing about the same place. */
export function dedupeWarnings(warnings: readonly FabricationWarning[]): FabricationWarning[] {
  const seen = new Set<string>();
  const out: FabricationWarning[] = [];
  for (const w of warnings) {
    const p = w.position;
    const pos = p ? `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}` : "";
    const key = [w.code, w.partId ?? "", w.edgeId ?? "", w.connectionId ?? "", pos, w.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}
