import { describe, expect, it } from "vitest";
import { type Curve2, curvePointAt } from "@fabcad/geometry";
import {
  type Sketch,
  type SketchEntity,
  SketchBuilder,
  createSketch,
  detectProfiles,
  entityToCurves,
  getPoint,
  isCurve,
  listCurves,
} from "@fabcad/sketch";
import {
  type DxfEntity,
  DxfParseError,
  bulgeArc,
  evaluateBSpline,
  importDxfIntoSketch,
  parseDxf,
  renderCurvesDxf,
} from "../src/index";

// --- helpers ---------------------------------------------------------------------------------

type Group = [number, string | number];

const dxf = (groups: Group[], eol = "\n"): string =>
  groups.map(([code, value]) => `${code}${eol}${value}${eol}`).join("");

const header = (vars: Group[]): Group[] => [[0, "SECTION"], [2, "HEADER"], ...vars, [0, "ENDSEC"]];

const entitiesSection = (groups: Group[]): Group[] => [
  [0, "SECTION"],
  [2, "ENTITIES"],
  ...groups,
  [0, "ENDSEC"],
];

const file = (entities: Group[], vars: Group[] = [[9, "$INSUNITS"], [70, 4]]): string =>
  dxf([...header(vars), ...entitiesSection(entities), [0, "EOF"]]);

const line = (x1: number, y1: number, x2: number, y2: number, layer = "0"): Group[] => [
  [0, "LINE"],
  [8, layer],
  [10, x1],
  [20, y1],
  [30, 0],
  [11, x2],
  [21, y2],
  [31, 0],
];

const lwRect = (w: number, h: number, layer = "0"): Group[] => [
  [0, "LWPOLYLINE"],
  [5, "2A"],
  [100, "AcDbEntity"],
  [8, layer],
  [100, "AcDbPolyline"],
  [90, 4],
  [70, 1],
  [10, 0],
  [20, 0],
  [10, w],
  [20, 0],
  [10, w],
  [20, h],
  [10, 0],
  [20, h],
];

const emptySketch = (): Sketch => createSketch("s1", "Sketch", { type: "origin", plane: "XY" });

const only = <T extends DxfEntity["type"]>(
  text: string,
  type: T,
): Extract<DxfEntity, { type: T }> => {
  const drawing = parseDxf(text);
  expect(drawing.entities).toHaveLength(1);
  const e = drawing.entities[0]!;
  expect(e.type).toBe(type);
  return e as Extract<DxfEntity, { type: T }>;
};

const entity = <T extends SketchEntity["type"]>(
  sketch: Sketch,
  id: string,
  type: T,
): Extract<SketchEntity, { type: T }> => {
  const e = sketch.entities[id];
  expect(e?.type).toBe(type);
  return e as Extract<SketchEntity, { type: T }>;
};

const rad = (deg: number): number => (deg * Math.PI) / 180;

// --- parser ----------------------------------------------------------------------------------

