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
import { renderSheetDxf } from "../src";

const sheet: SheetSpec = { width: 300, height: 300, margin: 5, gap: 3 };
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

/** Parse group code / value pairs. */
const pairs = (dxf: string): [number, string][] => {
  const lines = dxf.trimEnd().split("\n");
  expect(lines.length % 2).toBe(0);
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!]);
  return out;
};

describe("renderSheetDxf", () => {
  const simple: SheetGeometry = {
    sheet,
    sheetCount: 1,
    labels: [],
    paths: [
      {
        partId: "p",
        sheet: 0,
        type: "cut",
        role: "outline",
        closed: true,
        points: [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
          { x: 110, y: 70 },
        ],
      },
      { partId: "p", sheet: 0, type: "fold", role: "fold", closed: false, points: [{ x: 10, y: 20 }, { x: 10, y: 70 }] },
      { partId: "p", sheet: 0, type: "engrave", role: "label", closed: false, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 0 }] },
      { partId: "q", sheet: 1, type: "cut", role: "outline", closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 0 }] },
    ],
  };

  it("writes a well-formed R12 file in millimetres", () => {
    const dxf = renderSheetDxf(simple);
    const p = pairs(dxf);
    expect(p[0]).toEqual([0, "SECTION"]);
    expect(p[p.length - 1]).toEqual([0, "EOF"]);
    const sections = p.filter(([c], i) => c === 2 && p[i - 1]?.[1] === "SECTION").map(([, v]) => v);
    expect(sections).toEqual(["HEADER", "TABLES", "ENTITIES"]);
    expect(p.filter(([c, v]) => c === 0 && v === "SECTION")).toHaveLength(3);
    expect(p.filter(([c, v]) => c === 0 && v === "ENDSEC")).toHaveLength(3);
    const units = p.findIndex(([c, v]) => c === 9 && v === "$INSUNITS");
    expect(p[units + 1]).toEqual([70, "4"]);
    expect(dxf).toContain("AC1009");
    const layers = p
      .map(([c, v], i) => (c === 0 && v === "LAYER" ? [p[i + 1]![1], p[i + 3]![1]] : null))
      .filter((x) => x !== null);
    expect(layers).toEqual([
      ["CUT", "1"],
      ["FOLD", "5"],
      ["ENGRAVE", "3"],
    ]);
  });

  it("writes polylines and lines on layers, Y up", () => {
    const p = pairs(renderSheetDxf(simple));
    const entities = p.slice(p.findIndex(([c, v]) => c === 2 && v === "ENTITIES") + 1);
    const kinds = entities.filter(([c]) => c === 0).map(([, v]) => v);
    expect(kinds).toEqual([
      "POLYLINE", "VERTEX", "VERTEX", "VERTEX", "SEQEND",
      "LINE",
      "POLYLINE", "VERTEX", "VERTEX", "VERTEX", "SEQEND",
      "ENDSEC", "EOF",
    ]);
    expect(entities[1]).toEqual([8, "CUT"]);
    const closedFlag = entities.filter(([c]) => c === 70).map(([, v]) => v);
    expect(closedFlag).toEqual(["1", "0"]);
    const firstVertex = entities.findIndex(([c, v]) => c === 0 && v === "VERTEX");
    expect(entities.slice(firstVertex + 1, firstVertex + 5)).toEqual([
      [8, "CUT"],
      [10, "10.0000"],
      [20, "280.0000"], // 300 − 20
      [30, "0.0000"],
    ]);
    const line = entities.findIndex(([c, v]) => c === 0 && v === "LINE");
    expect(entities.slice(line + 1, line + 8)).toEqual([
      [8, "FOLD"],
      [10, "10.0000"],
      [20, "280.0000"],
      [30, "0.0000"],
      [11, "10.0000"],
      [21, "230.0000"],
      [31, "0.0000"],
    ]);
  });

  it("selects the sheet", () => {
    const p = pairs(renderSheetDxf(simple, { sheet: 1 }));
    expect(p.filter(([c, v]) => c === 0 && v === "POLYLINE")).toHaveLength(1);
    expect(p.filter(([c, v]) => c === 0 && v === "LINE")).toHaveLength(0);
  });

  it("exports real fabrication results with as many entities as the preview has paths", () => {
    const mdf = DEFAULT_MATERIALS.find((m) => m.id === "mdf-5.5")!;
    const paper = DEFAULT_MATERIALS.find((m) => m.id === "paper-0.2")!;
    for (const parts of [
      fabricate(box, mdf, laserBoardStrategy).parts,
      fabricate(box, paper, laserPaperStrategy).parts,
    ]) {
      const g = resolveSheetGeometry(parts, layoutParts(parts, sheet, "shelf"));
      let entities = 0;
      for (let s = 0; s < g.sheetCount; s++) {
        const p = pairs(renderSheetDxf(g, { sheet: s }));
        entities += p.filter(([c, v]) => c === 0 && (v === "POLYLINE" || v === "LINE")).length;
        for (const [c, v] of p) {
          if (c === 10 || c === 20 || c === 11 || c === 21) {
            expect(Number(v)).toBeGreaterThanOrEqual(0);
            expect(Number(v)).toBeLessThanOrEqual(300);
          }
        }
      }
      expect(entities).toBe(g.paths.length);
      expect(g.paths.length).toBe(parts.reduce((s, p) => s + p.paths.length, 0));
    }
  });
});
