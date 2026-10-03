import { type SolidTopology, type Vec3, dot3, len3, sub3 } from "@fabcad/geometry";

/**
 * Paper body classification: can the curved faces of a body be made from flat paper?
 *
 * Paper bends, but it does not stretch. A cylinder or a cone is rolled from a flat sheet (a
 * developable surface); a sphere, a torus or the rounding of a circular edge is curved in two
 * directions at once and is not. Unfolding such a face facet by facet gives dozens of slivers
 * that look like a cut file and cannot be put together.
 *
 * The decision uses the polyhedral topology only. At a vertex inside a curved face, the
 * corners of the facets around it add up to 360° when the surface can be laid flat there.
 * What is missing (the angular defect) is the curvature that paper cannot follow. One such
 * vertex in a face is the tip of a cone, which is cut open along one line and lies flat.
 * Several of them are a surface curved in two directions.
 *
 * Faces the kernel marks `developable` (a cylinder, a cone, the side wall of an extruded
 * spline) are not tested: their facets can have vertices inside the face whose corners miss
 * 360° by a little, which says something about the facetting and nothing about the surface.
 */
export interface DoublyCurvedFace {
  /** B-Rep face the facets belong to. */
  sourceFace: number;
  /** Vertices inside the face where the facets do not lie flat. */
  vertices: number;
  /** Sum of the angular defects in degrees (720° for a whole sphere). */
  defect: number;
  /** A point of the face, for showing where it is. */
  position: Vec3;
}

export interface PaperClassifierOptions {
  /** Angular defect (degrees) below which a vertex counts as flat. Default 0.05. */
  vertexTolerance?: number;
}

const cornerAngle = (at: Vec3, before: Vec3, after: Vec3): number => {
  const u = sub3(before, at);
  const v = sub3(after, at);
  const l = len3(u) * len3(v);
  if (l < 1e-18) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot3(u, v) / l)));
};

/** Curved faces of a body that are curved in two directions, in order of their face index. */
export function doublyCurvedFaces(
  topology: SolidTopology,
  options: PaperClassifierOptions = {},
): DoublyCurvedFace[] {
  const tolerance = ((options.vertexTolerance ?? 0.05) * Math.PI) / 180;
  // Per vertex: the faces around it, and the sum of their corners there.
  const around = new Map<number, { sources: Set<number>; curved: boolean; sum: number }>();
  for (const face of topology.faces) {
    for (const loop of face.loops) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const v = loop[i]!;
        const at = topology.vertices[v];
        const before = topology.vertices[loop[(i + n - 1) % n]!];
        const after = topology.vertices[loop[(i + 1) % n]!];
        if (!at || !before || !after) continue;
        let entry = around.get(v);
        if (!entry) {
          entry = { sources: new Set(), curved: true, sum: 0 };
          around.set(v, entry);
        }
        entry.sources.add(face.sourceFace);
        if (face.surface !== "curved" || face.developable) entry.curved = false;
        entry.sum += cornerAngle(at, before, after);
      }
    }
  }
  const found = new Map<number, DoublyCurvedFace>();
  for (const [v, entry] of around) {
    // Inside one curved face: every facet around the vertex belongs to it.
    if (!entry.curved || entry.sources.size !== 1) continue;
    const defect = Math.abs(2 * Math.PI - entry.sum);
    if (defect <= tolerance) continue;
    const sourceFace = [...entry.sources][0]!;
    const face = found.get(sourceFace);
    if (face) {
      face.vertices += 1;
      face.defect += (defect * 180) / Math.PI;
    } else {
      found.set(sourceFace, {
        sourceFace,
        vertices: 1,
        defect: (defect * 180) / Math.PI,
        position: topology.vertices[v]!,
      });
    }
  }
  return [...found.values()]
    .filter((face) => face.vertices > 1)
    .sort((a, b) => a.sourceFace - b.sourceFace);
}

// ------------------------------------------------------------------------------------ gores

