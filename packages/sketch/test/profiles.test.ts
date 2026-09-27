import { describe, expect, it } from "vitest";
import {
  type Loop2,
  type Vec2,
  curveEnd,
  curveStart,
  dist2,
  flattenLoop,
  pointInPolygon,
  signedArea,
} from "@fabcad/geometry";
import {
  createCircle,
  createConstructionLine,
  createLine,
  createPolyline,
  createRectangle2Point,
  createSlot,
  createSpline,
} from "../src/create";
import { scaleEntities } from "../src/modify";
import {
  type SketchRegion,
  detectProfiles,
  profileRefOf,
  regionAtPoint,
  resolveProfileRef,
} from "../src/profiles";
import { build, v } from "./helpers";

function expectContiguous(loop: Loop2): void {
  const n = loop.curves.length;
  for (let i = 0; i < n; i++) {
    const gap = dist2(curveEnd(loop.curves[i]!), curveStart(loop.curves[(i + 1) % n]!));
    expect(gap).toBeLessThan(1e-6);
  }
}

function expectValid(regions: SketchRegion[]): void {
  for (const r of regions) {
    expect(r.area).toBeGreaterThan(0);
    expectContiguous(r.profile.outer);
    expect(signedArea(flattenLoop(r.profile.outer, 0.001))).toBeGreaterThan(0);
    expect(signedArea(r.polygon)).toBeGreaterThan(0);
    expect(r.profile.holes).toHaveLength(r.holePolygons.length);
    for (const h of r.profile.holes) {
      expectContiguous(h);
      expect(signedArea(flattenLoop(h, 0.001))).toBeLessThan(0);
    }
    expect(pointInPolygon(r.interiorPoint, r.polygon)).toBe(true);
    for (const h of r.holePolygons) expect(pointInPolygon(r.interiorPoint, h)).toBe(false);
  }
  expect(new Set(regions.map((r) => r.id)).size).toBe(regions.length);
}

const starPoints = (n: number, outer: number, inner: number): Vec2[] => {
  const pts: Vec2[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (Math.PI * i) / n;
    pts.push(v(r * Math.cos(a), r * Math.sin(a)));
  }
  return pts;
};

