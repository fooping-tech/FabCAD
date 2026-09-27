import type { FabricationLineType, SheetGeometry } from "@fabcad/fabrication-core";

/**
 * Minimal ASCII DXF export (R12 compatible: HEADER, TABLES, ENTITIES with POLYLINE / LINE).
 * Pure string building, no DOM or Node APIs.
 *
 * Coordinates: `SheetGeometry` is Y-down with the origin at the top-left corner of the sheet.
 * DXF is Y-up, so every point is written as (x, sheet.height − y): the origin becomes the
 * bottom-left corner of the sheet and the drawing looks the same as the preview (not mirrored).
 */
export interface DxfOptions {
  /** Index of the sheet to export. Default 0. */
  sheet?: number;
  /** Decimals of the coordinates. Default 4. */
  precision?: number;
}

export const DXF_LAYERS: Record<FabricationLineType, { name: string; color: number; linetype: string }> = {
  cut: { name: "CUT", color: 1, linetype: "CONTINUOUS" }, // red
  fold: { name: "FOLD", color: 5, linetype: "DASHED" }, // blue
  engrave: { name: "ENGRAVE", color: 3, linetype: "CONTINUOUS" }, // green
};

export function renderSheetDxf(geometry: SheetGeometry, options: DxfOptions = {}): string {
  const sheetIndex = options.sheet ?? 0;
  const precision = options.precision ?? 4;
  const { width, height } = geometry.sheet;
  const out: string[] = [];
  const pair = (code: number, value: string | number): void => {
    out.push(String(code), typeof value === "number" ? String(value) : value);
  };
  const num = (value: number): string => {
    const text = value.toFixed(precision);
    return Number(text) === 0 ? (0).toFixed(precision) : text;
  };
  const flipY = (y: number): number => height - y;

  // HEADER
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1009");
  pair(9, "$INSUNITS");
  pair(70, 4); // millimetres
  pair(9, "$EXTMIN");
  pair(10, num(0));
  pair(20, num(0));
  pair(30, num(0));
  pair(9, "$EXTMAX");
  pair(10, num(width));
  pair(20, num(height));
  pair(30, num(0));
  pair(0, "ENDSEC");

  // TABLES
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LTYPE");
  pair(70, 2);
  pair(0, "LTYPE");
  pair(2, "CONTINUOUS");
  pair(70, 0);
  pair(3, "Solid line");
  pair(72, 65);
  pair(73, 0);
  pair(40, num(0));
  pair(0, "LTYPE");
  pair(2, "DASHED");
  pair(70, 0);
  pair(3, "Dashed __ __ __");
  pair(72, 65);
  pair(73, 2);
  pair(40, num(3));
  pair(49, num(2));
  pair(49, num(-1));
  pair(0, "ENDTAB");
  pair(0, "TABLE");
  pair(2, "LAYER");
  const layers = Object.values(DXF_LAYERS);
  pair(70, layers.length);
  for (const layer of layers) {
    pair(0, "LAYER");
    pair(2, layer.name);
    pair(70, 0);
    pair(62, layer.color);
    pair(6, layer.linetype);
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  // ENTITIES
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  for (const path of geometry.paths) {
    if (path.sheet !== sheetIndex || path.points.length < 2) continue;
    const layer = DXF_LAYERS[path.type].name;
    if (path.points.length === 2 && !path.closed) {
      const [a, b] = [path.points[0]!, path.points[1]!];
      pair(0, "LINE");
      pair(8, layer);
      pair(10, num(a.x));
      pair(20, num(flipY(a.y)));
      pair(30, num(0));
      pair(11, num(b.x));
      pair(21, num(flipY(b.y)));
      pair(31, num(0));
      continue;
    }
    pair(0, "POLYLINE");
    pair(8, layer);
    pair(66, 1);
    pair(10, num(0));
    pair(20, num(0));
    pair(30, num(0));
    pair(70, path.closed ? 1 : 0);
    for (const p of path.points) {
      pair(0, "VERTEX");
      pair(8, layer);
      pair(10, num(p.x));
      pair(20, num(flipY(p.y)));
      pair(30, num(0));
    }
    pair(0, "SEQEND");
    pair(8, layer);
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${out.join("\n")}\n`;
}
export * from "./curves";