describe("parseDxf", () => {
  it("reads units, measurement and layers", () => {
    const text = dxf([
      ...header([[9, "$ACADVER"], [1, "AC1027"], [9, "$MEASUREMENT"], [70, 1], [9, "$INSUNITS"], [70, 1]]),
      [0, "SECTION"],
      [2, "TABLES"],
      [0, "TABLE"],
      [2, "LTYPE"],
      [0, "LTYPE"],
      [2, "CONTINUOUS"],
      [0, "ENDTAB"],
      [0, "TABLE"],
      [2, "LAYER"],
      [70, 2],
      [0, "LAYER"],
      [5, "10"],
      [100, "AcDbSymbolTableRecord"],
      [2, "0"],
      [70, 0],
      [62, 7],
      [6, "CONTINUOUS"],
      [0, "LAYER"],
      [2, "Cut"],
      [70, 0],
      [62, -1],
      [0, "ENDTAB"],
      [0, "ENDSEC"],
      ...entitiesSection(line(0, 0, 1, 1, "Engrave")),
      [0, "EOF"],
    ]);
    const d = parseDxf(text);
    expect(d.units).toBe("inch");
    expect(d.measurement).toBe("metric");
    expect(d.layers).toEqual([{ name: "0", color: 7 }, { name: "Cut", color: 1 }, { name: "Engrave" }]);
    expect(d.warnings).toEqual([]);
  });

  it("is unitless without header and tolerates a missing HEADER / TABLES", () => {
    const d = parseDxf(dxf([...entitiesSection(line(0, 0, 3, 4)), [0, "EOF"]]));
    expect(d.units).toBe("unitless");
    expect(d.measurement).toBeUndefined();
    expect(d.entities).toEqual([{ type: "line", layer: "0", a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }]);
    expect(d.layers).toEqual([{ name: "0" }]);
  });

  it("maps $INSUNITS and warns about unsupported units", () => {
    const units = (n: number) => parseDxf(file([], [[9, "$INSUNITS"], [70, n]]));
    expect(units(0).units).toBe("unitless");
    expect(units(4).units).toBe("mm");
    expect(units(5).units).toBe("cm");
    expect(units(6).units).toBe("m");
    const feet = units(2);
    expect(feet.units).toBe("unitless");
    expect(feet.warnings.join(" ")).toMatch(/feet/);
    expect(parseDxf(file([], [[9, "$MEASUREMENT"], [70, 0]])).measurement).toBe("imperial");
  });

  it("reads LINE, CIRCLE, ARC and POINT, defaulting the layer to 0", () => {
    const d = parseDxf(
      file([
        ...line(1, 2, 3, 4, "A"),
        [0, "CIRCLE"],
        [10, 5],
        [20, 6],
        [40, 2.5],
        [0, "ARC"],
        [8, "B"],
        [10, 1],
        [20, 1],
        [40, 2],
        [50, 30],
        [51, 120],
        [0, "POINT"],
        [10, 7],
        [20, 8],
      ]),
    );
    expect(d.entities[0]).toEqual({ type: "line", layer: "A", a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    expect(d.entities[1]).toEqual({ type: "circle", layer: "0", center: { x: 5, y: 6 }, radius: 2.5 });
    const arc = d.entities[2]!;
    expect(arc.type).toBe("arc");
    if (arc.type === "arc") {
      expect(arc.startAngle).toBeCloseTo(rad(30), 12);
      expect(arc.endAngle).toBeCloseTo(rad(120), 12);
    }
    expect(d.entities[3]).toEqual({ type: "point", layer: "0", at: { x: 7, y: 8 } });
  });

  it("accepts CRLF line ends and padded values", () => {
    const crlf = dxf([...entitiesSection(line(0, 0, 10, 5, "Cut")), [0, "EOF"]], "\r\n");
    expect(crlf).toContain("\r\n");
    expect(parseDxf(crlf).entities).toEqual([
      { type: "line", layer: "Cut", a: { x: 0, y: 0 }, b: { x: 10, y: 5 } },
    ]);
    const padded =
      "\n  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nLINE\r\n  8\r\n Cut \r\n 10\r\n 1.5 \r\n 20\r\n2.0\r\n 11\r\n3.0\r\n 21\r\n4.0\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n\r\n";
    expect(parseDxf(padded).entities).toEqual([
      { type: "line", layer: "Cut", a: { x: 1.5, y: 2 }, b: { x: 3, y: 4 } },
    ]);
  });

  it("rejects binary DXF, garbage and files without entities", () => {
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\u001a\u0000\u0000\u0000")).toThrow(DxfParseError);
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(/binary/i);
    expect(() => parseDxf("")).toThrow(DxfParseError);
    expect(() => parseDxf("  \n \r\n")).toThrow(DxfParseError);
    expect(() => parseDxf("<svg xmlns='http://www.w3.org/2000/svg'>\n<path d='M0 0'/>\n</svg>\n")).toThrow(
      DxfParseError,
    );
    expect(() => parseDxf("hello\nworld\n")).toThrow(DxfParseError);
    expect(() => parseDxf("\u0000\u0001\u0002PK\u0003\u0004")).toThrow(DxfParseError);
    // A header alone is not a drawing.
    expect(() => parseDxf(dxf([...header([[9, "$INSUNITS"], [70, 4]]), [0, "EOF"]]))).toThrow(DxfParseError);
    expect(new DxfParseError("x")).toBeInstanceOf(Error);
  });

  it("accepts an empty ENTITIES section and a bare entity stream", () => {
    expect(parseDxf(file([])).entities).toEqual([]);
    expect(parseDxf(dxf([...line(0, 0, 1, 0), [0, "EOF"]])).entities).toHaveLength(1);
  });

  it("counts unsupported entities", () => {
    const d = parseDxf(
      file([
        [0, "TEXT"],
        [8, "0"],
        [10, 0],
        [20, 0],
        [40, 2.5],
        [1, "Hello"],
        [0, "TEXT"],
        [10, 0],
        [20, 5],
        [40, 2.5],
        [1, "World"],
        [0, "TEXT"],
        [10, 0],
        [20, 9],
        [40, 2.5],
        [1, ""],
        [0, "HATCH"],
        [10, 0],
        [20, 0],
        [2, "SOLID"],
        ...line(0, 0, 1, 1),
      ]),
    );
    expect(d.skipped).toEqual({ TEXT: 3, HATCH: 1 });
    expect(d.entities).toHaveLength(1);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toMatch(/TEXT × 3/);
  });

  it("reads LWPOLYLINE with bulges", () => {
    const p = only(
      file([
        [0, "LWPOLYLINE"],
        [8, "Cut"],
        [90, 3],
        [70, 0],
        [43, 0],
        [10, 0],
        [20, 0],
        [42, 0.5],
        [10, 10],
        [20, 0],
        [10, 10],
        [20, 10],
        [42, -1],
      ]),
      "polyline",
    );
    expect(p.closed).toBe(false);
    expect(p.layer).toBe("Cut");
    expect(p.vertices).toEqual([
      { point: { x: 0, y: 0 }, bulge: 0.5 },
      { point: { x: 10, y: 0 }, bulge: 0 },
      { point: { x: 10, y: 10 }, bulge: -1 },
    ]);
  });

  it("reads POLYLINE / VERTEX / SEQEND and skips meshes", () => {
    const d = parseDxf(
      file([
        [0, "POLYLINE"],
        [8, "Cut"],
        [66, 1],
        [10, 0],
        [20, 0],
        [30, 0],
        [70, 1],
        [0, "VERTEX"],
        [8, "Cut"],
        [10, 0],
        [20, 0],
        [30, 0],
        [0, "VERTEX"],
        [8, "Cut"],
        [10, 4],
        [20, 0],
        [30, 0],
        [42, 1],
        [0, "VERTEX"],
        [8, "Cut"],
        [10, 4],
        [20, 3],
        [30, 0],
        [0, "SEQEND"],
        [8, "Cut"],
        [0, "POLYLINE"],
        [66, 1],
        [70, 64],
        [0, "VERTEX"],
        [10, 0],
        [20, 0],
        [70, 192],
        [0, "SEQEND"],
        ...line(0, 0, 1, 1),
      ]),
    );
    expect(d.entities).toHaveLength(2);
    expect(d.entities[0]).toEqual({
      type: "polyline",
      layer: "Cut",
      closed: true,
      vertices: [
        { point: { x: 0, y: 0 }, bulge: 0 },
        { point: { x: 4, y: 0 }, bulge: 1 },
        { point: { x: 4, y: 3 }, bulge: 0 },
      ],
    });
    expect(d.entities[1]!.type).toBe("line");
    expect(d.skipped).toEqual({ "POLYLINE (mesh)": 1 });
  });

  it("reads ELLIPSE and SPLINE", () => {
    const d = parseDxf(
      file([
        [0, "ELLIPSE"],
        [8, "E"],
        [10, 10],
        [20, 5],
        [30, 0],
        [11, 4],
        [21, 0],
        [31, 0],
        [40, 0.5],
        [41, 0],
        [42, 6.283185307179586],
        [0, "SPLINE"],
        [8, "S"],
        [210, 0],
        [220, 0],
        [230, 1],
        [70, 8],
        [71, 3],
        [72, 8],
        [73, 4],
        [74, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [40, 1],
        [10, 0],
        [20, 0],
        [30, 0],
        [10, 1],
        [20, 2],
        [30, 0],
        [10, 3],
        [20, 2],
        [30, 0],
        [10, 4],
        [20, 0],
        [30, 0],
        [0, "SPLINE"],
        [70, 4],
        [71, 2],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [41, 1],
        [41, 0.7071],
        [41, 1],
        [10, 1],
        [20, 0],
        [10, 1],
        [20, 1],
        [10, 0],
        [20, 1],
      ]),
    );
    expect(d.entities[0]).toEqual({
      type: "ellipse",
      layer: "E",
      center: { x: 10, y: 5 },
      majorAxis: { x: 4, y: 0 },
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    });
    expect(d.entities[1]).toEqual({
      type: "spline",
      layer: "S",
      degree: 3,
      closed: false,
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 0 },
      ],
      fitPoints: [],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    });
    const nurbs = d.entities[2]!;
    expect(nurbs.type === "spline" && nurbs.weights).toEqual([1, 0.7071, 1]);
  });

  it("mirrors entities whose extrusion direction is −Z", () => {
    const normal: Group[] = [
      [210, 0],
      [220, 0],
      [230, -1],
    ];
    const d = parseDxf(
      file([
        [0, "CIRCLE"],
        [10, 5],
        [20, 2],
        [40, 1],
        ...normal,
        [0, "ARC"],
        [10, 5],
        [20, 2],
        [40, 3],
        [50, 0],
        [51, 90],
        ...normal,
        [0, "LWPOLYLINE"],
        [90, 2],
        [70, 0],
        [10, 0],
        [20, 0],
        [42, 1],
        [10, 2],
        [20, 0],
        ...normal,
        // Lines are stored in world coordinates whatever the extrusion direction is.
        ...line(1, 1, 2, 2),
        ...normal,
      ]),
    );
    expect(d.warnings).toEqual([]);
    const [circle, arc, poly, l] = d.entities;
    expect(circle).toMatchObject({ type: "circle", radius: 1 });
    if (circle?.type === "circle") {
      expect(circle.center.x).toBeCloseTo(-5, 12);
      expect(circle.center.y).toBeCloseTo(2, 12);
    }
    // OCS angles 0° … 90° about −Z are the world angles 90° … 180°.
    expect(arc?.type).toBe("arc");
    if (arc?.type === "arc") {
      expect(arc.center.x).toBeCloseTo(-5, 12);
      expect(arc.radius).toBeCloseTo(3, 12);
      expect(arc.startAngle).toBeCloseTo(rad(90), 12);
      expect(arc.endAngle).toBeCloseTo(rad(180), 12);
    }
    expect(poly?.type).toBe("polyline");
    if (poly?.type === "polyline") {
      expect(poly.vertices[0]!.point.x).toBeCloseTo(0, 12);
      expect(poly.vertices[1]!.point.x).toBeCloseTo(-2, 12);
      expect(poly.vertices[0]!.bulge).toBe(-1);
    }
    expect(l).toEqual({ type: "line", layer: "0", a: { x: 1, y: 1 }, b: { x: 2, y: 2 } });
  });

  it("ignores entities in other planes and reports Z coordinates once", () => {
    const d = parseDxf(
      file([
        [0, "CIRCLE"],
        [10, 0],
        [20, 0],
        [40, 1],
        [210, 1],
        [220, 0],
        [230, 0],
        [0, "LINE"],
        [10, 0],
        [20, 0],
        [30, 5],
        [11, 1],
        [21, 0],
        [31, 5],
        [0, "LINE"],
        [10, 0],
        [20, 0],
        [30, 2],
        [11, 1],
        [21, 1],
        [31, 0],
      ]),
    );
    expect(d.entities.map((e) => e.type)).toEqual(["line", "line"]);
    expect(d.warnings).toHaveLength(2);
    expect(d.warnings.filter((w) => /Z coordinates/.test(w))).toHaveLength(1);
    expect(d.warnings.filter((w) => /extrusion direction/.test(w))).toHaveLength(1);
  });

  it("expands block references", () => {
    const text = dxf([
      ...header([[9, "$INSUNITS"], [70, 4]]),
      [0, "SECTION"],
      [2, "BLOCKS"],
      [0, "BLOCK"],
      [8, "0"],
      [2, "HOLE"],
      [70, 0],
      [10, 1],
      [20, 0],
      [30, 0],
      [0, "CIRCLE"],
      [8, "0"],
      [10, 1],
      [20, 0],
      [40, 2],
      [0, "LINE"],
      [8, "Marks"],
      [10, 1],
      [20, 0],
      [11, 3],
      [21, 0],
      [0, "ARC"],
      [8, "0"],
      [10, 1],
      [20, 0],
      [40, 1],
      [50, 0],
      [51, 90],
      [0, "TEXT"],
      [10, 0],
      [20, 0],
      [1, "label"],
      [0, "ENDBLK"],
      [0, "BLOCK"],
      [2, "UNUSED"],
      [10, 0],
      [20, 0],
      [0, "MTEXT"],
      [1, "never reported"],
      [0, "ENDBLK"],
      [0, "ENDSEC"],
      ...entitiesSection([
        [0, "INSERT"],
        [8, "Cut"],
        [2, "HOLE"],
        [10, 10],
        [20, 20],
        [41, 2],
        [42, 2],
        [50, 90],
        [0, "INSERT"],
        [8, "Cut"],
        [2, "hole"],
        [10, 0],
        [20, 0],
        [41, 2],
        [42, 1],
        [0, "INSERT"],
        [2, "MISSING"],
        [10, 0],
        [20, 0],
      ]),
      [0, "EOF"],
    ]);
    const d = parseDxf(text);
    expect(d.skipped).toEqual({ TEXT: 1 });
    expect(d.warnings.some((w) => /MISSING/.test(w))).toBe(true);
    expect(d.entities).toHaveLength(6);

    // First reference: base point (1,0) → (10,20), scaled by 2 and turned by 90°.
    const [circle, l, arc, ellipse, l2, ellipseArc] = d.entities;
    expect(circle?.layer).toBe("Cut"); // layer 0 of the block takes the layer of the reference
    if (circle?.type === "circle") {
      expect(circle.center.x).toBeCloseTo(10, 9);
      expect(circle.center.y).toBeCloseTo(20, 9);
      expect(circle.radius).toBeCloseTo(4, 9);
    } else expect(circle?.type).toBe("circle");
    expect(l?.layer).toBe("Marks");
    if (l?.type === "line") {
      expect(l.b.x).toBeCloseTo(10, 9);
      expect(l.b.y).toBeCloseTo(24, 9);
    } else expect(l?.type).toBe("line");
    if (arc?.type === "arc") {
      expect(arc.radius).toBeCloseTo(2, 9);
      expect(arc.startAngle).toBeCloseTo(rad(90), 9);
      expect(arc.endAngle).toBeCloseTo(rad(180), 9);
    } else expect(arc?.type).toBe("arc");

    // Second reference: non-uniform scale, the circle becomes an ellipse.
    if (ellipse?.type === "ellipse") {
      expect(ellipse.center.x).toBeCloseTo(0, 9);
      expect(Math.hypot(ellipse.majorAxis.x, ellipse.majorAxis.y)).toBeCloseTo(4, 9);
      expect(Math.abs(ellipse.majorAxis.y)).toBeCloseTo(0, 9);
      expect(ellipse.ratio).toBeCloseTo(0.5, 9);
      expect(ellipse.endParam - ellipse.startParam).toBeCloseTo(2 * Math.PI, 9);
    } else expect(ellipse?.type).toBe("ellipse");
    expect(l2?.type).toBe("line");
    if (ellipseArc?.type === "ellipse") {
      const at = (t: number) => ({
        x:
          ellipseArc.center.x +
          Math.cos(t) * ellipseArc.majorAxis.x -
          Math.sin(t) * ellipseArc.ratio * ellipseArc.majorAxis.y,
        y:
          ellipseArc.center.y +
          Math.cos(t) * ellipseArc.majorAxis.y +
          Math.sin(t) * ellipseArc.ratio * ellipseArc.majorAxis.x,
      });
      // Quarter arc of radius 1 from (1,0) to (0,1) around the base point, stretched in X.
      expect(at(ellipseArc.startParam).x).toBeCloseTo(2, 9);
      expect(at(ellipseArc.startParam).y).toBeCloseTo(0, 9);
      expect(at(ellipseArc.endParam).x).toBeCloseTo(0, 9);
      expect(at(ellipseArc.endParam).y).toBeCloseTo(1, 9);
    } else expect(ellipseArc?.type).toBe("ellipse");
  });
});

describe("bulgeArc", () => {
  it("computes centre and radius", () => {
    // Half circle, counter-clockwise from (0,0) to (2,0): below the chord.
    const half = bulgeArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)!;
    expect(half.center.x).toBeCloseTo(1, 12);
    expect(half.center.y).toBeCloseTo(0, 12);
    expect(half.radius).toBeCloseTo(1, 12);
    expect(half.clockwise).toBe(false);
    expect(half.startAngle).toBeCloseTo(Math.PI, 12);
    // Quarter circle: bulge = tan(90° / 4).
    const b = Math.tan(Math.PI / 8);
    const quarter = bulgeArc({ x: 1, y: 0 }, { x: 0, y: 1 }, b)!;
    expect(quarter.center.x).toBeCloseTo(0, 12);
    expect(quarter.center.y).toBeCloseTo(0, 12);
    expect(quarter.radius).toBeCloseTo(1, 12);
    expect(quarter.startAngle).toBeCloseTo(0, 12);
    expect(quarter.endAngle).toBeCloseTo(Math.PI / 2, 12);
    // Clockwise: the centre is on the other side and start / end are exchanged.
    const cw = bulgeArc({ x: 1, y: 0 }, { x: 0, y: 1 }, -b)!;
    expect(cw.center.x).toBeCloseTo(1, 12);
    expect(cw.center.y).toBeCloseTo(1, 12);
    expect(cw.clockwise).toBe(true);
    expect(cw.startAngle).toBeCloseTo(Math.PI, 12);
    expect(cw.endAngle).toBeCloseTo(1.5 * Math.PI, 12);
    expect(bulgeArc({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBeNull();
  });
});

// --- conversion ------------------------------------------------------------------------------

const importText = (
  text: string,
  options?: Parameters<typeof importDxfIntoSketch>[2],
  sketch: Sketch = emptySketch(),
) => importDxfIntoSketch(sketch, parseDxf(text), options);

describe("importDxfIntoSketch", () => {
  it("imports a line", () => {
    const r = importText(file(line(1, 2, 30, 40, "Cut")));
    expect(r.created).toHaveLength(1);
    expect(r.scale).toBe(1);
    expect(r.unit).toBe("mm");
    expect(r.warnings).toEqual([]);
    const l = entity(r.sketch, r.created[0]!, "line");
    expect(getPoint(r.sketch, l.p1)).toEqual({ x: 1, y: 2 });
    expect(getPoint(r.sketch, l.p2)).toEqual({ x: 30, y: 40 });
    expect(l.construction).toBeUndefined();
    expect(r.layerOf[l.id]).toBe("Cut");
    expect(r.bounds).toEqual({ minX: 1, minY: 2, maxX: 30, maxY: 40 });
    expect(Object.keys(r.sketch.constraints)).toHaveLength(0);
    expect(Object.keys(r.sketch.dimensions)).toHaveLength(0);
  });

  it("imports a circle", () => {
    const r = importText(file([[0, "CIRCLE"], [8, "Cut"], [10, 5], [20, 6], [30, 0], [40, 2.5]]));
    const c = entity(r.sketch, r.created[0]!, "circle");
    expect(c.radius).toBe(2.5);
    expect(getPoint(r.sketch, c.center)).toEqual({ x: 5, y: 6 });
    expect(r.bounds).toEqual({ minX: 2.5, minY: 3.5, maxX: 7.5, maxY: 8.5 });
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 2.5 * 2.5, 6);
  });

  it("imports arcs given in degrees, counter-clockwise", () => {
    const r = importText(
      file([
        [0, "ARC"],
        [10, 10],
        [20, 20],
        [40, 5],
        [50, 30],
        [51, 120],
        // Crosses 0°: from 315° over 0° to 45°.
        [0, "ARC"],
        [10, 0],
        [20, 0],
        [40, 2],
        [50, 315],
        [51, 45],
      ]),
    );
    expect(r.created).toHaveLength(2);
    const a = entity(r.sketch, r.created[0]!, "arc");
    const c = getPoint(r.sketch, a.center);
    expect(c.x).toBeCloseTo(10, 12);
    expect(c.y).toBeCloseTo(20, 12);
    const s = getPoint(r.sketch, a.start);
    const e = getPoint(r.sketch, a.end);
    expect(s.x).toBeCloseTo(10 + 5 * Math.cos(rad(30)), 12);
    expect(s.y).toBeCloseTo(20 + 5 * Math.sin(rad(30)), 12);
    expect(e.x).toBeCloseTo(10 + 5 * Math.cos(rad(120)), 12);
    expect(e.y).toBeCloseTo(20 + 5 * Math.sin(rad(120)), 12);
    const curve = entityToCurves(r.sketch, a)[0]!;
    expect(curve.type === "arc" && curve.sweep).toBeCloseTo(rad(90), 12);

    const b = entity(r.sketch, r.created[1]!, "arc");
    const bs = getPoint(r.sketch, b.start);
    const be = getPoint(r.sketch, b.end);
    expect(bs.x).toBeCloseTo(Math.SQRT2, 12);
    expect(bs.y).toBeCloseTo(-Math.SQRT2, 12);
    expect(be.x).toBeCloseTo(Math.SQRT2, 12);
    expect(be.y).toBeCloseTo(Math.SQRT2, 12);
    const crossing = entityToCurves(r.sketch, b)[0]!;
    expect(crossing.type === "arc" && crossing.sweep).toBeCloseTo(rad(90), 12);
    // The middle of the arc is at 0°.
    const mid = curvePointAt(crossing, 0.5);
    expect(mid.x).toBeCloseTo(2, 12);
    expect(mid.y).toBeCloseTo(0, 12);
    expect(r.bounds!.maxX).toBeCloseTo(10 + 5 * Math.cos(rad(30)), 9);
    expect(r.bounds!.maxY).toBeCloseTo(25, 9);
  });

  it("imports a closed LWPOLYLINE as lines sharing their points", () => {
    const r = importText(file(lwRect(40, 25, "Cut")));
    expect(r.created).toHaveLength(4);
    const lines = r.created.map((id) => entity(r.sketch, id, "line"));
    const pointIds = new Set(lines.flatMap((l) => [l.p1, l.p2]));
    expect(pointIds.size).toBe(4);
    expect(Object.values(r.sketch.entities).filter((e) => e.type === "point")).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(lines[i]!.p2).toBe(lines[(i + 1) % 4]!.p1);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(40 * 25, 9);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 25 });
    expect(Object.keys(r.sketch.constraints)).toHaveLength(0);
  });

  it("imports a slot (LWPOLYLINE with bulges)", () => {
    // 30 long between the centres, radius 5: two lines and two half circles.
    const r = importText(
      file([
        [0, "LWPOLYLINE"],
        [8, "Cut"],
        [90, 4],
        [70, 1],
        [10, 0],
        [20, 0],
        [10, 30],
        [20, 0],
        [42, 1],
        [10, 30],
        [20, 10],
        [10, 0],
        [20, 10],
        [42, 1],
      ]),
    );
    expect(r.created.map((id) => r.sketch.entities[id]!.type)).toEqual(["line", "arc", "line", "arc"]);
    const right = entity(r.sketch, r.created[1]!, "arc");
    expect(getPoint(r.sketch, right.center).x).toBeCloseTo(30, 12);
    expect(getPoint(r.sketch, right.center).y).toBeCloseTo(5, 12);
    expect(getPoint(r.sketch, right.start)).toEqual({ x: 30, y: 0 });
    expect(getPoint(r.sketch, right.end)).toEqual({ x: 30, y: 10 });
    const left = entity(r.sketch, r.created[3]!, "arc");
    expect(getPoint(r.sketch, left.center).x).toBeCloseTo(0, 12);
    expect(getPoint(r.sketch, left.center).y).toBeCloseTo(5, 12);
    for (const arc of [right, left]) {
      const curve = entityToCurves(r.sketch, arc)[0]!;
      expect(curve.type === "arc" && curve.radius).toBeCloseTo(5, 12);
      expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI, 12);
    }
    expect(Object.values(r.sketch.entities).filter((e) => e.type === "point")).toHaveLength(6);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(30 * 10 + Math.PI * 25, 6);
    expect(r.bounds!.minX).toBeCloseTo(-5, 9);
    expect(r.bounds!.maxX).toBeCloseTo(35, 9);
  });

  it("imports a rounded rectangle drawn clockwise (negative bulges)", () => {
    const w = 40;
    const h = 20;
    const rr = 4;
    const b = -Math.tan(Math.PI / 8);
    // Clockwise, starting at the top left.
    const vertices: [number, number, number][] = [
      [rr, h, 0],
      [w - rr, h, b],
      [w, h - rr, 0],
      [w, rr, b],
      [w - rr, 0, 0],
      [rr, 0, b],
      [0, rr, 0],
      [0, h - rr, b],
    ];
    const groups: Group[] = [[0, "LWPOLYLINE"], [90, 8], [70, 1]];
    for (const [x, y, bulge] of vertices) {
      groups.push([10, x], [20, y]);
      if (bulge !== 0) groups.push([42, bulge]);
    }
    const r = importText(file(groups));
    expect(r.created).toHaveLength(8);
    const arcs = r.created
      .map((id) => r.sketch.entities[id]!)
      .filter((e): e is Extract<SketchEntity, { type: "arc" }> => e.type === "arc");
    expect(arcs).toHaveLength(4);
    const topRight = arcs[0]!;
    expect(getPoint(r.sketch, topRight.center).x).toBeCloseTo(w - rr, 12);
    expect(getPoint(r.sketch, topRight.center).y).toBeCloseTo(h - rr, 12);
    // Stored counter-clockwise: start and end are exchanged.
    expect(getPoint(r.sketch, topRight.start)).toEqual({ x: w, y: h - rr });
    expect(getPoint(r.sketch, topRight.end)).toEqual({ x: w - rr, y: h });
    for (const arc of arcs) {
      const curve = entityToCurves(r.sketch, arc)[0]!;
      expect(curve.type === "arc" && curve.radius).toBeCloseTo(rr, 12);
      expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI / 2, 12);
    }
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(w * h - (4 - Math.PI) * rr * rr, 6);
  });

  it("imports old-style POLYLINE / VERTEX / SEQEND", () => {
    const vertex = (x: number, y: number): Group[] => [[0, "VERTEX"], [8, "Cut"], [10, x], [20, y], [30, 0]];
    const r = importText(
      file([
        [0, "POLYLINE"],
        [8, "Cut"],
        [66, 1],
        [10, 0],
        [20, 0],
        [30, 0],
        [70, 1],
        ...vertex(0, 0),
        ...vertex(12, 0),
        ...vertex(12, 8),
        ...vertex(0, 8),
        [0, "SEQEND"],
        [8, "Cut"],
        [0, "POLYLINE"],
        [8, "Open"],
        [66, 1],
        [70, 0],
        ...vertex(20, 0),
        ...vertex(25, 0),
        ...vertex(25, 5),
        [0, "SEQEND"],
      ]),
    );
    expect(r.created).toHaveLength(6);
    expect(r.created.map((id) => r.layerOf[id])).toEqual(["Cut", "Cut", "Cut", "Cut", "Open", "Open"]);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(96, 9);
  });

  it("imports a full ellipse and replaces an elliptical arc by control splines", () => {
    const r = importText(
      file([
        [0, "ELLIPSE"],
        [10, 10],
        [20, 5],
        [11, 0],
        [21, 8],
        [40, 0.25],
        [41, 0],
        [42, 6.283185307179586],
        [0, "ELLIPSE"],
        [10, 0],
        [20, 0],
        [11, 6],
        [21, 0],
        [40, 0.5],
        [41, 0],
        [42, 1.5707963267948966],
      ]),
    );
    const e = entity(r.sketch, r.created[0]!, "ellipse");
    expect(getPoint(r.sketch, e.center)).toEqual({ x: 10, y: 5 });
    expect(getPoint(r.sketch, e.majorPoint)).toEqual({ x: 10, y: 13 });
    expect(e.minorRadius).toBeCloseTo(2, 12);

    // The arc: control splines of four points, end to end, within 1e-6 mm of the ellipse.
    const spans = r.created.slice(1).map((id) => entity(r.sketch, id, "spline"));
    expect(spans.length).toBeGreaterThan(1);
    for (const [i, s] of spans.entries()) {
      expect(s.kind).toBe("control");
      expect(s.points).toHaveLength(4);
      if (i > 0) expect(s.points[0]).toBe(spans[i - 1]!.points[3]);
      for (const c of entityToCurves(r.sketch, s)) {
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const p = curvePointAt(c, t);
          // Distance to the ellipse x²/36 + y²/9 = 1, to first order.
          const g = Math.hypot(p.x / 18, (2 * p.y) / 9);
          expect(Math.abs((p.x / 6) ** 2 + (p.y / 3) ** 2 - 1) / g).toBeLessThan(2e-6);
        }
      }
    }
    expect(getPoint(r.sketch, spans[0]!.points[0]!)).toEqual({ x: 6, y: 0 });
    const end = getPoint(r.sketch, spans[spans.length - 1]!.points[3]!);
    expect(end.x).toBeCloseTo(0, 12);
    expect(end.y).toBeCloseTo(3, 12);
    expect(r.warnings).toEqual([]);
  });

  it("imports splines with fit points and with control points", () => {
    const r = importText(
      file([
        [0, "SPLINE"],
        [8, "Fit"],
        [70, 8],
        [71, 3],
        [74, 3],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [40, 1],
        [10, 0],
        [20, 0],
        [10, 9],
        [20, 9],
        [10, 9],
        [20, 9],
        [10, 9],
        [20, 9],
        [11, 0],
        [21, 0],
        [31, 0],
        [11, 5],
        [21, 3],
        [31, 0],
        [11, 10],
        [21, 0],
        [31, 0],
        [0, "SPLINE"],
        [8, "Control"],
        [70, 8],
        [71, 3],
        [72, 9],
        [73, 5],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 5],
        [40, 10],
        [40, 10],
        [40, 10],
        [40, 10],
        [10, 0],
        [20, 10],
        [10, 2],
        [20, 14],
        [10, 5],
        [20, 8],
        [10, 8],
        [20, 14],
        [10, 10],
        [20, 10],
      ]),
    );
    expect(r.warnings).toEqual([]);
    expect(r.created).toHaveLength(2);
    const fit = entity(r.sketch, r.created[0]!, "spline");
    expect(fit.kind).toBe("fit");
    expect(fit.points.map((id) => getPoint(r.sketch, id))).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ]);
    const control = entity(r.sketch, r.created[1]!, "spline");
    expect(control.kind).toBe("control");
    expect(control.closed).toBe(false);
    const cps = control.points.map((id) => getPoint(r.sketch, id));
    expect(cps).toEqual([
      { x: 0, y: 10 },
      { x: 2, y: 14 },
      { x: 5, y: 8 },
      { x: 8, y: 14 },
      { x: 10, y: 10 },
    ]);
    // The sketch curve is the curve of the file.
    const knots = [0, 0, 0, 0, 5, 10, 10, 10, 10];
    const curves = entityToCurves(r.sketch, control);
    expect(curves).toHaveLength(2);
    curves.forEach((c, span) => {
      for (const t of [0, 0.3, 0.5, 0.9, 1]) {
        const expected = evaluateBSpline(3, knots, cps, undefined, (span + t) * 5);
        const p = curvePointAt(c, t);
        expect(p.x).toBeCloseTo(expected.x, 4);
        expect(p.y).toBeCloseTo(expected.y, 4);
      }
    });
  });

  it("follows splines that one control spline cannot hold (NURBS, non-uniform knots) with several", () => {
    // Quarter of the unit circle as a rational quadratic.
    const w = Math.SQRT1_2;
    const r = importText(
      file([
        [0, "SPLINE"],
        [70, 12],
        [71, 2],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 1],
        [40, 1],
        [41, 1],
        [41, w],
        [41, 1],
        [10, 10],
        [20, 0],
        [10, 10],
        [20, 10],
        [10, 0],
        [20, 10],
        [0, "SPLINE"],
        [71, 3],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 0],
        [40, 1],
        [40, 10],
        [40, 10],
        [40, 10],
        [40, 10],
        [10, 0],
        [20, 0],
        [10, 2],
        [20, 4],
        [10, 5],
        [20, -2],
        [10, 8],
        [20, 4],
        [10, 10],
        [20, 0],
      ]),
    );
    const splines = r.created.map((id) => entity(r.sketch, id, "spline"));
    for (const s of splines) {
      expect(s.kind).toBe("control");
      expect(s.points).toHaveLength(4);
    }
    // The quarter circle: the spans that start at (10, 0), until the one that ends at (0, 10).
    const arcEnd = splines.findIndex((s) => Math.abs(getPoint(r.sketch, s.points[3]!).x) < 1e-9);
    const arc = splines.slice(0, arcEnd + 1);
    expect(getPoint(r.sketch, arc[0]!.points[0]!)).toEqual({ x: 10, y: 0 });
    expect(getPoint(r.sketch, arc[arc.length - 1]!.points[3]!).y).toBeCloseTo(10, 12);
    for (const s of arc) {
      for (const c of entityToCurves(r.sketch, s)) {
        for (const t of [0, 0.2, 0.5, 0.8, 1]) {
          const p = curvePointAt(c, t);
          expect(Math.abs(Math.hypot(p.x, p.y) - 10)).toBeLessThan(1e-6);
        }
      }
    }
    // The non-uniform cubic: one span per knot span, each the curve of the file exactly.
    const rest = splines.slice(arcEnd + 1);
    expect(rest).toHaveLength(2);
    const knots = [0, 0, 0, 0, 1, 10, 10, 10, 10];
    const cps = [
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 5, y: -2 },
      { x: 8, y: 4 },
      { x: 10, y: 0 },
    ];
    rest.forEach((s, span) => {
      const [u0, u1] = span === 0 ? [0, 1] : [1, 10];
      const c = entityToCurves(r.sketch, s)[0]!;
      for (const t of [0, 0.3, 0.5, 0.9, 1]) {
        const expected = evaluateBSpline(3, knots, cps, undefined, u0 + (u1 - u0) * t);
        const p = curvePointAt(c, t);
        expect(p.x).toBeCloseTo(expected.x, 6);
        expect(p.y).toBeCloseTo(expected.y, 6);
      }
    });
    expect(r.warnings).toEqual([]);
  });

  it("imports points", () => {
    const r = importText(file([[0, "POINT"], [8, "Marks"], [10, 3], [20, 4], [30, 0]]));
    expect(r.created).toEqual([]);
    expect(r.points).toHaveLength(1);
    expect(entity(r.sketch, r.points[0]!, "point")).toMatchObject({ x: 3, y: 4 });
    expect(r.layerOf[r.points[0]!]).toBe("Marks");
    expect(r.bounds).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it("converts inches to millimetres", () => {
    const r = importText(
      file(
        [...lwRect(2, 1), [0, "CIRCLE"], [10, 1], [20, 0.5], [40, 0.25]],
        [[9, "$INSUNITS"], [70, 1]],
      ),
    );
    expect(r.unit).toBe("inch");
    expect(r.scale).toBe(25.4);
    expect(r.warnings).toEqual([]);
    expect(r.bounds!.minX).toBeCloseTo(0, 12);
    expect(r.bounds!.minY).toBeCloseTo(0, 12);
    expect(r.bounds!.maxX).toBeCloseTo(50.8, 12);
    expect(r.bounds!.maxY).toBeCloseTo(25.4, 12);
    const circle = entity(r.sketch, r.created[4]!, "circle");
    expect(circle.radius).toBeCloseTo(6.35, 12);
    expect(getPoint(r.sketch, circle.center).x).toBeCloseTo(25.4, 12);
    const regions = detectProfiles(r.sketch);
    const total = regions.reduce((sum, region) => sum + region.area, 0);
    expect(total).toBeCloseTo(50.8 * 25.4, 6);
  });

  it("converts centimetres and metres", () => {
    expect(importText(file(line(0, 0, 2, 0), [[9, "$INSUNITS"], [70, 5]])).bounds!.maxX).toBeCloseTo(20, 12);
    expect(importText(file(line(0, 0, 2, 0), [[9, "$INSUNITS"], [70, 6]])).bounds!.maxX).toBeCloseTo(2000, 12);
  });

  it("uses assumeUnit for unitless files", () => {
    const text = dxf([...entitiesSection(lwRect(2, 1)), [0, "EOF"]]);
    const mm = importText(text);
    expect(mm.unit).toBe("mm");
    expect(mm.scale).toBe(1);
    expect(mm.bounds).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 });
    expect(mm.warnings).toHaveLength(1);
    expect(mm.warnings[0]).toMatch(/millimetres were assumed/);

    const inch = importText(text, { assumeUnit: "inch" });
    expect(inch.unit).toBe("inch");
    expect(inch.scale).toBe(25.4);
    expect(inch.bounds!.maxX).toBeCloseTo(50.8, 12);
    expect(inch.bounds!.maxY).toBeCloseTo(25.4, 12);
    expect(inch.warnings[0]).toMatch(/inches were assumed/);

    // assumeUnit does not override a unit of the file.
    const known = importText(file(lwRect(2, 1)), { assumeUnit: "inch" });
    expect(known.unit).toBe("mm");
    expect(known.bounds!.maxX).toBe(2);
  });

  it("overrides the unit of the file with forceUnit", () => {
    const r = importText(file(lwRect(2, 1)), { forceUnit: "inch" });
    expect(r.unit).toBe("inch");
    expect(r.scale).toBe(25.4);
    expect(r.bounds!.maxX).toBeCloseTo(50.8, 12);
    expect(r.warnings).toEqual([]);
    const cm = importText(dxf([...entitiesSection(lwRect(2, 1)), [0, "EOF"]]), {
      forceUnit: "cm",
      assumeUnit: "inch",
    });
    expect(cm.unit).toBe("cm");
    expect(cm.bounds!.maxX).toBeCloseTo(20, 12);
  });

  it("applies the offset after scaling", () => {
    const r = importText(file(lwRect(2, 1), [[9, "$INSUNITS"], [70, 1]]), { offset: { x: -25.4, y: 10 } });
    expect(r.bounds!.minX).toBeCloseTo(-25.4, 12);
    expect(r.bounds!.maxX).toBeCloseTo(25.4, 12);
    expect(r.bounds!.minY).toBeCloseTo(10, 12);
    expect(r.bounds!.maxY).toBeCloseTo(35.4, 12);
  });

  it("turns layers into construction geometry and filters layers", () => {
    const text = file([
      ...lwRect(10, 10, "Cut"),
      ...line(0, 5, 10, 5, "Centre"),
      [0, "CIRCLE"],
      [8, "Notes"],
      [10, 5],
      [20, 5],
      [40, 1],
    ]);
    const r = importText(text, { constructionLayers: ["Centre"] });
    expect(r.created).toHaveLength(6);
    const byLayer = (layer: string) =>
      r.created.filter((id) => r.layerOf[id] === layer).map((id) => r.sketch.entities[id]!);
    expect(byLayer("Cut")).toHaveLength(4);
    expect(byLayer("Cut").every((e) => e.construction !== true)).toBe(true);
    expect(byLayer("Centre")).toHaveLength(1);
    expect(byLayer("Centre")[0]!.construction).toBe(true);
    expect(byLayer("Notes")[0]!.construction).toBeUndefined();
    // Construction geometry does not split the profile.
    expect(detectProfiles(r.sketch).map((region) => region.area).sort((a, b) => a - b)).toHaveLength(2);

    const filtered = importText(text, { layers: ["Cut", "Centre"], constructionLayers: ["Centre"] });
    expect(filtered.created).toHaveLength(5);
    expect(new Set(Object.values(filtered.layerOf))).toEqual(new Set(["Cut", "Centre"]));
    expect(detectProfiles(filtered.sketch)).toHaveLength(1);

    const none = importText(text, { layers: ["Missing"] });
    expect(none.created).toEqual([]);
    expect(none.bounds).toBeNull();
    expect(none.warnings.join(" ")).toMatch(/selected layers/);
  });

  it("imports mirrored entities (extrusion direction −Z)", () => {
    const r = importText(
      file([
        [0, "ARC"],
        [10, -10],
        [20, 0],
        [40, 5],
        [50, 0],
        [51, 90],
        [210, 0],
        [220, 0],
        [230, -1],
        [0, "CIRCLE"],
        [10, 3],
        [20, 4],
        [40, 1],
        [210, 0],
        [220, 0],
        [230, -1],
      ]),
    );
    const arc = entity(r.sketch, r.created[0]!, "arc");
    // World centre (10, 0); the arc covers 90° … 180°: from (10,5) to (5,0), counter-clockwise.
    expect(getPoint(r.sketch, arc.center).x).toBeCloseTo(10, 12);
    expect(getPoint(r.sketch, arc.start).x).toBeCloseTo(10, 12);
    expect(getPoint(r.sketch, arc.start).y).toBeCloseTo(5, 12);
    expect(getPoint(r.sketch, arc.end).x).toBeCloseTo(5, 12);
    expect(getPoint(r.sketch, arc.end).y).toBeCloseTo(0, 12);
    const curve = entityToCurves(r.sketch, arc)[0]!;
    expect(curve.type === "arc" && curve.sweep).toBeCloseTo(Math.PI / 2, 12);
    const circle = entity(r.sketch, r.created[1]!, "circle");
    expect(getPoint(r.sketch, circle.center).x).toBeCloseTo(-3, 12);
    expect(getPoint(r.sketch, circle.center).y).toBeCloseTo(4, 12);
  });

  it("imports CRLF files", () => {
    const text = dxf(
      [...header([[9, "$INSUNITS"], [70, 4]]), ...entitiesSection(lwRect(6, 4)), [0, "EOF"]],
      "\r\n",
    );
    const r = importText(text);
    expect(r.created).toHaveLength(4);
    expect(detectProfiles(r.sketch)[0]!.area).toBeCloseTo(24, 9);
  });

  it("shares end points within the tolerance", () => {
    // Four separate lines whose ends differ by rounding.
    const text = file([
      ...line(0, 0, 10, 0),
      ...line(10.00004, 0.00003, 10, 5),
      ...line(10, 5.00005, 0, 5),
      ...line(0.00002, 4.99996, 0, -0.00003),
    ]);
    const r = importText(text);
    expect(r.created).toHaveLength(4);
    const lines = r.created.map((id) => entity(r.sketch, id, "line"));
    for (let i = 0; i < 4; i++) expect(lines[i]!.p2).toBe(lines[(i + 1) % 4]!.p1);
    expect(Object.values(r.sketch.entities).filter((e) => e.type === "point")).toHaveLength(4);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(50, 3);

    // With a smaller tolerance the ends stay apart and nothing is closed.
    const apart = importText(text, { mergeTolerance: 1e-6 });
    expect(Object.values(apart.sketch.entities).filter((e) => e.type === "point")).toHaveLength(8);
    expect(detectProfiles(apart.sketch, { tolerance: 1e-6 })).toHaveLength(0);
    // Profile detection itself joins ends closer than 1e-4 mm.
    expect(detectProfiles(apart.sketch)).toHaveLength(1);

    // A gap larger than the tolerance is not closed.
    const gap = importText(file([...line(0, 0, 10, 0), ...line(10.001, 0, 10, 5)]));
    expect(Object.values(gap.sketch.entities).filter((e) => e.type === "point")).toHaveLength(4);
  });

  it("closes outlines of lines and arcs whose ends are rounded", () => {
    // D shape: a line and a half circle given with four decimals.
    const r = importText(
      file([
        ...line(3.3333, 1.1111, 3.3333, 21.1111),
        [0, "ARC"],
        [10, 3.3333],
        [20, 11.1111],
        [40, 10.00004],
        [50, 270.0002],
        [51, 89.9998],
      ]),
    );
    const arc = entity(r.sketch, r.created[1]!, "arc");
    const l = entity(r.sketch, r.created[0]!, "line");
    expect(arc.start).toBe(l.p1);
    expect(arc.end).toBe(l.p2);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo((Math.PI * 100) / 2, 2);
  });

  it("skips degenerate entities with a warning", () => {
    const r = importText(
      file([
        ...line(1, 1, 1, 1),
        [0, "CIRCLE"],
        [10, 0],
        [20, 0],
        [40, 0],
        [0, "ARC"],
        [10, 0],
        [20, 0],
        [40, 0],
        [50, 0],
        [51, 90],
        ...line(0, 0, 5, 0),
      ]),
    );
    expect(r.created).toHaveLength(1);
    expect(r.warnings).toEqual(["3 degenerate entities (zero length or zero radius) were skipped."]);
    expect(Object.values(r.sketch.entities).filter((e) => e.type === "point")).toHaveLength(2);
  });

  it("does not mutate the input sketch and keeps its entities", () => {
    const b = new SketchBuilder(emptySketch());
    const origin = b.point(0, 0);
    const existing = b.line(origin, { x: 10, y: 0 });
    b.constrain("horizontal", existing);
    b.dimension("distance", [existing], "10");
    const input = b.build();
    const snapshot = JSON.parse(JSON.stringify(input)) as Sketch;
    const frozen = Object.freeze({
      ...input,
      entities: Object.freeze({ ...input.entities }),
      constraints: Object.freeze({ ...input.constraints }),
      dimensions: Object.freeze({ ...input.dimensions }),
    }) as Sketch;

    // The imported rectangle starts on the end point of the existing line.
    const r = importDxfIntoSketch(frozen, parseDxf(file([...line(10, 0, 10, 5), ...line(10, 5, 0, 0)])));
    expect(JSON.parse(JSON.stringify(frozen))).toEqual(snapshot);
    expect(r.sketch).not.toBe(frozen);
    expect(r.sketch.nextId).toBeGreaterThan(input.nextId);
    for (const [id, e] of Object.entries(input.entities)) expect(r.sketch.entities[id]).toEqual(e);
    expect(r.sketch.constraints).toEqual(input.constraints);
    expect(r.sketch.dimensions).toEqual(input.dimensions);
    expect(r.created).toHaveLength(2);
    // New ids only, and existing points are not reused.
    const ids = new Set(Object.keys(input.entities));
    for (const id of r.created) {
      expect(ids.has(id)).toBe(false);
      const l = entity(r.sketch, id, "line");
      expect(ids.has(l.p1)).toBe(false);
      expect(ids.has(l.p2)).toBe(false);
    }
    expect(listCurves(r.sketch)).toHaveLength(3);
  });
});