describe("detectProfiles", () => {
  it("empty sketch", () => {
    expect(detectProfiles(build(() => undefined).sketch)).toEqual([]);
  });

  it("rectangle", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(100, 80)));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expectValid(regions);
    const r = regions[0]!;
    expect(r.area).toBeCloseTo(8000, 6);
    expect(r.profile.outer.curves).toHaveLength(4);
    expect(r.entityIds.slice().sort()).toEqual(out.entities.slice().sort());
    expect(r.holeEntityIds).toEqual([]);
    expect(r.id).toBe(out.entities.slice().sort().join(","));
  });

  it("clockwise drawn rectangle is still CCW", () => {
    const { sketch } = build((b) =>
      createPolyline(b, [v(0, 0), v(0, 10), v(10, 10), v(10, 0)], true),
    );
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expectValid(regions);
    expect(regions[0]!.area).toBeCloseTo(100);
  });

  it("rectangle with inner circle gives two regions", () => {
    const { sketch, out } = build((b) => ({
      rect: createRectangle2Point(b, v(0, 0), v(100, 80)),
      circle: createCircle(b, v(50, 40), 20),
    }));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(2);
    expectValid(regions);
    const disc = Math.PI * 400;
    expect(regions[0]!.area).toBeCloseTo(8000 - disc, 6);
    expect(regions[1]!.area).toBeCloseTo(disc, 6);
    expect(regions[0]!.profile.holes).toHaveLength(1);
    expect(regions[0]!.holeEntityIds).toEqual([[out.circle.entities[0]]]);
    expect(regions[1]!.entityIds).toEqual([out.circle.entities[0]]);
    expect(regions[1]!.profile.holes).toHaveLength(0);
    const hole = regions[0]!.profile.holes[0]!.curves[0]!;
    expect(hole.type === "arc" && hole.sweep).toBeCloseTo(-2 * Math.PI);
    expect(regionAtPoint(regions, v(50, 40))).toBe(regions[1]);
    expect(regionAtPoint(regions, v(5, 5))).toBe(regions[0]);
    expect(regionAtPoint(regions, v(500, 5))).toBeUndefined();
  });

  it("nested shapes three levels deep", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(0, 0), v(100, 100));
      createRectangle2Point(b, v(10, 10), v(90, 90));
      createCircle(b, v(50, 50), 10);
      createCircle(b, v(200, 50), 10);
    });
    const regions = detectProfiles(sketch);
    expectValid(regions);
    expect(regions.map((r) => Math.round(r.area * 1000) / 1000)).toEqual(
      [6400 - Math.PI * 100, 3600, Math.PI * 100, Math.PI * 100].map(
        (a) => Math.round(a * 1000) / 1000,
      ),
    );
    expect(regions.map((r) => r.profile.holes.length)).toEqual([1, 1, 0, 0]);
  });

  it("two overlapping circles give three regions", () => {
    const { sketch } = build((b) => {
      createCircle(b, v(0, 0), 10);
      createCircle(b, v(10, 0), 10);
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(3);
    expectValid(regions);
    const lens = 2 * 100 * Math.acos(0.5) - (10 / 2) * Math.sqrt(400 - 100);
    expect(regions[2]!.area).toBeCloseTo(lens, 6);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 100 - lens, 6);
    expect(regions[1]!.area).toBeCloseTo(Math.PI * 100 - lens, 6);
    expect(regionAtPoint(regions, v(5, 0))).toBe(regions[2]);
  });

  it("two crossing rectangles", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(0, 0), v(10, 10));
      createRectangle2Point(b, v(5, 5), v(15, 15));
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(3);
    expectValid(regions);
    expect(regions.map((r) => r.area)).toEqual([75, 75, 25].map((a) => expect.closeTo(a, 6)));
    expect(regions[0]!.profile.outer.curves).toHaveLength(6);
  });

  it("a plus sign of two rectangles", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(-30, -10), v(30, 10));
      createRectangle2Point(b, v(-10, -30), v(10, 30));
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(5);
    expectValid(regions);
    expect(regions.reduce((a, r) => a + r.area, 0)).toBeCloseTo(1200 + 1200 - 400);
  });

  it("five pointed star polyline", () => {
    const { sketch } = build((b) => createPolyline(b, starPoints(5, 50, 20), true));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expectValid(regions);
    expect(regions[0]!.entityIds).toHaveLength(10);
    expect(regions[0]!.profile.outer.curves).toHaveLength(10);
    expect(regions[0]!.area).toBeCloseTo(Math.abs(signedArea(starPoints(5, 50, 20))), 6);
  });

  it("pentagram of five crossing lines", () => {
    const tips = starPoints(5, 50, 20).filter((_, i) => i % 2 === 0);
    const order = [0, 2, 4, 1, 3].map((i) => tips[i]!);
    const { sketch } = build((b) => createPolyline(b, order, true));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(6);
    expectValid(regions);
    expect(regions[0]!.entityIds).toHaveLength(5);
    expect(regions[0]!.profile.outer.curves).toHaveLength(5);
    for (const r of regions.slice(1)) {
      expect(r.profile.outer.curves).toHaveLength(3);
      expect(r.area).toBeCloseTo(regions[1]!.area, 6);
    }
    expect(regionAtPoint(regions, v(0, 0))).toBe(regions[0]);
  });

  it("slot", () => {
    const { sketch } = build((b) => createSlot(b, v(0, 0), v(40, 30), 10));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expectValid(regions);
    expect(regions[0]!.area).toBeCloseTo(50 * 10 + Math.PI * 25, 6);
    expect(regions[0]!.entityIds).toHaveLength(4);
  });

  it("line tangent to a circle keeps the ordering right", () => {
    // D shape closed by a tangent continuation: circle with a chord and a tangent line.
    const { sketch } = build((b) => {
      createCircle(b, v(0, 0), 10);
      createLine(b, v(-20, 10), v(20, 10)); // tangent at the top, dangling
      createLine(b, v(-10, 0), v(10, 0)); // diameter
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(2);
    expectValid(regions);
    for (const r of regions) expect(r.area).toBeCloseTo(Math.PI * 50, 6);
  });

  it("dangling lines and bridges are ignored", () => {
    const { sketch, out } = build((b) => {
      const rect = createRectangle2Point(b, v(0, 0), v(100, 80));
      createLine(b, rect.points[2]!, v(150, 120));
      createLine(b, v(50, 0), v(50, 30)); // T junction from the bottom edge
      createLine(b, v(-20, -20), v(-10, -20));
      const inner = createRectangle2Point(b, v(20, 40), v(40, 60));
      createLine(b, v(0, 50), v(20, 50)); // bridge between outer and inner rectangle
      return { rect, inner };
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(2);
    expectValid(regions);
    expect(regions[0]!.area).toBeCloseTo(8000 - 400, 6);
    expect(regions[1]!.area).toBeCloseTo(400, 6);
    expect(regions[0]!.entityIds.slice().sort()).toEqual(out.rect.entities.slice().sort());
    expect(regions[0]!.profile.outer.curves).toHaveLength(4);
    expect(regions[0]!.holeEntityIds[0]!.slice().sort()).toEqual(out.inner.entities.slice().sort());
  });

  it("open chain gives nothing", () => {
    const { sketch } = build((b) => createPolyline(b, [v(0, 0), v(10, 0), v(10, 10)], false));
    expect(detectProfiles(sketch)).toEqual([]);
  });

  it("construction geometry is ignored", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(0, 0), v(100, 80));
      createConstructionLine(b, v(50, -10), v(50, 90));
      createCircle(b, v(50, 40), 10, true);
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(8000, 6);
  });

  it("separate lines with coincident end points form a loop", () => {
    const { sketch } = build((b) => {
      createLine(b, v(0, 0), v(10, 0));
      createLine(b, v(10, 0), v(10, 10));
      createLine(b, v(0, 0), v(10, 10));
    });
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(50, 6);
  });

  it("line splitting a rectangle", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(0, 0), v(100, 80));
      createLine(b, v(30, -10), v(30, 90));
    });
    const regions = detectProfiles(sketch);
    expectValid(regions);
    expect(regions.map((r) => r.area)).toEqual([5600, 2400].map((a) => expect.closeTo(a, 6)));
  });

  it("closed fit spline and ellipse", () => {
    const { sketch, out } = build((b) => ({
      s: createSpline(b, "fit", [v(0, 0), v(40, 0), v(40, 30), v(0, 30)], true),
      e: b.ellipse(v(200, 0), v(230, 0), 10),
    }));
    const regions = detectProfiles(sketch);
    expect(regions).toHaveLength(2);
    expectValid(regions);
    const spline = regions.find((r) => r.entityIds[0] === out.s.entities[0])!;
    expect(spline.profile.outer.curves).toHaveLength(4);
    expect(spline.area).toBeCloseTo(Math.abs(signedArea(spline.polygon)), 0);
    expect(spline.area).toBeGreaterThan(1200);
    const ellipse = regions.find((r) => r.entityIds[0] === out.e)!;
    expect(ellipse.area).toBeCloseTo(Math.PI * 30 * 10, 6);
  });

  it("is deterministic", () => {
    const { sketch } = build((b) => {
      createCircle(b, v(0, 0), 10);
      createCircle(b, v(10, 0), 10);
      createRectangle2Point(b, v(-30, -30), v(40, 30));
    });
    const a = detectProfiles(sketch);
    const b2 = detectProfiles(sketch);
    expect(a).toEqual(b2);
    expect(a).toHaveLength(4);
    expect(a[0]!.profile.holes).toHaveLength(1);
    expect(a[0]!.profile.holes[0]!.curves).toHaveLength(2);
    expect(a[0]!.area).toBeCloseTo(4200 - a[1]!.area - a[2]!.area - a[3]!.area, 6);
  });
});

