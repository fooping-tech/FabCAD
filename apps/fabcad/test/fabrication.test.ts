import type { Vec2 } from "@fabcad/geometry";
import { prismTopology } from "@fabcad/geometry";
import type { CadBody } from "@fabcad/fabrication-core";
import { renderSheetDxf } from "@fabcad/dxf";
import { renderSheetSvg } from "@fabcad/svg";
import { describe, expect, it } from "vitest";
import { formatNumber, parseNumberInput } from "../src/fabrication/numberInput";
import { describeParts, hitPartBox, partBounds, placedPartBoxes } from "../src/fabrication/partView";
import {
  buildSheetFiles,
  compileFabrication,
  fabricationStats,
  noPartsMessage,
  usedSheets,
} from "../src/fabrication/pipeline";
import {
  type LaserFabricationSettings,
  DEFAULT_MATERIAL_ID,
  FABRICATION_EXTENSION_KEY,
  allMaterials,
  chooseBodies,
  currentMaterial,
  defaultFabricationSettings,
  materialOrigin,
  newMaterialId,
  normalizeFabricationSettings,
  readFabricationSettings,
  resolveBoardSettings,
  resolvePaperSettings,
  toggleBody,
  withMaterial,
  withoutMaterial,
} from "../src/fabrication/settingsModel";

const rectangle = (w: number, h: number): Vec2[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const starPolygon = (points: number, outer: number, inner: number): Vec2[] =>
  Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (Math.PI * i) / points;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });

const body = (id: string, polygon: Vec2[], height: number): CadBody => ({
  id,
  name: id,
  topology: prismTopology(polygon, height),
});

/** A star prism 40 mm tall: not something rigid board can be folded or joined into. */
const starBody = (id = "star"): CadBody => body(id, starPolygon(5, 60, 25), 40);
/** The same star as a sheet of the thickness of the default material (MDF 5.5 mm). */
const starSheet = (id = "star"): CadBody => body(id, starPolygon(5, 60, 25), 5.5);
const boxBody = (id = "box"): CadBody => body(id, rectangle(100, 80), 50);

