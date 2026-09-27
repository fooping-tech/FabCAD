import {
  type FabricationLineType,
  type FlatPart,
  type NestingAlgorithm,
  type PlacedPath,
  type SheetGeometry,
  type SheetSpec,
  DEFAULT_SHEET,
  layoutParts,
  resolveSheetGeometry,
} from "@fabcad/fabrication-core";

/**
 * SVG export. Pure string building: no DOM, so it runs in Node, in the browser and in Workers.
 * The input is a `SheetGeometry` (see `resolveSheetGeometry`), which is already in sheet
 * coordinates (mm, origin top-left, Y down) — exactly SVG's coordinate system, so points are
 * written as they are.
 */
export interface SvgOptions {
  /** Index of the sheet to draw. Default 0. */
  sheet?: number;
  /** Stroke width in mm. Default 0.1. */
  strokeWidth?: number;
  colors?: Partial<Record<FabricationLineType, string>>;
  /** Draw part names into a separate `<g id="labels">`. Default false. */
  labels?: boolean;
  /** Decimals of the coordinates. Default 3. */
  precision?: number;
}

export const DEFAULT_SVG_COLORS: Record<FabricationLineType, string> = {
  cut: "#ff0000",
  fold: "#0000ff",
  engrave: "#000000",
};

const LINE_TYPES: FabricationLineType[] = ["cut", "fold", "engrave"];
const LABEL_COLOR = "#008000";

function formatNumber(value: number, precision: number): string {
  const text = value.toFixed(precision);
  if (!text.includes(".")) return text === "-0" ? "0" : text;
  const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `d` attribute of one placed path. */
export function pathData(path: Pick<PlacedPath, "points" | "closed">, precision = 3): string {
  const parts = path.points.map(
    (p, i) => `${i === 0 ? "M" : "L"}${formatNumber(p.x, precision)} ${formatNumber(p.y, precision)}`,
  );
  if (path.closed) parts.push("Z");
  return parts.join(" ");
}

export function renderSheetSvg(geometry: SheetGeometry, options: SvgOptions = {}): string {
  const sheetIndex = options.sheet ?? 0;
  const precision = options.precision ?? 3;
  const strokeWidth = options.strokeWidth ?? 0.1;
  const colors = { ...DEFAULT_SVG_COLORS, ...(options.colors ?? {}) };
  const { width, height } = geometry.sheet;
  const w = formatNumber(width, precision);
  const h = formatNumber(height, precision);
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
  );
  for (const type of LINE_TYPES) {
    const dash = type === "fold" ? ' stroke-dasharray="2 1"' : "";
    lines.push(
      `  <g id="${type}" fill="none" stroke="${escapeXml(colors[type])}" ` +
        `stroke-width="${formatNumber(strokeWidth, 4)}" stroke-linejoin="round"${dash}>`,
    );
    // One sub-group per part, in order of first appearance.
    const groups = new Map<string, PlacedPath[]>();
    for (const path of geometry.paths) {
      if (path.sheet !== sheetIndex || path.type !== type || path.points.length < 2) continue;
      const list = groups.get(path.partId);
      if (list) list.push(path);
      else groups.set(path.partId, [path]);
    }
    for (const [partId, paths] of groups) {
      lines.push(`    <g data-part="${escapeXml(partId)}">`);
      for (const path of paths) {
        lines.push(`      <path data-role="${path.role}" d="${pathData(path, precision)}"/>`);
      }
      lines.push("    </g>");
    }
    lines.push("  </g>");
  }
  if (options.labels) {
    lines.push(
      `  <g id="labels" fill="${LABEL_COLOR}" stroke="none" font-family="sans-serif" ` +
        'font-size="4" text-anchor="middle">',
    );
    for (const label of geometry.labels) {
      if (label.sheet !== sheetIndex) continue;
      lines.push(
        `    <text data-part="${escapeXml(label.partId)}" ` +
          `x="${formatNumber(label.position.x, precision)}" ` +
          `y="${formatNumber(label.position.y, precision)}">${escapeXml(label.text)}</text>`,
      );
    }
    lines.push("  </g>");
  }
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

export interface PartsSvgOptions extends SvgOptions {
  sheetSpec?: SheetSpec;
  algorithm?: NestingAlgorithm;
  allowRotation?: boolean;
}

/** Convenience: lay the parts out on a default sheet and draw the chosen sheet. */
export function renderPartsSvg(parts: FlatPart[], options: PartsSvgOptions = {}): string {
  const layout = layoutParts(parts, options.sheetSpec ?? DEFAULT_SHEET, options.algorithm ?? "row", {
    allowRotation: options.allowRotation,
  });
  return renderSheetSvg(resolveSheetGeometry(parts, layout, { labels: options.labels }), options);
}
export * from "./curves";
