import { type Sketch, SketchBuilder, createSketch, entityToCurves, getPoint } from "@fabcad/sketch";
import { describe, expect, it } from "vitest";
import { editableNodes } from "../src/sketch/nodeEdit";

const blank = (): Sketch => createSketch("outline", "Outline", { type: "origin", plane: "XY" });

describe("Node Edit", () => {
  it("treats cubic endpoints as shared anchors and inner controls as handles", () => {
    const b = new SketchBuilder(blank());
    const start = b.point(0, 0);
    const left = b.point(1, 4);
    const right = b.point(7, 4);
    const end = b.point(8, 0);
    const spline = b.spline("control", [start, left, right, end]);
    b.line(end, start);
    const sketch = b.build();

    const nodes = editableNodes(sketch);
    expect(nodes.get(start)).toBe("anchor");
    expect(nodes.get(end)).toBe("anchor");
    expect(nodes.get(left)).toBe("handle");
    expect(nodes.get(right)).toBe("handle");
    expect(nodes.size).toBe(4);

    const before = entityToCurves(sketch, sketch.entities[spline]!)[0]!;
    const edit = new SketchBuilder(sketch);
    edit.movePoint(right, { x: 6.5, y: 6 });
    const changed = edit.build();
    const after = entityToCurves(changed, changed.entities[spline]!)[0]!;
    expect(after.type).toBe("bezier");
    expect(after).not.toEqual(before);
    expect(getPoint(changed, start)).toEqual(getPoint(sketch, start));
    expect(getPoint(changed, end)).toEqual(getPoint(sketch, end));
    expect(editableNodes(JSON.parse(JSON.stringify(changed)) as Sketch)).toEqual(nodes);
  });

  it("does not offer node editing for projected geometry or unrelated origin points", () => {
    const b = new SketchBuilder(blank());
    const a = b.point(0, 0);
    const z = b.point(5, 0);
    const line = b.line(a, z);
    const sketch = b.build();
    const projected: Sketch = {
      ...sketch,
      projections: [
        { id: "ref1", mode: "project", bodyId: "body1", hint: { x: 0, y: 0, z: 0 }, entityIds: [line] },
      ],
    };
    expect(editableNodes(projected).size).toBe(0);
    expect(editableNodes(blank()).size).toBe(0);
  });
});
