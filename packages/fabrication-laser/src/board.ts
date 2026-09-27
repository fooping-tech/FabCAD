import {
  type Plane3,
  type SolidTopology,
  type TopoEdge,
  type TopoFace,
  type Vec2,
  type Vec3,
  buildEdgeLookup,
  cross2,
  degToRad,
  dist2,
  dot2,
  dot3,
  edgeInteriorAngle,
  ensureCCW,
  faceLoops2D,
  facePlane,
  lerp3,
  norm2,
  offsetPolygonEdges,
  perp2,
  radToDeg,
  scale3,
  signedArea,
  sub2,
  sub3,
  topoEdgeKey,
} from "@fabcad/geometry";
import {
  type CadBody,
  type EdgeConnection,
  type FabricationResult,
  type FabricationStrategy,
  type FabricationWarning,
  type FlatPart,
  type FlatPath,
  type JointFeature,
  type JointType,
  type MaterialProfile,
  type PartEdge,
  type StrategySettings,
  analyzeBody,
  boardEdgeIssues,
  compensateKerf,
  dedupeWarnings,
  describeMaterial,
} from "@fabcad/fabrication-core";
import { boundsOfPaths, closeLoop, pushPoint, uniqueNames } from "./shared";

/**
 * Laser board strategy (MDF / acrylic / cardboard):
 *
 *   Solid → Panel Decomposition → Joints → Thickness Compensation → Kerf Compensation → Flat Parts
 *
 * Everything is derived from the polyhedral topology (faces, edges, dihedral angles). There is
 * no knowledge of "boxes" or "prisms" anywhere in this file.
 */
export interface BoardSettings extends StrategySettings {
  /** Joint for edges where one panel (the cap) lies over the other. Default "tab-slot". */
  capJoint: "tab-slot" | "finger" | "flat";
  /** Joint between two non-cap panels. Default "flat" (butt joint, glued). */
  sideJoint: "flat" | "finger";
  /** Distance from the slot panel's outline to its slots (mm). 0 = open notches. Default 3. */
  slotEdgeMargin: number;
  /** Target tab width (mm). Default 3 × thickness. The tab count is derived per edge. */
  tabWidth: number;
  /** Smallest acceptable tab (mm). Default 1.5 × thickness. */
  minTabWidth: number;
  /** Target spacing between tabs (mm). Default 4 × thickness. */
  tabSpacing: number;
  /** Target finger width (mm). Default 2 × thickness. */
  fingerWidth: number;
  /** How far from 90° (degrees) an edge may be for tab-slot / finger joints. Default 1. */
  angleTolerance: number;
  /** Apply kerf compensation to the final paths. Default true. */
  kerfCompensation: boolean;
  /** Per-face role override, keyed by topology face id. */
  roles?: Record<number, "slot" | "tab">;
}