const settings = (patch: Partial<LaserFabricationSettings> = {}): LaserFabricationSettings => ({
  ...defaultFabricationSettings(),
  ...patch,
});

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("fabrication settings", () => {
  it("defaults to MDF 5.5 mm", () => {
    const s = readFabricationSettings({ extensions: {} });
    expect(s).toEqual(defaultFabricationSettings());
    expect(s.materialId).toBe(DEFAULT_MATERIAL_ID);
    expect(currentMaterial(s)).toMatchObject({ id: "mdf-5.5", thickness: 5.5, category: "board" });
  });

  it("survives garbage input", () => {
    for (const garbage of [null, undefined, 42, "text", [], [1, 2], { version: 99 }, { sheet: "x" }]) {
      const s = readFabricationSettings({ extensions: { [FABRICATION_EXTENSION_KEY]: garbage } });
      expect(s).toEqual(defaultFabricationSettings());
    }
    const s = normalizeFabricationSettings({
      materialId: "does-not-exist",
      customMaterials: [
        null,
        { id: "x", name: "No thickness", category: "board" },
        { id: "bad-cat", name: "Bad", category: "metal", thickness: 2 },
        { id: "nan", name: "NaN", category: "board", thickness: Number.NaN },
        { id: "ply-3", name: "Plywood 3 mm", category: "board", thickness: 3, kerf: -1, fitOffset: "a" },
        { id: "ply-3", name: "Duplicate", category: "board", thickness: 4 },
      ],
      bodyIds: ["a", 5, "a", null, "b"],
      board: { capJoint: "welded", tabWidth: -3, tabSpacing: Number.NaN, fingerWidth: 7, slotEdgeMargin: 0 },
      paper: { glueTabs: { enabled: "yes", width: 0, angle: 120, inset: 2 }, foldCurvedFacets: 1 },
      sheet: { width: -10, height: Infinity, margin: "1", gap: Number.NaN },
      nesting: "magic",
      allowRotation: "true",
      exportLabels: 1,
    });
    expect(s.materialId).toBe(DEFAULT_MATERIAL_ID);
    expect(s.customMaterials).toEqual([
      { id: "ply-3", name: "Plywood 3 mm", category: "board", thickness: 3, kerf: 0, fitOffset: 0 },
    ]);
    expect(s.bodyIds).toEqual(["a", "b"]);
    expect(s.board).toEqual({ fingerWidth: 7, slotEdgeMargin: 0 });
    expect(s.paper).toEqual({ glueTabs: { inset: 2 } });
    expect(s.sheet).toEqual({ width: 600, height: 300, margin: 5, gap: 3 });
    expect(s.nesting).toBe("row");
    expect(s.allowRotation).toBe(false);
    expect(s.exportLabels).toBe(false);
    expect(JSON.stringify(s)).not.toContain("null,");
    expect(JSON.stringify(s)).not.toContain("NaN");
  });

  it("round trips valid settings through JSON", () => {
    const original = settings({
      materialId: "paper-0.2",
      customMaterials: [
        { id: "mdf-4", name: "MDF 4 mm", category: "board", thickness: 3.8, kerf: 0.2, fitOffset: 0 },
        { id: "custom-ply", name: "Ply", category: "board", thickness: 3, kerf: 0.1, fitOffset: -0.05 },
      ],
      bodyIds: ["body-1"],
      board: { capJoint: "finger", sideJoint: "finger", tabWidth: 12, kerfCompensation: false },
      paper: { glueTabs: { enabled: false, width: 6, angle: 0 }, foldCurvedFacets: false },
      sheet: { width: 900, height: 600, margin: 10, gap: 2 },
      nesting: "shelf",
      allowRotation: true,
      exportLabels: true,
    });
    const stored: unknown = JSON.parse(JSON.stringify(original));
    const read = readFabricationSettings({ extensions: { [FABRICATION_EXTENSION_KEY]: stored } });
    expect(read).toEqual(original);
    expect(normalizeFabricationSettings(read)).toEqual(read);
  });

  it("drops a margin that leaves no usable area", () => {
    expect(normalizeFabricationSettings({ sheet: { width: 100, height: 50, margin: 25 } }).sheet).toEqual({
      width: 100,
      height: 50,
      margin: 0,
      gap: 3,
    });
  });

  it("manages edited presets and custom materials", () => {
    let s = settings();
    const base = currentMaterial(s);
    s = { ...s, ...withMaterial(s, { ...base, thickness: 6 }) };
    expect(materialOrigin(s, "mdf-5.5")).toBe("edited");
    expect(currentMaterial(s).thickness).toBe(6);
    expect(allMaterials(s).filter((m) => m.id === "mdf-5.5")).toHaveLength(1);
    s = { ...s, ...withMaterial(s, { ...currentMaterial(s), kerf: 0.3 }) };
    expect(s.customMaterials).toHaveLength(1);
    s = { ...s, ...withoutMaterial(s, "mdf-5.5") };
    expect(materialOrigin(s, "mdf-5.5")).toBe("preset");
    expect(currentMaterial(s).thickness).toBe(5.5);

    const id = newMaterialId(s, "Plywood 3 mm");
    expect(id).toBe("custom-plywood-3-mm");
    s = {
      ...s,
      ...withMaterial(s, { id, name: "Plywood 3 mm", category: "board", thickness: 3, kerf: 0.1, fitOffset: 0 }),
      materialId: id,
    };
    expect(newMaterialId(s, "Plywood 3 mm")).toBe("custom-plywood-3-mm-2");
    expect(materialOrigin(s, id)).toBe("custom");
    expect(currentMaterial(s).id).toBe(id);
    s = { ...s, ...withoutMaterial(s, id) };
    expect(s.materialId).toBe(DEFAULT_MATERIAL_ID);
    expect(normalizeFabricationSettings(s)).toEqual(s);
  });

  it("resolves strategy settings from defaults and overrides", () => {
    const material = currentMaterial(settings());
    expect(resolveBoardSettings(material, {})).toMatchObject({ capJoint: "tab-slot", tabWidth: 16.5 });
    expect(resolveBoardSettings(material, { tabWidth: 10 }).tabWidth).toBe(10);
    const paper = resolvePaperSettings(material, { glueTabs: { width: 5 } });
    expect(paper.glueTabs).toEqual({ enabled: true, width: 5, angle: 30, inset: 0 });
  });

  it("chooses bodies", () => {
    const record = (id: string, visible: boolean) => ({
      id,
      name: id.toUpperCase(),
      componentId: "root",
      visible,
      createdBy: "f",
    });
    const doc = { bodies: { a: record("a", true), b: record("b", false), c: record("c", true) } };
    const all = chooseBodies(doc, { bodyIds: null });
    expect(all.map((b) => b.included)).toEqual([true, false, true]);
    expect(toggleBody(all, "a", false)).toEqual(["c"]);
    expect(toggleBody(all, "b", true)).toEqual(["a", "b", "c"]);
    const some = chooseBodies(doc, { bodyIds: ["c", "gone"] });
    expect(some.map((b) => b.included)).toEqual([false, false, true]);
    expect(toggleBody(some, "a", true)).toBeNull();
  });
});

