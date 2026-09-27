import { describe, expect, it } from "vitest";
import { prismTopology } from "@fabcad/geometry";
import {
  type CadBody,
  DEFAULT_MATERIALS,
  type SheetGeometry,
  type SheetSpec,
  fabricate,
  layoutParts,
  resolveSheetGeometry,
} from "@fabcad/fabrication-core";
import { laserBoardStrategy, laserPaperStrategy } from "@fabcad/fabrication-laser";
import { pathData, renderPartsSvg, renderSheetSvg } from "../src";

const sheet: SheetSpec = { width: 300, height: 200, margin: 5, gap: 3 };
const box: CadBody = {
  id: "box",
  name: "Box",
  topology: prismTopology(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ],
    50,
  ),
};
const mdf = DEFAULT_MATERIALS.find((m) => m.id === "mdf-5.5")!;
const paper = DEFAULT_MATERIALS.find((m) => m.id === "paper-0.2")!;

const boardGeometry = (): SheetGeometry => {
  const parts = fabricate(box, mdf, laserBoardStrategy).parts;
  return resolveSheetGeometry(parts, layoutParts(parts, sheet, "shelf"));
};
const paperGeometry = (): SheetGeometry => {
  const parts = fabricate(box, paper, laserPaperStrategy).parts;
  return resolveSheetGeometry(parts, layoutParts(parts, { ...sheet, height: 300 }, "row"));
};

const pathsIn = (svg: string): string[] => [...svg.matchAll(/<path [^>]*d="([^"]*)"/g)].map((m) => m[1]!);
const group = (svg: string, id: string): string => {
  const start = svg.indexOf(`<g id="${id}"`);
  if (start < 0) return "";
  const next = svg.slice(start + 1).search(/\n {2}<g id="/);
  return next < 0 ? svg.slice(start) : svg.slice(start, start + 1 + next);
};
const coords = (d: string): { x: number; y: number }[] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe("renderSheetSvg", () => {
  it("writes a standalone SVG in millimetres", () => {
    const svg = renderSheetSvg(boardGeometry());
    expect(svg.startsWith(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200">',
    )).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('<g id="cut" fill="none" stroke="#ff0000" stroke-width="0.1"');
    expect(svg).toMatch(/<g id="fold" fill="none" stroke="#0000ff"[^>]*stroke-dasharray=/);
    expect(svg).toContain('<g id="engrave" fill="none" stroke="#000000"');
    expect(svg).not.toContain('id="labels"');
    expect(svg.indexOf('id="cut"')).toBeLessThan(svg.indexOf('id="fold"'));
    expect(svg.indexOf('id="fold"')).toBeLessThan(svg.indexOf('id="engrave"'));
  });

  it("draws exactly the paths of the sheet geometry (preview / export parity)", () => {
    for (const g of [boardGeometry(), paperGeometry()]) {
      for (let s = 0; s < g.sheetCount; s++) {
        const svg = renderSheetSvg(g, { sheet: s, precision: 6 });
        const onSheet = g.paths.filter((p) => p.sheet === s);
        expect(pathsIn(svg)).toHaveLength(onSheet.length);
        for (const type of ["cut", "fold", "engrave"] as const) {
          const expected = onSheet.filter((p) => p.type === type);
          const drawn = pathsIn(group(svg, type));
          expect(drawn).toHaveLength(expected.length);
          expect(drawn.slice().sort()).toEqual(expected.map((p) => pathData(p, 6)).sort());
        }
      }
    }
    const total = boardGeometry();
    let count = 0;
    for (let s = 0; s < total.sheetCount; s++) count += pathsIn(renderSheetSvg(total, { sheet: s })).length;
    expect(count).toBe(total.paths.length);
  });

  it("keeps every coordinate inside the sheet", () => {
    const g = boardGeometry();
    for (let s = 0; s < g.sheetCount; s++) {
      const all = pathsIn(renderSheetSvg(g, { sheet: s })).flatMap(coords);
      expect(all.length).toBeGreaterThan(0);
      for (const p of all) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(300);
        expect(p.y).toBeLessThanOrEqual(200);
      }
    }
  });

  it("separates cut, fold and engrave lines", () => {
    const svg = renderSheetSvg(paperGeometry());
    expect(svg).toContain('height="300mm"');
    expect(pathsIn(group(svg, "cut"))).toHaveLength(1);
    expect(pathsIn(group(svg, "fold"))).toHaveLength(12);
    expect(pathsIn(group(svg, "engrave"))).toHaveLength(0);
    for (const d of pathsIn(group(svg, "cut"))) expect(d.endsWith("Z")).toBe(true);
    for (const d of pathsIn(group(svg, "fold"))) expect(d).toMatch(/^M\S+ \S+ L\S+ \S+$/);
  });

  it("honours options", () => {
    const g = boardGeometry();
    const svg = renderSheetSvg(g, {
      strokeWidth: 0.25,
      colors: { cut: "#000000", engrave: "#00ff00" },
      labels: true,
      precision: 1,
    });
    expect(svg).toContain('<g id="cut" fill="none" stroke="#000000" stroke-width="0.25"');
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('stroke="#0000ff"');
    expect(svg).toContain('<g id="labels"');
    expect(svg).toContain(">top</text>");
    expect(svg).toContain('data-part="box.panel-0"');
    for (const d of pathsIn(svg)) expect(d).not.toMatch(/\.\d{2,}/);
    expect(pathsIn(renderSheetSvg(g, { sheet: 99 }))).toHaveLength(0);
  });

  it("formats paths", () => {
    expect(
      pathData({ points: [{ x: 1, y: 2.12345 }, { x: -0.00001, y: 3 }, { x: 4.5, y: 0 }], closed: true }),
    ).toBe("M1 2.123 L0 3 L4.5 0 Z");
    expect(pathData({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false })).toBe("M0 0 L10 0");
  });

  it("escapes names", () => {
    const g = boardGeometry();
    g.labels[0]!.text = 'a<b & "c"';
    expect(renderSheetSvg(g, { labels: true })).toContain("a&lt;b &amp; &quot;c&quot;");
  });
});

describe("renderPartsSvg", () => {
  it("lays parts out on a default sheet", () => {
    const parts = fabricate(box, mdf, laserBoardStrategy).parts;
    const svg = renderPartsSvg(parts);
    expect(svg).toContain('width="600mm" height="300mm" viewBox="0 0 600 300"');
    expect(pathsIn(svg)).toHaveLength(parts.reduce((s, p) => s + p.paths.length, 0));
    const custom = renderPartsSvg(parts, { sheetSpec: sheet, algorithm: "shelf", labels: true });
    expect(custom).toContain('width="300mm"');
    expect(custom).toContain('<g id="labels"');
  });
});
