import {
  type Vec2,
  buildEdgeLookup,
  dist2,
  faceLoops2D,
  facePlane,
  topoEdgeKey,
} from "@fabcad/geometry";
import {
  type CadBody,
  type FabricationWarning,
  type FlatPart,
  type FlatPath,
  type MaterialProfile,
  type PartEdge,
  compensateKerf,
} from "@fabcad/fabrication-core";
import type { FlatPartInfo } from "./boardClassifier";
import type { BoardSettings } from "./boardSettings";
import { boundsOfPaths } from "./shared";

/**
 * Flat part compiler: the body is the sheet itself.
 *
 *   major face → outline + holes → Kerf Compensation → one Flat Part
 *
 * PRECONDITION: `classifyBoardBody` found the two major faces (`info`). The part is the major
 * face as it is: no panels, no joints, no connections, no fit offset.
 */
export interface FlatPartOutput {
  parts: FlatPart[];
  warnings: FabricationWarning[];
}

export function compileFlatPart(
  body: CadBody,
  material: MaterialProfile,
  settings: Pick<BoardSettings, "kerfCompensation">,
  info: FlatPartInfo,
): FlatPartOutput {
  const { topology } = body;
  const face = topology.faces[info.face];
  if (!face) throw new Error(`Body "${body.name}" has no face ${info.face}.`);
  const plane = facePlane(topology, face);
  // Outer loop counter-clockwise, holes clockwise: the material is on the left of travel.
  const loops = faceLoops2D(topology, face, plane);
  const lookup = buildEdgeLookup(topology);
  const partId = `${body.id}.flat`;

  const edges: PartEdge[] = [];
  const paths: FlatPath[] = [];
  let index = 0;
  loops.forEach((loop, li) => {
    const ids = face.loops[li]!;
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      edges.push({
        id: `${partId}.edge-${index}`,
        index,
        loop: li,
        a,
        b,
        length: dist2(a, b),
        sourceEdge: lookup.get(topoEdgeKey(ids[i]!, ids[(i + 1) % ids.length]!))?.id,
      });
      index++;
    });
    paths.push({
      type: "cut",
      role: li === 0 ? "outline" : "hole",
      points: loop.map((p): Vec2 => ({ x: p.x, y: p.y })),
      closed: true,
    });
  });

  const kerf = settings.kerfCompensation ? material.kerf : 0;
  const finalPaths = kerf > 0 ? compensateKerf(paths, kerf) : paths;
  const outline = loops[0] ?? [];
  const part: FlatPart = {
    id: partId,
    name: "part",
    materialId: material.id,
    thickness: material.thickness,
    sourceFaces: [info.face, info.opposite],
    outline,
    holes: loops.slice(1),
    edges,
    joints: [],
    folds: [],
    paths: finalPaths,
    bounds: boundsOfPaths(finalPaths, outline),
    frame: {
      origin: plane.origin,
      xDir: plane.xDir,
      yDir: plane.yDir,
      normal: plane.normal,
    },
  };
  return { parts: [part], warnings: [] };
}