// --- round trip ------------------------------------------------------------------------------

describe("round trip through renderCurvesDxf", () => {
  const build = (): { sketch: Sketch; ids: string[] } => {
    const b = new SketchBuilder(emptySketch());
    const p1 = b.point(0, 0);
    const p2 = b.point(40, 0);
    const p3 = b.point(40, 20);
    const p4 = b.point(0, 20);
    const ids = [
      b.line(p1, p2),
      // Half circle on the right, counter-clockwise from (40,0) to (40,20).
      b.arc({ x: 40, y: 10 }, p2, p3),
      b.line(p3, p4),
      b.line(p4, p1),
      b.circle({ x: 15.5, y: 10.25 }, 4.125),
      // An arc crossing 0°.
      b.arc({ x: -20, y: -20 }, { x: -20 + 6 * Math.cos(-0.5), y: -20 + 6 * Math.sin(-0.5) }, {
        x: -20 + 6 * Math.cos(1.2),
        y: -20 + 6 * Math.sin(1.2),
      }),
    ];
    return { sketch: b.build(), ids };
  };

  const curvesOf = (sketch: Sketch, ids: readonly string[]): Curve2[] =>
    ids.flatMap((id) => {
      const e = sketch.entities[id];
      return isCurve(e) ? entityToCurves(sketch, e) : [];
    });

  it("keeps the geometry of lines, arcs and circles", () => {
    const source = build();
    const text = renderCurvesDxf(
      source.ids.map((id) => ({ curves: curvesOf(source.sketch, [id]) })),
      { precision: 6, layer: "Sketch", color: 3 },
    );
    const drawing = parseDxf(text);
    expect(drawing.units).toBe("mm");
    expect(drawing.layers).toEqual([{ name: "Sketch", color: 3 }]);
    expect(drawing.skipped).toEqual({});
    expect(drawing.warnings).toEqual([]);
    expect(drawing.entities.map((e) => e.type)).toEqual(["line", "arc", "line", "line", "circle", "arc"]);

    const r = importDxfIntoSketch(emptySketch(), drawing);
    expect(r.warnings).toEqual([]);
    expect(r.scale).toBe(1);
    expect(r.created).toHaveLength(source.ids.length);
    expect(r.created.map((id) => r.sketch.entities[id]!.type)).toEqual(
      source.ids.map((id) => source.sketch.entities[id]!.type),
    );
    expect(Object.values(r.layerOf).every((layer) => layer === "Sketch")).toBe(true);

    const before = curvesOf(source.sketch, source.ids);
    const after = curvesOf(r.sketch, r.created);
    expect(after).toHaveLength(before.length);
    before.forEach((c, i) => {
      const d = after[i]!;
      expect(d.type).toBe(c.type);
      if (c.type === "arc" && d.type === "arc") {
        expect(d.radius).toBeCloseTo(c.radius, 5);
        expect(d.center.x).toBeCloseTo(c.center.x, 5);
        expect(d.center.y).toBeCloseTo(c.center.y, 5);
        expect(d.sweep).toBeCloseTo(c.sweep, 5);
      }
      const full = c.type === "arc" && Math.abs(c.sweep) >= 2 * Math.PI - 1e-9;
      if (!full) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const p = curvePointAt(c, t);
          const q = curvePointAt(d, t);
          expect(q.x).toBeCloseTo(p.x, 5);
          expect(q.y).toBeCloseTo(p.y, 5);
        }
      }
    });

    // The outline is still one closed profile with the circle as a hole.
    const areas = (s: Sketch) =>
      detectProfiles(s)
        .map((region) => region.area)
        .sort((a, b) => a - b);
    const expected = areas(source.sketch);
    const actual = areas(r.sketch);
    expect(actual).toHaveLength(expected.length);
    expected.forEach((a, i) => expect(actual[i]!).toBeCloseTo(a, 3));
    // Shared corner points survive the round trip.
    const l1 = entity(r.sketch, r.created[0]!, "line");
    const arc = entity(r.sketch, r.created[1]!, "arc");
    const l2 = entity(r.sketch, r.created[2]!, "line");
    const l3 = entity(r.sketch, r.created[3]!, "line");
    expect(arc.start).toBe(l1.p2);
    expect(arc.end).toBe(l2.p1);
    expect(l3.p1).toBe(l2.p2);
    expect(l3.p2).toBe(l1.p1);
  });

  it("closes the profile with the default precision of the writer", () => {
    const source = build();
    const text = renderCurvesDxf([{ curves: curvesOf(source.sketch, source.ids.slice(0, 4)) }]);
    const r = importText(text);
    expect(r.created).toHaveLength(4);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(40 * 20 + (Math.PI * 100) / 2, 3);
    expect(r.bounds!.maxX).toBeCloseTo(50, 3);
  });

  it("reads the polylines written for ellipses and splines", () => {
    const b = new SketchBuilder(emptySketch());
    const ellipse = b.ellipse({ x: 0, y: 0 }, { x: 20, y: 0 }, 10);
    const spline = b.spline("fit", [
      { x: 30, y: 0 },
      { x: 40, y: 10 },
      { x: 50, y: 0 },
    ]);
    const sketch = b.build();
    const text = renderCurvesDxf([
      { curves: curvesOf(sketch, [ellipse]) },
      { curves: curvesOf(sketch, [spline]) },
    ]);
    const drawing = parseDxf(text);
    expect(drawing.entities.map((e) => e.type)).toEqual(["polyline", "polyline"]);
    expect(drawing.entities[0]!.type === "polyline" && drawing.entities[0]!.closed).toBe(true);
    expect(drawing.entities[1]!.type === "polyline" && drawing.entities[1]!.closed).toBe(false);
    const r = importDxfIntoSketch(emptySketch(), drawing);
    expect(r.created.every((id) => r.sketch.entities[id]!.type === "line")).toBe(true);
    const regions = detectProfiles(r.sketch);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * 20 * 10, 0);
    expect(r.bounds!.minX).toBeCloseTo(-20, 3);
    expect(r.bounds!.maxX).toBeCloseTo(50, 3);
  });
});