describe("profile references", () => {
  it("resolves after scaling all points by two", () => {
    const { sketch } = build((b) => {
      createRectangle2Point(b, v(0, 0), v(100, 80));
      createCircle(b, v(50, 40), 20);
      createSlot(b, v(200, 0), v(240, 30), 10);
      createRectangle2Point(b, v(80, 60), v(120, 100));
    });
    const before = detectProfiles(sketch);
    expect(before).toHaveLength(5);
    const refs = before.map(profileRefOf);
    const scaled = scaleEntities(sketch, Object.keys(sketch.entities), v(0, 0), 2);
    const after = detectProfiles(scaled);
    expect(after).toHaveLength(5);
    before.forEach((r, i) => {
      const found = resolveProfileRef(after, refs[i]!);
      expect(found).toBeDefined();
      expect(found!.area).toBeCloseTo(r.area * 4, 5);
      expect(found!.entityIds.slice().sort()).toEqual(r.entityIds.slice().sort());
      expect(found!.profile.holes.length).toBe(r.profile.holes.length);
    });
  });

  it("tells regions with identical boundary entities apart by the point", () => {
    const { sketch } = build((b) => {
      createCircle(b, v(-5, 0), 10);
      createCircle(b, v(5, 0), 10);
    });
    const before = detectProfiles(sketch);
    const scaled = scaleEntities(sketch, Object.keys(sketch.entities), v(0, 0), 1.5);
    const after = detectProfiles(scaled);
    const found = before.map((r) => resolveProfileRef(after, profileRefOf(r))!);
    expect(new Set(found.map((r) => r.id)).size).toBe(3);
    found.forEach((r, i) => {
      expect(r.area).toBeCloseTo(before[i]!.area * 2.25, 5);
      expect(Math.sign(Math.round(r.interiorPoint.x))).toBe(
        Math.sign(Math.round(before[i]!.interiorPoint.x)),
      );
    });
  });

  it("falls back to overlap, then to the point", () => {
    const { sketch, out } = build((b) => createRectangle2Point(b, v(0, 0), v(100, 80)));
    const regions = detectProfiles(sketch);
    const partial = { entityIds: [out.entities[0]!, "gone"], point: v(500, 500) };
    expect(resolveProfileRef(regions, partial)).toBe(regions[0]);
    expect(resolveProfileRef(regions, { entityIds: ["gone"], point: v(5, 5) })).toBe(regions[0]);
    expect(resolveProfileRef(regions, { entityIds: ["gone"], point: v(500, 5) })).toBeUndefined();
  });
});
