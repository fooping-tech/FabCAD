import { describe, expect, it } from "vitest";
import { prismTopology } from "@fabcad/geometry";
import {
  type CadBody,
  DEFAULT_MATERIALS,
  analyzeBoardFeasibility,
  analyzeBody,
  describeMaterial,
} from "../src";
import { rect } from "./fixtures";

const mdf = DEFAULT_MATERIALS.find((m) => m.id === "mdf-5.5")!;
const body = (topology: CadBody["topology"]): CadBody => ({ id: "b", name: "Body", topology });
const star = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 === 0 ? 60 : 25;
  const a = Math.PI / 2 + (Math.PI * i) / 5;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
});

describe("fabrication analyzer", () => {
  it("describes materials", () => {
    expect(describeMaterial(mdf)).toBe("5.5 mm MDF");
    expect(describeMaterial({ ...mdf, name: "Plywood", thickness: 3 })).toBe("3 mm Plywood");
  });

  it("analyses a closed box", () => {
    const a = analyzeBody(body(prismTopology(rect(100, 80), 50)));
    expect(a).toEqual({ planarFaces: 6, curvedFaces: 0, closed: true, warnings: [] });
    expect(analyzeBoardFeasibility(body(prismTopology(rect(100, 80), 50)), mdf)).toEqual([]);
  });

  it("reports curved faces and open shells", () => {
    const t = prismTopology(rect(100, 80), 50);
    for (const f of t.faces) {
      if (f.id >= 4) {
        f.surface = "curved";
        f.sourceFace = 4;
      }
    }
    const curved = analyzeBody(body(t));
    expect(curved.planarFaces).toBe(4);
    expect(curved.curvedFaces).toBe(1);
    expect(curved.warnings.map((w) => w.code)).toEqual(["curved-face"]);

    const open = prismTopology(rect(100, 80), 50);
    open.faces.pop();
    for (const e of open.edges) e.faces = e.faces.filter((f) => f < open.faces.length);
    const a = analyzeBody(body(open));
    expect(a.closed).toBe(false);
    expect(a.warnings.map((w) => w.code)).toEqual(["non-manifold"]);
    expect(a.warnings[0]?.position).toBeDefined();
  });

  it("finds concave corners, acute angles and short edges", () => {
    const warnings = analyzeBoardFeasibility(body(prismTopology(star, 10)), mdf);
    const count = (code: string): number => warnings.filter((w) => w.code === code).length;
    expect(count("concave-corner")).toBe(5);
    expect(count("acute-angle")).toBe(5);
    // the ten vertical edges are 10 mm long: shorter than 3 × 5.5 mm
    expect(count("short-edge")).toBe(10);
    const concave = warnings.find((w) => w.code === "concave-corner");
    expect(concave?.message).toMatch(
      /^This corner cannot be reproduced accurately with 5\.5 mm MDF/,
    );
    expect(concave?.position?.z).toBeCloseTo(5, 9);
    expect(analyzeBoardFeasibility(body(prismTopology(star, 10)), mdf, { shortEdgeFactor: 1 })
      .some((w) => w.code === "short-edge")).toBe(false);
  });
});