describe("number input", () => {
  it("parses and validates", () => {
    expect(parseNumberInput("5.5")).toEqual({ ok: true, value: 5.5 });
    expect(parseNumberInput(" 0,2 ")).toEqual({ ok: true, value: 0.2 });
    expect(parseNumberInput("", { allowEmpty: true })).toEqual({ ok: true, value: undefined });
    expect(parseNumberInput("").ok).toBe(false);
    expect(parseNumberInput("abc").ok).toBe(false);
    expect(parseNumberInput("1e400").ok).toBe(false);
    expect(parseNumberInput("NaN").ok).toBe(false);
    expect(parseNumberInput("Infinity").ok).toBe(false);
    expect(parseNumberInput("0", { min: 0, exclusiveMin: true }).ok).toBe(false);
    expect(parseNumberInput("0", { min: 0 }).ok).toBe(true);
    expect(parseNumberInput("-1", { min: 0 }).ok).toBe(false);
    expect(parseNumberInput("11", { max: 10 }).ok).toBe(false);
    expect(formatNumber(16.500000001)).toBe("16.5");
    expect(formatNumber(-0.00001)).toBe("0");
  });
});

describe("compileFabrication", () => {
  it("scenario B: box in MDF 5.5", () => {
    const out = compileFabrication([boxBody()], settings());
    expect(out.material.id).toBe("mdf-5.5");
    expect(out.strategyId).toBe("laser.board");
    expect(out.parts).toHaveLength(6);
    expect(out.results).toHaveLength(1);
    expect(out.detections).toEqual([
      expect.objectContaining({ bodyId: "box", kind: "rectangular-box", supported: true, parts: 6 }),
    ]);
    expect(out.connections.some((c) => c.joint === "tab-slot")).toBe(true);
    expect(out.warnings.every((w) => w.severity !== "error" || w.code === "part-too-large")).toBe(true);
    expect(out.layout.placements.length + out.layout.unplaced.length).toBe(6);

    const files = buildSheetFiles("svg", out, "box", false);
    expect(files.length).toBe(usedSheets(out).length);
    expect(files.length).toBeGreaterThan(0);
    const svg = files[0]!.data;
    expect(svg).toMatch(/width="600mm"/);
    expect(svg).toMatch(/height="300mm"/);
    expect(svg).toContain('<g id="cut"');
    expect(svg).not.toContain('<g id="labels"');
    expect(files[0]!.fileName).toBe(files.length > 1 ? "box-sheet-1.svg" : "box.svg");

    const stats = fabricationStats(out);
    expect(stats.parts).toBe(6);
    expect(stats.cutLength).toBeGreaterThan(1000);
    expect(Number.isFinite(stats.cutLength)).toBe(true);
  });

  it("a sheet of the thickness of the material is one flat part", () => {
    const out = compileFabrication([starSheet()], settings());
    expect(out.detections).toEqual([
      expect.objectContaining({ kind: "flat-part", label: "Flat Part", supported: true, parts: 1 }),
    ]);
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0]!.outline).toHaveLength(10);
    expect(out.parts[0]!.joints).toHaveLength(0);
    expect(out.connections).toHaveLength(0);
    expect(usedSheets(out)).toHaveLength(1);
    expect(out.layout.placements).toHaveLength(1);
  });

  it("says why there is nothing to export", () => {
    // A 5 mm plate when the material is 5.5 mm thick.
    const out = compileFabrication([body("Body001", rectangle(60, 40), 5)], settings());
    expect(out.parts).toHaveLength(0);
    const message = noPartsMessage(out);
    expect(message).toMatch(/^There are no parts to export\. Body001: /);
    expect(message).not.toContain("Design a body first");
    expect(noPartsMessage(compileFabrication([], settings()))).toBe(
      "There are no parts to export. Design a body first.",
    );
  });

  it("stops at a body that board cannot be made into, with the reason", () => {
    const out = compileFabrication([starBody()], settings());
    expect(out.strategyId).toBe("laser.board");
    expect(out.parts).toHaveLength(0);
    expect(out.connections).toHaveLength(0);
    expect(out.detections).toHaveLength(1);
    const detected = out.detections[0]!;
    expect(detected).toMatchObject({ bodyId: "star", kind: "unsupported", supported: false, parts: 0 });
    expect(detected.reason ?? "").not.toBe("");
    const error = out.warnings.find((w) => w.code === "unsupported-board-shape");
    expect(error?.severity).toBe("error");
    expect(error?.message).toMatch(/flat sheet parts/);
    expect(error?.message).toMatch(/rectangular boxes/);
    // Nothing reaches a sheet: no placements, no paths, no files.
    expect(out.layout.placements).toHaveLength(0);
    expect(out.geometry.paths).toHaveLength(0);
    expect(usedSheets(out)).toHaveLength(0);
    expect(buildSheetFiles("svg", out, "star", false)).toHaveLength(0);
  });

  it("fabricates the supported bodies when another one is not", () => {
    const out = compileFabrication([boxBody("a"), starBody("b"), starSheet("c")], settings());
    expect(out.detections.map((d) => [d.bodyId, d.kind, d.parts])).toEqual([
      ["a", "rectangular-box", 6],
      ["b", "unsupported", 0],
      ["c", "flat-part", 1],
    ]);
    expect(out.parts).toHaveLength(7);
    expect(out.parts.some((p) => p.id.startsWith("b."))).toBe(false);
  });

  it("scenario C: box in paper", () => {
    const out = compileFabrication([boxBody()], settings({ materialId: "paper-0.2" }));
    expect(out.strategyId).toBe("laser.paper");
    expect(out.parts).toHaveLength(1);
    const net = out.parts[0]!;
    expect(net.paths.some((p) => p.type === "fold")).toBe(true);
    expect(net.paths.some((p) => p.role === "glue-tab") || net.joints.some((j) => j.kind === "glue-tab")).toBe(true);
    expect(out.connections.some((c) => c.joint === "fold")).toBe(true);
    expect(out.connections.some((c) => c.joint === "glue-tab")).toBe(true);

    const svg = renderSheetSvg(out.geometry, { sheet: 0 });
    const fold = /<g id="fold"[^>]*>([\s\S]*?)\n {2}<\/g>/.exec(svg);
    expect(fold).not.toBeNull();
    expect(count(fold![1]!, "<path")).toBeGreaterThanOrEqual(5);

    const noTabs = compileFabrication(
      [boxBody()],
      settings({ materialId: "paper-0.2", paper: { glueTabs: { enabled: false } } }),
    );
    const tabPaths = (o: typeof out): number =>
      o.parts.reduce((n, p) => n + p.joints.filter((j) => j.kind === "glue-tab").length, 0);
    expect(tabPaths(noTabs)).toBe(0);
    expect(tabPaths(out)).toBeGreaterThan(0);
  });

  it("keeps part ids unique across bodies", () => {
    const out = compileFabrication([boxBody("body-1"), boxBody("body-2"), starSheet("body-3")], settings());
    expect(out.results).toHaveLength(3);
    expect(out.parts).toHaveLength(6 + 6 + 1);
    const ids = out.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(out.connections.map((c) => c.id)).size).toBe(out.connections.length);
    const names = out.parts.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const known = new Set(ids);
    for (const c of out.connections) {
      expect(known.has(c.a.partId)).toBe(true);
      expect(known.has(c.b.partId)).toBe(true);
    }
    // The same body twice is compiled once.
    const twice = compileFabrication([boxBody("same"), boxBody("same")], settings());
    expect(twice.parts).toHaveLength(6);
  });

  it("uses the edited material", () => {
    const base = compileFabrication([boxBody()], settings());
    const s = settings();
    const thick = compileFabrication(
      [boxBody()],
      { ...s, ...withMaterial(s, { ...currentMaterial(s), thickness: 9 }) },
    );
    expect(thick.material.thickness).toBe(9);
    expect(thick.parts.every((p) => p.thickness === 9)).toBe(true);
    const sizes = (o: typeof base): string =>
      o.parts
        .map((p) => {
          const b = partBounds(p);
          return `${(b.maxX - b.minX).toFixed(2)}x${(b.maxY - b.minY).toFixed(2)}`;
        })
        .join(" ");
    expect(sizes(thick)).not.toBe(sizes(base));
  });

  it("applies strategy overrides", () => {
    const flat = compileFabrication([boxBody()], settings({ board: { capJoint: "flat" } }));
    expect(flat.connections.some((c) => c.joint === "tab-slot")).toBe(false);
    const finger = compileFabrication(
      [boxBody()],
      settings({ board: { capJoint: "finger", sideJoint: "finger" } }),
    );
    expect(finger.connections.some((c) => c.joint === "finger")).toBe(true);
  });

  it("draws preview and export from the same geometry", () => {
    const out = compileFabrication(
      [boxBody(), starSheet()],
      settings({ allowRotation: true, nesting: "shelf" }),
    );
    expect(usedSheets(out).length).toBeGreaterThan(0);
    for (const sheet of usedSheets(out)) {
      const onSheet = out.geometry.paths.filter((p) => p.sheet === sheet && p.points.length >= 2);
      const preview = renderSheetSvg(out.geometry, { sheet, labels: true });
      const exported = renderSheetSvg(out.geometry, { sheet, labels: false });
      expect(count(preview, "<path")).toBe(onSheet.length);
      expect(count(exported, "<path")).toBe(onSheet.length);
      // Identical apart from the label group.
      expect(preview.replace(/ {2}<g id="labels"[\s\S]*?\n {2}<\/g>\n/, "")).toBe(exported);
      const dxf = renderSheetDxf(out.geometry, { sheet });
      expect(dxf).toContain("CUT");
      expect(dxf.length).toBeGreaterThan(100);
    }
    const files = buildSheetFiles("dxf", out, "star", true);
    expect(files.every((f) => f.fileName.endsWith(".dxf"))).toBe(true);
    // Every placed part has a box inside the sheet, and the box can be hit.
    const boxes = placedPartBoxes(out.geometry);
    expect(boxes).toHaveLength(out.layout.placements.length);
    for (const box of boxes) {
      expect(box.bounds.minX).toBeGreaterThanOrEqual(0);
      expect(box.bounds.maxX).toBeLessThanOrEqual(out.geometry.sheet.width);
      const cx = (box.bounds.minX + box.bounds.maxX) / 2;
      const cy = (box.bounds.minY + box.bounds.maxY) / 2;
      expect(hitPartBox(boxes, box.sheet, cx, cy)).not.toBeNull();
    }
  });

  it("numbers the files of several sheets", () => {
    const out = compileFabrication(
      [boxBody()],
      settings({ sheet: { width: 200, height: 150, margin: 5, gap: 3 } }),
    );
    const sheets = usedSheets(out);
    expect(sheets.length).toBeGreaterThan(1);
    const files = buildSheetFiles("svg", out, "box", true);
    expect(files.map((f) => f.fileName)).toEqual(sheets.map((_, i) => `box-sheet-${i + 1}.svg`));
    expect(files[0]!.data).toContain('<g id="labels"');
    expect(files[0]!.data).toMatch(/width="200mm"/);
  });

  it("reports parts that do not fit instead of throwing", () => {
    const out = compileFabrication(
      [boxBody()],
      settings({ sheet: { width: 40, height: 40, margin: 0, gap: 0 } }),
    );
    expect(out.parts).toHaveLength(6);
    expect(out.layout.unplaced.length).toBeGreaterThan(0);
    expect(out.warnings.some((w) => w.code === "part-too-large" && w.severity === "error")).toBe(true);
  });

  it("never throws on broken input", () => {
    const broken: CadBody = {
      id: "broken",
      name: "Broken",
      topology: {
        vertices: [{ x: 0, y: 0, z: 0 }],
        faces: [{ id: 0, sourceFace: 0, surface: "plane", normal: { x: 0, y: 0, z: 1 }, loops: [[0, 5, 9]] }],
        edges: [{ id: 0, a: 0, b: 7, faces: [0, 3], smooth: false }],
      },
    };
    const hostile = { id: "hostile", name: "Hostile", topology: null } as unknown as CadBody;
    for (const materialId of ["mdf-5.5", "paper-0.2"]) {
      const out = compileFabrication([broken, hostile, boxBody()], settings({ materialId }));
      expect(out.geometry.sheet).toEqual(out.layout.sheet);
      expect(out.warnings.some((w) => w.severity === "error")).toBe(true);
      expect(out.parts.length).toBeGreaterThan(0);
    }
    const empty = compileFabrication([], settings());
    expect(empty.parts).toEqual([]);
    expect(empty.geometry.paths).toEqual([]);
    expect(usedSheets(empty)).toEqual([]);
    expect(buildSheetFiles("svg", empty, "x", false)).toEqual([]);
  });

  it("lists mating edges from the explicit connections", () => {
    const out = compileFabrication([boxBody()], settings());
    const infos = describeParts(out.parts, out.connections);
    expect(infos).toHaveLength(6);
    const total = infos.reduce((n, i) => n + i.links.length, 0);
    expect(total).toBe(out.connections.length * 2);
    const link = infos[0]!.links[0]!;
    expect(link.text).toMatch(/^edge-\d+ ↔ [a-z]+(-\d+)?\.edge-\d+ · [a-z-]+ · 90°$/);
    expect(infos.every((i) => i.width > 0 && i.height > 0)).toBe(true);
  });
});