export function defaultBoardSettings(material: MaterialProfile): BoardSettings {
  const t = material.thickness;
  return {
    capJoint: "tab-slot",
    sideJoint: "flat",
    slotEdgeMargin: 3,
    tabWidth: 3 * t,
    minTabWidth: 1.5 * t,
    tabSpacing: 4 * t,
    fingerWidth: 2 * t,
    angleTolerance: 1,
    kerfCompensation: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------------------------

/**
 * A rectangle attached to one panel edge, in the edge's local frame:
 * point(a, d) = pa + u·a + v·d, where `pa` is the start of the ORIGINAL (un-offset) edge, `u`
 * its direction and `v` the in-plane normal pointing INTO the panel material.
 */
interface EdgeRect {
  a0: number;
  a1: number;
  /** Depth of the far side. Smaller than the edge offset = protrudes, larger = notch. */
  dFar: number;
}

interface PanelEdge {
  loop: number;
  index: number;
  globalIndex: number;
  va: number;
  vb: number;
  pa: Vec2;
  pb: Vec2;
  u: Vec2;
  v: Vec2;
  length: number;
  topoEdge?: TopoEdge;
  link?: Link;
  /** In-plane shift of the edge into the material (thickness compensation). */
  offset: number;
  collapsed: boolean;
  /** Rectangles spliced into the loop along this edge (tabs, fingers, open notches). */
  splice: EdgeRect[];
}

interface Panel {
  face: TopoFace;
  plane: Plane3;
  loops: Vec2[][];
  edges: PanelEdge[][];
  area: number;
  isCap: boolean;
  /** Inward shift of the panel's outer surface (mm). */
  shift: number;
  partId: string;
  name: string;
  offsetLoops: Vec2[][];
  joints: JointFeature[];
  slotPaths: FlatPath[];
}

type LinkKind = "tab-slot" | "finger" | "flat" | "touch";

/** Two panels meeting at one topology edge. `p` is the primary (slot / through) panel. */
interface Link {
  id: string;
  edge: TopoEdge;
  theta: number;
  length: number;
  kind: LinkKind;
  p: Panel;
  q: Panel;
  pe: PanelEdge;
  qe: PanelEdge;
}

const HALF_PI = Math.PI / 2;

/**
 * Thickness compensation in the cross-section perpendicular to an edge.
 *
 * Put the edge at the origin, panel G's outer face along +x with its material above (+y), and
 * the neighbour H's outer face along (cos θ, sin θ), θ being the interior dihedral angle. H's
 * inward normal is then (sin θ, −cos θ). G's slab is m_G ≤ y ≤ m_G + t and is cut square at
 * x = c; H's outer surface is x·sin θ − y·cos θ = m_H and its inner surface is … = m_H + t.
 *
 * - "meet": the shifted outer surfaces intersect at x0 = (m_G·cos θ + m_H) / sin θ.
 * - "butt": G must stay clear of H's inner surface for every y of its slab. The critical
 *   corner is y = m_G for θ ≥ 90° and y = m_G + t for θ < 90°, which gives
 *   (m_G·cos θ + m_H + t) / sin θ and ((m_G + t)·cos θ + m_H + t) / sin θ.
 * - "through": G runs up to H's outer surface without sticking out of it:
 *   (m_G·cos θ + m_H) / sin θ for θ ≥ 90°, ((m_G + t)·cos θ + m_H) / sin θ for θ < 90°.
 *
 * The result is the distance the edge moves into G, measured in G's plane from the designed
 * edge. Negative values extend the panel (possible at concave corners).
 */
export function edgeCompensation(
  kind: "meet" | "butt" | "through",
  mG: number,
  mH: number,
  t: number,
  theta: number,
): number {
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  // Coplanar (θ ≈ 180°) or degenerate (θ ≈ 0° / 360°) neighbours: nothing to compensate.
  if (Math.abs(sin) < 0.02) return 0;
  if (kind === "meet" || theta > Math.PI) return (mG * cos + mH) / sin;
  const own = theta >= HALF_PI - 1e-12 ? mG : mG + t;
  const clear = kind === "butt" ? mH + t : mH;
  return (own * cos + clear) / sin;
}

/** Angle of the material at the start vertex of `edge` (between the previous edge and it). */
function materialAngleAtStart(edges: readonly PanelEdge[], index: number): number {
  const n = edges.length;
  const prev = edges[(index + n - 1) % n]!;
  const cur = edges[index]!;
  // Material is on the left of travel: turning left by φ leaves an interior angle of π − φ.
  const turn = Math.atan2(cross2(prev.u, cur.u), dot2(prev.u, cur.u));
  return Math.PI - turn;
}

/**
 * Distance from a corner of the slot panel within which no slot may start. `depth` is how far
 * slots reach into the panel (margin + thickness + fit). For a corner of angle α a point at
 * that depth from one edge is `depth` away from the other edge when it is
 * depth·(1 + cos α) / sin α along the edge; one more `web` of material keeps the slots of the
 * two edges apart. For α = 90° this is margin + thickness + fit + web.
 */
function cornerClearance(alpha: number, depth: number, web: number): number {
  if (alpha >= Math.PI - 1e-6) return web;
  const sin = Math.sin(alpha);
  if (sin < 1e-6) return Infinity;
  return Math.max(0, (depth * (1 + Math.cos(alpha))) / sin) + web;
}

const localPoint = (e: PanelEdge, a: number, d: number): Vec2 => ({
  x: e.pa.x + e.u.x * a + e.v.x * d,
  y: e.pa.y + e.u.y * a + e.v.y * d,
});

const rectPolygon = (e: PanelEdge, a0: number, a1: number, d0: number, d1: number): Vec2[] =>
  ensureCCW([localPoint(e, a0, d0), localPoint(e, a1, d0), localPoint(e, a1, d1), localPoint(e, a0, d1)]);

// ---------------------------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------------------------

function fabricateBoard(
  body: CadBody,
  material: MaterialProfile,
  input: BoardSettings,
): FabricationResult {
  const settings: BoardSettings = { ...defaultBoardSettings(material), ...input };
  const { topology } = body;
  const t = material.thickness;
  const fit = material.fitOffset;
  const margin = Math.max(0, settings.slotEdgeMargin);
  const what = describeMaterial(material);
  const warnings: FabricationWarning[] = [...analyzeBody(body).warnings];
  const midpoint = (edge: TopoEdge): Vec3 =>
    lerp3(topology.vertices[edge.a]!, topology.vertices[edge.b]!, 0.5);

  // 1. Panel decomposition: one panel per planar face, outer surface = the solid's face.
  const panels = buildPanels(body, topology);
  const panelOfFace = new Map<number, Panel>();
  for (const panel of panels) panelOfFace.set(panel.face.id, panel);

  // 2. Links: topology edges shared by exactly two different panels.
  const links = buildLinks(body, topology, panels, panelOfFace);

  // 3. Roles.
  const axis = chooseCaps(panels, links, settings);
  namePanels(panels);
  const toleranceRad = degToRad(settings.angleTolerance);
  for (const link of links) {
    const near90 = Math.abs(link.theta - HALF_PI) <= toleranceRad + 1e-9;
    const capLink = link.p.isCap !== link.q.isCap;
    // Primary panel (slot / through), decided by the first rule that applies:
    //  1. a cap is always primary;
    //  2. the panel with the larger area runs through, the smaller one butts against it
    //     (opposite walls of a cuboid then come out identical);
    //  3. equal areas: look along the dominant axis (normal of the reference cap, or of the
    //     largest panel when there are no caps). The panel whose outer loop runs along the
    //     edge in the direction of the axis is primary. Around a ring of equal walls every
    //     panel is then primary at one end and secondary at the other, so all walls are equal;
    //  4. otherwise the lower face id.
    let primaryIsP: boolean;
    const along = dot3(
      sub3(topology.vertices[link.pe.vb]!, topology.vertices[link.pe.va]!),
      axis,
    );
    if (capLink) primaryIsP = link.p.isCap;
    else if (Math.abs(link.p.area - link.q.area) > 1e-6 * Math.max(link.p.area, link.q.area)) {
      primaryIsP = link.p.area > link.q.area;
    } else if (Math.abs(along) > 1e-6 * Math.max(1, link.length)) primaryIsP = along > 0;
    else primaryIsP = link.p.face.id < link.q.face.id;
    if (!primaryIsP) {
      [link.p, link.q] = [link.q, link.p];
      [link.pe, link.qe] = [link.qe, link.pe];
    }
    const degrees = radToDeg(link.theta);
    if (link.theta > Math.PI + 1e-6) {
      link.kind = "touch";
      continue;
    }
    const wanted: JointType = capLink ? settings.capJoint : settings.sideJoint;
    if (wanted !== "flat" && !near90) {
      link.kind = "flat";
      warnings.push({
        code: "joint-fallback",
        severity: "warning",
        message:
          `A ${wanted} joint needs a 90° corner; this edge is at ${degrees.toFixed(1)}°. ` +
          "A flat (butt) joint is used instead.",
        connectionId: link.id,
        position: midpoint(link.edge),
      });
    } else {
      link.kind = wanted === "tab-slot" ? "tab-slot" : wanted === "finger" ? "finger" : "flat";
    }
  }

  // Plane shift: panels that carry tabs into a slot panel move inward by the margin so that
  // their tabs enter closed slots. Slot panels (caps) never move.
  for (const link of links) {
    if (link.kind === "tab-slot" && !link.q.isCap) link.q.shift = margin;
  }

  // 4. Thickness compensation per edge.
  for (const link of links) {
    const { p, q, pe, qe, theta } = link;
    switch (link.kind) {
      case "tab-slot":
        pe.offset = 0;
        qe.offset = edgeCompensation("butt", q.shift, p.shift, t, theta);
        break;
      case "flat":
        pe.offset = edgeCompensation("through", p.shift, q.shift, t, theta);
        qe.offset = edgeCompensation("butt", q.shift, p.shift, t, theta);
        break;
      case "finger":
        pe.offset = edgeCompensation("butt", p.shift, q.shift, t, theta);
        qe.offset = edgeCompensation("butt", q.shift, p.shift, t, theta);
        break;
      case "touch":
        pe.offset = edgeCompensation("meet", p.shift, q.shift, t, theta);
        qe.offset = edgeCompensation("meet", q.shift, p.shift, t, theta);
        break;
    }
  }
  for (const panel of panels) {
    panel.offsetLoops = panel.loops.map((loop, li) => {
      const edges = panel.edges[li]!;
      // `offsetPolygonEdges` measures towards the polygon interior. Material lies inside the
      // outer loop but OUTSIDE a hole loop, hence the sign change for holes.
      const sign = li === 0 ? 1 : -1;
      const result = offsetPolygonEdges(
        loop,
        edges.map((e) => sign * e.offset),
      );
      for (const i of result.collapsedEdges) {
        const e = edges[i];
        if (!e) continue;
        e.collapsed = true;
        warnings.push({
          code: "edge-collapsed",
          severity: "error",
          message:
            `An edge of "${panel.name}" (${e.length.toFixed(1)} mm) disappears after thickness ` +
            `compensation. This corner cannot be reproduced accurately with ${what}.`,
          partId: panel.partId,
          edgeId: `${panel.partId}.edge-${e.globalIndex}`,
          connectionId: e.link?.id,
          position: e.topoEdge ? midpoint(e.topoEdge) : undefined,
        });
      }
      return result.polygon;
    });
  }

  // 5. / 6. Joint geometry.
  for (const link of links) {
    if (link.kind === "tab-slot") addTabsAndSlots(link);
    else if (link.kind === "finger") addFingers(link);
  }

  /**
   * Along-edge coordinate `s` of a panel point, measured on the shared 3D edge from topology
   * vertex `edge.a`. Both panels are isometric images of the solid's faces and any plane
   * shift is perpendicular to the edge, so `s` is the same physical position on both panels.
   */
  function toS(link: Link, e: PanelEdge, along: number): number {
    return e.va === link.edge.a ? along : link.length - along;
  }
  /** Inverse of `toS`; the mapping is its own inverse. */
  function fromS(link: Link, e: PanelEdge, s: number): number {
    return toS(link, e, s);
  }

  function offsetExtent(link: Link, panel: Panel, e: PanelEdge): [number, number] | null {
    if (e.collapsed) return null;
    const loop = panel.offsetLoops[e.loop]!;
    const a = loop[e.index]!;
    const b = loop[(e.index + 1) % loop.length]!;
    const sa = toS(link, e, dot2(sub2(a, e.pa), e.u));
    const sb = toS(link, e, dot2(sub2(b, e.pa), e.u));
    return [Math.min(sa, sb), Math.max(sa, sb)];
  }

  function addTabsAndSlots(link: Link): void {
    const { p: slotPanel, q: tabPanel, pe: slotEdge, qe: tabEdge } = link;
    const m = tabPanel.shift;
    const tabId = `${tabPanel.partId}.edge-${tabEdge.globalIndex}`;
    const position = midpoint(link.edge);
    const tabExtent = offsetExtent(link, tabPanel, tabEdge);
    if (!tabExtent) return;
    // Keep slots of neighbouring edges apart at the corners of the slot panel.
    const depth = m + t + Math.max(0, fit);
    const loopEdges = slotPanel.edges[slotEdge.loop]!;
    const web = Math.max(t / 2, 1);
    const startClear = cornerClearance(materialAngleAtStart(loopEdges, slotEdge.index), depth, web);
    const endClear = cornerClearance(
      materialAngleAtStart(loopEdges, (slotEdge.index + 1) % loopEdges.length),
      depth,
      web,
    );
    const c0 = toS(link, slotEdge, startClear);
    const c1 = toS(link, slotEdge, link.length - endClear);
    const lo = Math.max(tabExtent[0], Math.min(c0, c1));
    const hi = Math.min(tabExtent[1], Math.max(c0, c1));
    const usable = hi - lo;
    if (!(usable >= settings.minTabWidth - 1e-9)) {
      warnings.push({
        code: usable > 0 ? "narrow-tab" : "short-edge",
        severity: "warning",
        message:
          `No tab fits on this edge of "${tabPanel.name}": ${Math.max(0, usable).toFixed(1)} mm ` +
          `are usable, the smallest tab is ${settings.minTabWidth.toFixed(1)} mm. ` +
          `This joint cannot be reproduced accurately with ${what}.`,
        partId: tabPanel.partId,
        edgeId: tabId,
        connectionId: link.id,
        position,
      });
      return;
    }
    const width = Math.min(Math.max(settings.tabWidth, settings.minTabWidth), usable);
    const spacing = Math.max(0, settings.tabSpacing);
    const count = Math.max(1, Math.floor((usable + spacing + 1e-9) / (width + spacing)));
    const cell = usable / count;
    const tabPolys: Vec2[][] = [];
    const slotPolys: Vec2[][] = [];
    const openNotch = m - fit <= 1e-9;
    for (let i = 0; i < count; i++) {
      const s0 = lo + cell * (i + 0.5) - width / 2;
      const s1 = s0 + width;
      // Tab: from the compensated edge out to the outer surface of the slot panel, i.e. it
      // protrudes by the thickness of the slot panel.
      const ta = [fromS(link, tabEdge, s0), fromS(link, tabEdge, s1)].sort((x, y) => x - y);
      const tabFar = tabEdge.offset - t;
      tabEdge.splice.push({ a0: ta[0]!, a1: ta[1]!, dFar: tabFar });
      tabPolys.push(rectPolygon(tabEdge, ta[0]!, ta[1]!, tabEdge.offset, tabFar));
      // Slot: the tab's cross-section (width × thickness, at depth [m, m + t] from the slot
      // panel's edge) enlarged by `fitOffset` on all four sides:
      // slot length = tab width + 2·fit, slot height = t + 2·fit.
      const sa = [fromS(link, slotEdge, s0 - fit), fromS(link, slotEdge, s1 + fit)].sort(
        (x, y) => x - y,
      );
      const near = openNotch ? slotEdge.offset : m - fit;
      const far = m + t + fit;
      const polygon = rectPolygon(slotEdge, sa[0]!, sa[1]!, near, far);
      slotPolys.push(polygon);
      if (openNotch) {
        // The slot touches the outline: it becomes a notch in the outline path.
        slotEdge.splice.push({ a0: sa[0]!, a1: sa[1]!, dFar: far });
      } else {
        slotPanel.slotPaths.push({
          type: "cut",
          role: "slot",
          points: polygon,
          closed: true,
          connectionId: link.id,
        });
      }
    }
    tabPanel.joints.push({ kind: "tab", connectionId: link.id, edgeId: tabId, polygons: tabPolys });
    slotPanel.joints.push({ kind: "slot", connectionId: link.id, polygons: slotPolys });
  }

  /**
   * Finger joint (90° only). Both edges sit at their "butt" position; along the interval that
   * both panels cover, an odd number of equal cells is handed out alternately: the primary
   * panel gets cells 0, 2, 4, …, the other panel cells 1, 3, …. A finger protrudes from the
   * butt position to the through position (= thickness for a square corner), so the two
   * panels are exactly complementary.
   */
  function addFingers(link: Link): void {
    const { p, q, pe, qe, theta } = link;
    const pExtent = offsetExtent(link, p, pe);
    const qExtent = offsetExtent(link, q, qe);
    if (!pExtent || !qExtent) return;
    const lo = Math.max(pExtent[0], qExtent[0]);
    const hi = Math.min(pExtent[1], qExtent[1]);
    const usable = hi - lo;
    if (usable <= 1e-6) return;
    let count = Math.max(1, Math.round(usable / Math.max(settings.fingerWidth, 1e-6)));
    if (count % 2 === 0) count -= 1;
    if (count < 3) {
      count = usable >= 3 * t ? 3 : 1;
      if (count === 1) {
        warnings.push({
          code: "short-edge",
          severity: "info",
          message:
            `This edge is too short for finger joints in ${what}; ` +
            "one panel runs through instead.",
          connectionId: link.id,
          position: midpoint(link.edge),
        });
      }
    }
    const cell = usable / count;
    const sides: { panel: Panel; e: PanelEdge; other: Panel; parity: number }[] = [
      { panel: p, e: pe, other: q, parity: 0 },
      { panel: q, e: qe, other: p, parity: 1 },
    ];
    for (const side of sides) {
      const through = edgeCompensation("through", side.panel.shift, side.other.shift, t, theta);
      const add: Vec2[][] = [];
      for (let i = side.parity; i < count; i += 2) {
        const s0 = lo + cell * i;
        const s1 = s0 + cell;
        const a = [fromS(link, side.e, s0), fromS(link, side.e, s1)].sort((x, y) => x - y);
        side.e.splice.push({ a0: a[0]!, a1: a[1]!, dFar: through });
        add.push(rectPolygon(side.e, a[0]!, a[1]!, side.e.offset, through));
      }
      side.panel.joints.push({
        kind: "finger",
        connectionId: link.id,
        edgeId: `${side.panel.partId}.edge-${side.e.globalIndex}`,
        add,
        remove: [],
      });
    }
  }

  // 7. / 8. Compile parts.
  const edgeWarnings = boardEdgeIssues(body, material);
  const linkOfEdge = new Map<number, Link>();
  for (const link of links) linkOfEdge.set(link.edge.id, link);
  for (const issue of edgeWarnings) {
    warnings.push({ ...issue.warning, connectionId: linkOfEdge.get(issue.edge)?.id });
  }

  const kerf = settings.kerfCompensation ? material.kerf : 0;
  const parts: FlatPart[] = panels.map((panel) => compilePanel(panel, material, kerf));

  const roleNames: Record<LinkKind, [string, string]> = {
    "tab-slot": ["slot", "tab"],
    flat: ["through", "butt"],
    finger: ["finger", "finger"],
    touch: ["touch", "touch"],
  };
  const connections: EdgeConnection[] = links.map((link) => ({
    id: link.id,
    a: {
      partId: link.p.partId,
      edgeId: `${link.p.partId}.edge-${link.pe.globalIndex}`,
      role: roleNames[link.kind][0],
    },
    b: {
      partId: link.q.partId,
      edgeId: `${link.q.partId}.edge-${link.qe.globalIndex}`,
      role: roleNames[link.kind][1],
    },
    joint: link.kind === "touch" ? "flat" : link.kind,
    angle: radToDeg(link.theta),
    length: link.length,
    sourceEdge: link.edge.id,
  }));

  return {
    bodyId: body.id,
    material,
    strategyId: "laser.board",
    parts,
    connections,
    warnings: dedupeWarnings(warnings),
  };
}

function buildPanels(body: CadBody, topology: SolidTopology): Panel[] {
  const lookup = buildEdgeLookup(topology);
  const panels: Panel[] = [];
  for (const face of topology.faces) {
    if (face.surface !== "plane") continue; // Board cannot bend: see the `curved-face` warning.
    const outer = face.loops[0];
    if (!outer || outer.length < 3) continue;
    const plane = facePlane(topology, face);
    const loops = faceLoops2D(topology, face, plane);
    let globalIndex = 0;
    const edges = loops.map((loop, li) =>
      loop.map((pa, i): PanelEdge => {
        const ids = face.loops[li]!;
        const va = ids[i]!;
        const vb = ids[(i + 1) % ids.length]!;
        const pb = loop[(i + 1) % loop.length]!;
        const u = norm2(sub2(pb, pa));
        return {
          loop: li,
          index: i,
          globalIndex: globalIndex++,
          va,
          vb,
          pa,
          pb,
          u,
          v: perp2(u), // left of travel = material side, for outer loops and holes alike
          length: dist2(pa, pb),
          topoEdge: lookup.get(topoEdgeKey(va, vb)),
          offset: 0,
          collapsed: false,
          splice: [],
        };
      }),
    );
    panels.push({
      face,
      plane,
      loops,
      edges,
      area: loops.reduce((s, l) => s + signedArea(l), 0),
      isCap: false,
      shift: 0,
      partId: `${body.id}.panel-${face.id}`,
      name: `panel-${face.id}`,
      offsetLoops: loops,
      joints: [],
      slotPaths: [],
    });
  }
  return panels;
}

function buildLinks(
  body: CadBody,
  topology: SolidTopology,
  panels: readonly Panel[],
  panelOfFace: ReadonlyMap<number, Panel>,
): Link[] {
  const ends = new Map<number, { panel: Panel; e: PanelEdge }[]>();
  for (const panel of panels) {
    for (const loop of panel.edges) {
      for (const e of loop) {
        if (!e.topoEdge || e.topoEdge.faces.length !== 2) continue;
        const list = ends.get(e.topoEdge.id);
        if (list) list.push({ panel, e });
        else ends.set(e.topoEdge.id, [{ panel, e }]);
      }
    }
  }
  const links: Link[] = [];
  for (const edge of topology.edges) {
    const pair = ends.get(edge.id);
    if (!pair || pair.length !== 2) continue;
    const [x, y] = [pair[0]!, pair[1]!];
    if (x.panel === y.panel) continue;
    if (!edge.faces.every((f) => panelOfFace.has(f))) continue;
    const theta = edgeInteriorAngle(topology, edge);
    if (theta === null) continue;
    const link: Link = {
      id: `${body.id}.conn-${edge.id}`,
      edge,
      theta,
      length: x.e.length,
      kind: "flat",
      p: x.panel,
      q: y.panel,
      pe: x.e,
      qe: y.e,
    };
    x.e.link = link;
    y.e.link = link;
    links.push(link);
  }
  return links;
}

/**
 * Generic role rule (no shape names involved):
 *
 * 1. A face is a CAP CANDIDATE when every edge of its outer loop is a convex 90° edge (within
 *    `angleTolerance`) shared with another panel: all its neighbours stand square on it.
 * 2. The largest candidate (ties: lower face id) defines the dominant axis. Candidates are
 *    visited in the order: parallel to the dominant axis first, then larger area, then lower
 *    face id. A candidate becomes a cap unless it touches a panel that already is one.
 *    (For a cuboid, where every face is a candidate, this selects the largest face and the
 *    one opposite to it; for any prism it selects the two end faces.)
 *    The function returns the dominant axis (normal of the reference face).
 * 3. `settings.roles` overrides: "slot" forces a face to be a cap, "tab" forbids it.
 *
 * Caps are the slot / through panels and keep their designed outline.
 */
function chooseCaps(
  panels: readonly Panel[],
  links: readonly Link[],
  settings: BoardSettings,
): Vec3 {
  const tolerance = degToRad(settings.angleTolerance) + 1e-9;
  const roleOf = (panel: Panel): "slot" | "tab" | undefined => {
    const roles = settings.roles as Record<string, "slot" | "tab" | undefined> | undefined;
    return roles?.[String(panel.face.id)];
  };
  const neighbours = new Map<Panel, Set<Panel>>();
  for (const panel of panels) neighbours.set(panel, new Set());
  for (const link of links) {
    neighbours.get(link.p)?.add(link.q);
    neighbours.get(link.q)?.add(link.p);
  }
  for (const panel of panels) panel.isCap = roleOf(panel) === "slot";

  const candidates = panels.filter((panel) => {
    if (roleOf(panel) !== undefined) return false;
    const outer = panel.edges[0] ?? [];
    return (
      outer.length >= 3 &&
      outer.every((e) => e.link !== undefined && Math.abs(e.link.theta - Math.PI / 2) <= tolerance)
    );
  });
  const byArea = (a: Panel, b: Panel): number => b.area - a.area || a.face.id - b.face.id;
  if (candidates.length === 0) {
    // No caps: the dominant axis is the normal of the largest panel.
    return panels.slice().sort(byArea)[0]?.face.normal ?? { x: 0, y: 0, z: 1 };
  }
  const reference = candidates.slice().sort(byArea)[0]!;
  const parallel = (panel: Panel): number =>
    Math.abs(dot3(panel.face.normal, reference.face.normal)) > Math.cos(degToRad(1)) ? 0 : 1;
  const ordered = candidates.slice().sort((a, b) => parallel(a) - parallel(b) || byArea(a, b));
  for (const panel of ordered) {
    let free = true;
    for (const other of neighbours.get(panel) ?? []) if (other.isCap) free = false;
    if (free) panel.isCap = true;
  }
  return reference.face.normal;
}

/** Names derived from the role and the direction of the outward normal only. */
function namePanels(panels: readonly Panel[]): void {
  let caps = 0;
  let sides = 0;
  const names = panels.map((panel) => {
    const n = panel.face.normal;
    if (n.z > 0.999) return "top";
    if (n.z < -0.999) return "bottom";
    return panel.isCap ? `cap-${caps++}` : `side-${sides++}`;
  });
  uniqueNames(names).forEach((name, i) => {
    panels[i]!.name = name;
  });
}

function compilePanel(panel: Panel, material: MaterialProfile, kerf: number): FlatPart {
  const paths: FlatPath[] = [];
  const edges: PartEdge[] = [];
  panel.offsetLoops.forEach((loop, li) => {
    const loopEdges = panel.edges[li]!;
    const points: Vec2[] = [];
    loopEdges.forEach((e, i) => {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      edges.push({
        id: `${panel.partId}.edge-${e.globalIndex}`,
        index: e.globalIndex,
        loop: li,
        a,
        b,
        length: dist2(a, b),
        connectionId: e.link?.id,
        sourceEdge: e.topoEdge?.id,
      });
      // Walk the edge and splice the rectangles in, in order of travel. Every rectangle is
      // axis-aligned in the edge frame, so this is an exact union / difference.
      pushPoint(points, a);
      for (const rect of e.splice.slice().sort((x, y) => x.a0 - y.a0)) {
        pushPoint(points, localPoint(e, rect.a0, e.offset));
        pushPoint(points, localPoint(e, rect.a0, rect.dFar));
        pushPoint(points, localPoint(e, rect.a1, rect.dFar));
        pushPoint(points, localPoint(e, rect.a1, e.offset));
      }
    });
    paths.push({
      type: "cut",
      role: li === 0 ? "outline" : "hole",
      points: closeLoop(points),
      closed: true,
    });
  });
  paths.push(...panel.slotPaths);
  const finalPaths = kerf > 0 ? compensateKerf(paths, kerf) : paths;
  const outline = panel.offsetLoops[0] ?? [];
  return {
    id: panel.partId,
    name: panel.name,
    materialId: material.id,
    thickness: material.thickness,
    sourceFaces: [panel.face.id],
    outline,
    holes: panel.offsetLoops.slice(1),
    edges,
    joints: panel.joints,
    folds: [],
    paths: finalPaths,
    bounds: boundsOfPaths(finalPaths, outline),
    frame: {
      // The frame lies in the panel's OUTER surface, which is the solid's face moved inward
      // by the plane shift. 2D coordinates are those of the face, unchanged.
      origin: sub3(panel.plane.origin, scale3(panel.plane.normal, panel.shift)),
      xDir: panel.plane.xDir,
      yDir: panel.plane.yDir,
      normal: panel.plane.normal,
    },
  };
}

export const laserBoardStrategy: FabricationStrategy<BoardSettings> = {
  id: "laser.board",
  name: "Laser cut board (panels and joints)",
  process: "laser",
  supports: (material) => material.category === "board",
  defaultSettings: defaultBoardSettings,
  fabricate: fabricateBoard,
};