/**
 * Gores: how a face curved in two directions is approximated by paper, the way a globe is
 * made. The facets of the face are taken as they are (the body is a polyhedron already) and
 * cut into narrow strips that run across the face. A strip of flat facets can always be laid
 * flat; what is lost is only that the strips are flat across their width.
 *
 * The strips follow the levels of the facets, counted from where the face is attached:
 * level 0 touches the longest boundary of the face, level 1 lies behind level 0, and so on.
 * A facet is folded to one facet of the level before it (across the longest edge they share)
 * and cut from everything else inside the face. How wide the strips are is a matter of how
 * finely the body was facetted.
 */
export interface GorePlan {
  /** Level of every facet that belongs to a gore, by face id. */
  levels: Map<number, number>;
  /** Edges inside the faces that must be cut: they separate the gores. */
  cuts: Set<number>;
  /** Number of gores (facets of level 0). */
  gores: number;
}

export function planGores(topology: SolidTopology, doubly: readonly DoublyCurvedFace[]): GorePlan {
  const sources = new Set(doubly.map((d) => d.sourceFace));
  const inside = (faceId: number): boolean => {
    const face = topology.faces[faceId];
    return face !== undefined && face.surface === "curved" && sources.has(face.sourceFace);
  };
  const length = (edgeId: number): number => {
    const e = topology.edges[edgeId]!;
    return len3(sub3(topology.vertices[e.b]!, topology.vertices[e.a]!));
  };
  // Facet adjacency inside the faces, and the edges towards the rest of the body.
  const neighbours = new Map<number, { face: number; edge: number }[]>();
  const rim: { edge: number; face: number }[] = [];
  for (const edge of topology.edges) {
    if (edge.faces.length !== 2) continue;
    const [f, g] = [edge.faces[0]!, edge.faces[1]!];
    if (inside(f) && inside(g)) {
      for (const [a, b] of [
        [f, g],
        [g, f],
      ] as const) {
        const list = neighbours.get(a);
        if (list) list.push({ face: b, edge: edge.id });
        else neighbours.set(a, [{ face: b, edge: edge.id }]);
      }
    } else if (inside(f) || inside(g)) {
      rim.push({ edge: edge.id, face: inside(f) ? f : g });
    }
  }
  const facets = topology.faces.filter((face) => inside(face.id)).map((face) => face.id);

  // Connected pieces of doubly curved surface.
  const piece = new Map<number, number>();
  let pieces = 0;
  for (const start of facets) {
    if (piece.has(start)) continue;
    const stack = [start];
    piece.set(start, pieces);
    while (stack.length > 0) {
      const f = stack.pop()!;
      for (const n of neighbours.get(f) ?? []) {
        if (piece.has(n.face)) continue;
        piece.set(n.face, pieces);
        stack.push(n.face);
      }
    }
    pieces++;
  }

  const levels = new Map<number, number>();
  const cuts = new Set<number>();
  let gores = 0;
  for (let p = 0; p < pieces; p++) {
    const own = facets.filter((f) => piece.get(f) === p);
    const ownRim = rim.filter((r) => piece.get(r.face) === p);
    let seeds: number[];
    /** Rim edges where the gores start; the other rim edges are where they end. */
    const startRim = new Set<number>();
    if (ownRim.length > 0) {
      // Boundaries of the piece: chains of rim edges that share vertices. The longest one is
      // where the gores start.
      const chainOf = new Map<number, number>();
      const byVertex = new Map<number, number[]>();
      ownRim.forEach((r, i) => {
        const e = topology.edges[r.edge]!;
        for (const v of [e.a, e.b]) {
          const list = byVertex.get(v);
          if (list) list.push(i);
          else byVertex.set(v, [i]);
        }
      });
      let chains = 0;
      ownRim.forEach((_, i) => {
        if (chainOf.has(i)) return;
        const stack = [i];
        chainOf.set(i, chains);
        while (stack.length > 0) {
          const e = topology.edges[ownRim[stack.pop()!]!.edge]!;
          for (const v of [e.a, e.b]) {
            for (const j of byVertex.get(v) ?? []) {
              if (chainOf.has(j)) continue;
              chainOf.set(j, chains);
              stack.push(j);
            }
          }
        }
        chains++;
      });
      const total = Array.from({ length: chains }, () => 0);
      ownRim.forEach((r, i) => {
        total[chainOf.get(i)!]! += length(r.edge);
      });
      let longest = 0;
      for (let c = 1; c < chains; c++) if (total[c]! > total[longest]! + 1e-9) longest = c;
      seeds = [...new Set(ownRim.filter((_, i) => chainOf.get(i) === longest).map((r) => r.face))];
      ownRim.forEach((r, i) => {
        if (chainOf.get(i) === longest) startRim.add(r.edge);
      });
    } else {
      // Closed (a sphere): start at the facets around its highest point, like a globe.
      let pole = -1;
      const higher = (a: Vec3, b: Vec3): boolean =>
        a.z !== b.z ? a.z > b.z : a.y !== b.y ? a.y > b.y : a.x > b.x;
      for (const f of own) {
        for (const v of topology.faces[f]!.loops[0]!) {
          if (pole < 0 || higher(topology.vertices[v]!, topology.vertices[pole]!)) pole = v;
        }
      }
      seeds = own.filter((f) => topology.faces[f]!.loops[0]!.includes(pole));
    }

    // Levels: distance from the seeds, facet by facet.
    let front = seeds.slice().sort((a, b) => a - b);
    for (const f of front) levels.set(f, 0);
    gores += front.length;
    let deepest = 0;
    while (front.length > 0) {
      const next: number[] = [];
      for (const f of front) {
        for (const n of neighbours.get(f) ?? []) {
          if (levels.has(n.face)) continue;
          levels.set(n.face, levels.get(f)! + 1);
          deepest = Math.max(deepest, levels.get(f)! + 1);
          next.push(n.face);
        }
      }
      front = next.sort((a, b) => a - b);
    }

    // Folds: every facet to one facet of the level before. Everything else is cut.
    const folds = new Set<number>();
    const parent = new Map<number, number>();
    for (const f of own) {
      const level = levels.get(f) ?? 0;
      if (level === 0) continue;
      let best: { face: number; edge: number } | undefined;
      for (const n of neighbours.get(f) ?? []) {
        if (levels.get(n.face) !== level - 1) continue;
        if (
          !best ||
          length(n.edge) > length(best.edge) + 1e-9 ||
          (Math.abs(length(n.edge) - length(best.edge)) <= 1e-9 && n.face < best.face)
        ) {
          best = n;
        }
      }
      if (best) {
        folds.add(best.edge);
        parent.set(f, best.face);
      }
    }
    if (ownRim.length > 0) {
      // Side by side on the sheet, the gores leave no room for the tabs that join them.
      // Every second gore is therefore held at its other end (the petals around the face
      // at the far boundary), or cut free when there is no other end. Its neighbours keep
      // their place, and the gaps between them are as wide as a gore.
      const colour = new Map<number, number>();
      for (const start of seeds.slice().sort((a, b) => a - b)) {
        if (colour.has(start)) continue;
        colour.set(start, 0);
        const queue = [start];
        while (queue.length > 0) {
          const f = queue.shift()!;
          for (const n of neighbours.get(f) ?? []) {
            if (levels.get(n.face) !== 0 || colour.has(n.face)) continue;
            colour.set(n.face, 1 - colour.get(f)!);
            queue.push(n.face);
          }
        }
      }
      const colourOf = (f: number): number => {
        let at = f;
        for (let guard = 0; guard < own.length && parent.has(at); guard++) at = parent.get(at)!;
        return colour.get(at) ?? 0;
      };
      for (const r of ownRim) {
        const second = colourOf(r.face) === 1;
        // Gores of the first kind hang on the start, the others on the far boundary.
        if (second === startRim.has(r.edge)) cuts.add(r.edge);
      }
    }
    if (ownRim.length === 0) {
      // Nothing else holds the gores of a closed surface together: they stay joined at their
      // widest, side by side, like the gores of a globe at the equator.
      const middle = Math.floor(deepest / 2);
      for (const f of own) {
        if (levels.get(f) !== middle) continue;
        for (const n of neighbours.get(f) ?? []) {
          if (levels.get(n.face) === middle) folds.add(n.edge);
        }
      }
    }
    for (const f of own) {
      for (const n of neighbours.get(f) ?? []) if (!folds.has(n.edge)) cuts.add(n.edge);
    }
  }
  return { levels, cuts, gores };
}
