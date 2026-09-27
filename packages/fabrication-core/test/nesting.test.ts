import { describe, expect, it } from "vitest";
import {
  type FlatPart,
  type NestingStrategy,
  type SheetLayout,
  type SheetSpec,
  getNestingStrategy,
  layoutParts,
  layoutPartsWith,
  listNestingStrategies,
  placedBounds,
  registerNestingStrategy,
  resolveSheetGeometry,
} from "../src";
import { makePart, rect } from "./fixtures";

const sheet: SheetSpec = { width: 300, height: 200, margin: 10, gap: 5 };

const boxes = (parts: FlatPart[], layout: SheetLayout) =>
  layout.placements.map((pl) => ({
    id: pl.partId,
    sheet: pl.sheet,
    rotation: pl.rotation,
    ...placedBounds(parts.find((p) => p.id === pl.partId)!, pl),
  }));

function expectValid(parts: FlatPart[], layout: SheetLayout): void {
  const b = boxes(parts, layout);
  for (const x of b) {
    expect(x.minX).toBeGreaterThanOrEqual(sheet.margin - 1e-9);
    expect(x.minY).toBeGreaterThanOrEqual(sheet.margin - 1e-9);
    expect(x.maxX).toBeLessThanOrEqual(sheet.width - sheet.margin + 1e-9);
    expect(x.maxY).toBeLessThanOrEqual(sheet.height - sheet.margin + 1e-9);
    expect(x.sheet).toBeLessThan(layout.sheetCount);
  }
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      const p = b[i]!;
      const q = b[j]!;
      if (p.sheet !== q.sheet) continue;
      const g = sheet.gap - 1e-9;
      const apart =
        p.maxX + g <= q.minX || q.maxX + g <= p.minX || p.maxY + g <= q.minY || q.maxY + g <= p.minY;
      expect(apart).toBe(true);
    }
  }
  expect(layout.placements.length + layout.unplaced.length).toBe(parts.length);
}

describe("nesting", () => {
  const parts = [
    makePart("a", rect(100, 40)),
    makePart("b", rect(100, 80)),
    makePart("c", rect(100, 30)),
    makePart("d", rect(60, 80)),
    makePart("e", rect(120, 20)),
  ];

  it("row: keeps the order and wraps", () => {
    const layout = layoutParts(parts, sheet, "row");
    expect(layout.algorithm).toBe("row");
    expect(layout.placements.map((p) => p.partId)).toEqual(["a", "b", "c", "d", "e"]);
    const b = boxes(parts, layout);
    expect(b[0]).toMatchObject({ minX: 10, minY: 10 });
    expect(b[1]).toMatchObject({ minX: 115, minY: 10 });
    // c does not fit into the first row (10 + 100 + 5 + 100 + 5 + 100 > 290)
    expect(b[2]).toMatchObject({ minX: 10, minY: 95 });
    expect(b[3]).toMatchObject({ minX: 115, minY: 95 });
    expect(layout.sheetCount).toBe(2);
    expect(b[4]).toMatchObject({ sheet: 1, minX: 10, minY: 10 });
    expectValid(parts, layout);
  });

  it("shelf: sorts by height and packs tighter than rows", () => {
    const layout = layoutParts(parts, sheet, "shelf");
    expect(layout.algorithm).toBe("shelf");
    expect(layout.placements.map((p) => p.partId)).toEqual(["b", "d", "a", "c", "e"]);
    expect(layout.sheetCount).toBe(1);
    expect(layout.placements.every((p) => p.rotation === 0)).toBe(true);
    expectValid(parts, layout);
  });

  it("uses more sheets when one is full", () => {
    const many = Array.from({ length: 9 }, (_, i) => makePart(`p${i}`, rect(130, 80)));
    for (const algorithm of ["row", "shelf"] as const) {
      const layout = layoutParts(many, sheet, algorithm);
      // two per row, two rows per sheet
      expect(layout.sheetCount).toBe(3);
      expect(layout.unplaced).toEqual([]);
      expectValid(many, layout);
    }
  });

  it("reports parts that are larger than the sheet", () => {
    const big = [makePart("big", rect(400, 50)), makePart("ok", rect(50, 50))];
    for (const algorithm of ["row", "shelf"] as const) {
      const layout = layoutParts(big, sheet, algorithm, { allowRotation: true });
      expect(layout.unplaced).toEqual(["big"]);
      expect(layout.warnings).toHaveLength(1);
      expect(layout.warnings[0]).toMatchObject({ code: "part-too-large", partId: "big" });
      expect(layout.placements.map((p) => p.partId)).toEqual(["ok"]);
    }
  });

  it("rotates parts by 90° only when allowed", () => {
    const tall = [makePart("tall", rect(40, 250))];
    expect(layoutParts(tall, sheet, "shelf").unplaced).toEqual(["tall"]);
    expect(layoutParts(tall, sheet, "row").unplaced).toEqual(["tall"]);
    for (const algorithm of ["row", "shelf"] as const) {
      const layout = layoutParts(tall, sheet, algorithm, { allowRotation: true });
      expect(layout.placements[0]?.rotation).toBe(90);
      const b = boxes(tall, layout)[0]!;
      expect(b.maxX - b.minX).toBeCloseTo(250, 9);
      expect(b.maxY - b.minY).toBeCloseTo(40, 9);
      expectValid(tall, layout);
    }
    const mixed = [
      makePart("a", rect(30, 100)),
      makePart("b", rect(30, 100)),
      makePart("c", rect(100, 30)),
    ];
    const layout = layoutParts(mixed, sheet, "shelf", { allowRotation: true });
    expect(layout.sheetCount).toBe(1);
    expectValid(mixed, layout);
  });

  it("uses the bounds of the final paths, not of the raw outline", () => {
    const part = makePart("tabbed", rect(50, 20));
    part.paths = [{ type: "cut", role: "outline", points: rect(60, 30, -5, -5), closed: true }];
    const layout = layoutParts([part, makePart("next", rect(10, 10))], sheet, "row");
    const b = boxes([part, makePart("next", rect(10, 10))], layout);
    expect(b[0]).toMatchObject({ minX: 10, minY: 10, maxX: 70, maxY: 40 });
    expect(b[1]!.minX).toBeCloseTo(75, 9);
  });

  it("is open for further strategies", () => {
    expect(listNestingStrategies().map((s) => s.id)).toEqual(expect.arrayContaining(["row", "shelf"]));
    expect(getNestingStrategy("shelf")?.id).toBe("shelf");
    const diagonal: NestingStrategy = {
      id: "diagonal",
      name: "Diagonal",
      pack: (items) => ({
        placements: items.map((item, i) => {
          const box = item.box(0);
          return { partId: item.partId, sheet: 0, x: i * 50 + box.originX, y: i * 50 + box.originY, rotation: 0 };
        }),
        unplaced: [],
      }),
    };
    registerNestingStrategy(diagonal);
    expect(getNestingStrategy("diagonal")).toBe(diagonal);
    const layout = layoutPartsWith(parts.slice(0, 2), sheet, diagonal);
    expect(boxes(parts, layout)[1]).toMatchObject({ minX: 50, minY: 50 });
  });
});

