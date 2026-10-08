/**
 * Benchmark models for recompute: a row of overlapping boxes, each with a fillet, a cut hole,
 * a pattern of that hole and a union into the first box. `benchmarkDocument(n)` has exactly n
 * timeline steps (a unit is cut off where n ends).
 *
 *   npx vite-node apps/fabcad/bench/makeModels.ts <out-dir>
 */
import {
  type CadDocument,
  type CreatedRef,
  addBoolean,
  addExtrude,
  addFillet,
  addRectangularPattern,
  addSketch,
  createDocument,
  updateSketch,
} from "@fabcad/cad-document";
import {
  type ProfileRef,
  type SketchBuilder,
  createCircle,
  createRectangle2Point,
  detectProfiles,
  editSketch,
  profileRefOf,
  regionAtPoint,
} from "@fabcad/sketch";

const PITCH = 35;
const W = 40;
const D = 30;
const H = 10;

export function benchmarkDocument(steps: number): CadDocument {
  let doc = createDocument(`Benchmark ${steps}`);
  const apply = (cmd: { apply(d: CadDocument): CadDocument }): void => {
    doc = cmd.apply(doc);
  };
  const done = (): boolean => doc.timeline.length >= steps;

  const sketch = (draw: (b: SketchBuilder) => void): string => {
    const s: CreatedRef = {};
    apply(addSketch({ type: "origin", plane: "XY" }, s));
    apply(updateSketch(s.id!, "Draw", (sk) => editSketch(sk, draw)));
    return s.id!;
  };
  const profileAt = (sketchId: string, x: number, y: number): ProfileRef => {
    const f = doc.features[sketchId];
    if (f?.type !== "sketch") throw new Error("not a sketch");
    const region = regionAtPoint(detectProfiles(f.sketch), { x, y });
    if (!region) throw new Error(`no profile at ${x}, ${y}`);
    return profileRefOf(region);
  };

  let main: string | null = null;
  for (let k = 0; !done(); k++) {
    const x0 = k * PITCH;
    const rect = sketch((b) => void createRectangle2Point(b, { x: x0, y: 0 }, { x: x0 + W, y: D }));
    if (done()) break;
    const box: CreatedRef = {};
    apply(addExtrude({ sketchId: rect, profiles: [profileAt(rect, x0 + W / 2, D / 2)], distance: String(H) }, box));
    if (!box.bodyId) throw new Error(`extrude ${k} failed`);
    if (done()) break;
    // The vertical edge at the far corner, found by its position.
    apply(addFillet({ bodyId: box.bodyId, edges: [{ kind: "edge", point: { x: x0 + W, y: D, z: H / 2 } }], radius: "2" }));
    if (done()) break;
    const hole = sketch((b) => void createCircle(b, { x: x0 + 8, y: D / 2 }, 3));
    if (done()) break;
    const cut: CreatedRef = {};
    apply(
      addExtrude(
        { sketchId: hole, profiles: [profileAt(hole, x0 + 8, D / 2)], distance: String(H), operation: "cut", targetBodyIds: [box.bodyId] },
        cut,
      ),
    );
    if (done()) break;
    apply(
      addRectangularPattern({
        source: { kind: "features", featureIds: [cut.id!] },
        direction: { type: "origin-axis", axis: "X" },
        count: "3",
        distance: "10",
      }),
    );
    if (done()) break;
    if (main === null) main = box.bodyId;
    else apply(addBoolean({ operation: "union", targetBodyId: main, toolBodyIds: [box.bodyId] }));
  }
  if (doc.timeline.length !== steps) throw new Error(`made ${doc.timeline.length} steps, not ${steps}`);
  return doc;
}
