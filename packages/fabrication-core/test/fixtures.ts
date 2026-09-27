import { type Vec2, boundsOfPoints } from "@fabcad/geometry";
import type { FlatPart, FlatPath } from "../src";

export const rect = (w: number, h: number, x = 0, y = 0): Vec2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export function makePart(id: string, outline: Vec2[], extra: FlatPath[] = []): FlatPart {
  const paths: FlatPath[] = [
    { type: "cut", role: "outline", points: outline, closed: true },
    ...extra,
  ];
  return {
    id,
    name: id,
    materialId: "mdf-5.5",
    thickness: 5.5,
    sourceFaces: [],
    outline,
    holes: [],
    edges: [],
    joints: [],
    folds: [],
    paths,
    bounds: boundsOfPoints(paths.flatMap((p) => p.points)),
  };
}