describe("sheet geometry", () => {
  // An asymmetric "L": the foot points to the right when seen from outside.
  const l = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 60 },
    { x: 0, y: 60 },
  ];
  const part = makePart("L", l, [
    { type: "fold", role: "fold", points: [{ x: 0, y: 10 }, { x: 10, y: 10 }], closed: false },
  ]);

  it("places parts without mirroring them", () => {
    const layout = layoutParts([part], sheet, "row");
    const g = resolveSheetGeometry([part], layout);
    expect(g.sheet).toBe(sheet);
    expect(g.paths).toHaveLength(2);
    const outline = g.paths[0]!;
    expect(outline).toMatchObject({ partId: "L", sheet: 0, type: "cut", role: "outline", closed: true });
    // Y up → Y down: the foot of the L (part y = 0) is at the BOTTOM of the sheet box and
    // still points to the right, exactly as the part looks in its own frame.
    expect(outline.points[0]).toEqual({ x: 10, y: 70 });
    expect(outline.points[1]).toEqual({ x: 50, y: 70 });
    expect(outline.points[5]).toEqual({ x: 10, y: 10 });
    // A mirror image would turn counter-clockwise into clockwise on screen. In a Y-down
    // frame a visually counter-clockwise polygon has NEGATIVE shoelace area.
    const area = outline.points.reduce((s, p, i) => {
      const q = outline.points[(i + 1) % outline.points.length]!;
      return s + p.x * q.y - q.x * p.y;
    }, 0);
    expect(area).toBeLessThan(0);
    expect(g.labels).toEqual([{ partId: "L", sheet: 0, text: "L", position: { x: 30, y: 40 } }]);
    expect(resolveSheetGeometry([part], layout, { labels: false }).labels).toEqual([]);
  });

  it("rotates counter-clockwise as seen on the sheet", () => {
    const layout: SheetLayout = {
      sheet,
      algorithm: "row",
      sheetCount: 1,
      placements: [{ partId: "L", sheet: 0, x: 100, y: 100, rotation: 90 }],
      unplaced: [],
      warnings: [],
    };
    const g = resolveSheetGeometry([part], layout);
    // part (40, 0) → rotated (0, 40) → sheet (100, 100 − 40): the foot now points up
    expect(g.paths[0]!.points[1]!.x).toBeCloseTo(100, 9);
    expect(g.paths[0]!.points[1]!.y).toBeCloseTo(60, 9);
    expect(g.paths[0]!.points[5]!.x).toBeCloseTo(40, 9);
    expect(g.paths[0]!.points[5]!.y).toBeCloseTo(100, 9);
  });

  it("does not change the parts", () => {
    const before = JSON.stringify(part);
    resolveSheetGeometry([part], layoutParts([part], sheet, "shelf", { allowRotation: true }));
    expect(JSON.stringify(part)).toBe(before);
  });
});
