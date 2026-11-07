import { beforeAll, describe, expect, it } from "vitest";
import {
  type CadDocument,
  type CreatedRef,
  DocumentStore,
  addParameter,
  createDocument,
  updateFeature,
} from "@fabcad/cad-document";
import { FeatureEngine } from "@fabcad/features";
import type { GeometryKernel } from "@fabcad/brep";
import { createDefaultSolver } from "@fabcad/sketch-solver";
import { nodeKernel } from "../../../packages/brep/test/nodeKernel";
import { hasHelp } from "../src/help/content";
import {
  KIDS_GUIDE,
  KIDS_TOOLS,
  type KidsContext,
  type KidsStateView,
  UI_MODE_KEY,
  kidsContext,
  kidsGuide,
  kidsTools,
  loadUiMode,
  saveUiMode,
  stepValue,
} from "../src/kids/kidsModel";
import { kidsShapeCommand, nextShapeSpot } from "../src/kids/presets";
import { sizeFields } from "../src/kids/sizeFields";

const solver = createDefaultSolver();
let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await nodeKernel();
});

const memoryStorage = (): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

const view = (patch: Partial<KidsStateView> = {}): KidsStateView => ({
  workspace: "design",
  activeSketchId: null,
  selection: [],
  dialog: null,
  kidsPanel: null,
  ...patch,
});

/** Only hiragana, katakana, the long vowel mark, punctuation and spaces: words a 6-year-old reads. */
const KANA = /^[\u3040-\u309f\u30a0-\u30ff\u3000-\u303f\uff01-\uff5e ー！？、。「」−]+$/u;

describe("ui mode in this browser", () => {
  it("is standard until Kids Mode is chosen, and remembers the choice", () => {
    const storage = memoryStorage();
    expect(loadUiMode(storage)).toBe("standard");
    expect(saveUiMode(storage, "kids")).toBe(true);
    expect(storage.data.get(UI_MODE_KEY)).toBe("kids");
    expect(loadUiMode(storage)).toBe("kids");
    saveUiMode(storage, "standard");
    expect(loadUiMode(storage)).toBe("standard");
  });

  it("falls back to standard when the storage is missing, blocked or holds something else", () => {
    expect(loadUiMode(null)).toBe("standard");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadUiMode(blocked)).toBe("standard");
    expect(saveUiMode(blocked, "kids")).toBe(false);
    const odd = memoryStorage();
    odd.setItem(UI_MODE_KEY, "KIDS!");
    expect(loadUiMode(odd)).toBe("standard");
  });
});

describe("what the kids toolbar shows", () => {
  it("reads the context from the state the app already has", () => {
    expect(kidsContext(view())).toBe("idle");
    expect(kidsContext(view({ selection: [{ kind: "body" }] }))).toBe("selected");
    expect(kidsContext(view({ selection: [{ kind: "face" }] }))).toBe("selected");
    // Without a body to size, the size panel is not shown.
    expect(kidsContext(view({ kidsPanel: "size" }))).toBe("idle");
    expect(kidsContext(view({ kidsPanel: "size", selection: [{ kind: "body" }] }))).toBe("size");
    expect(kidsContext(view({ kidsPanel: "shapes" }))).toBe("shapes");
    expect(kidsContext(view({ activeSketchId: "s1" }))).toBe("sketch");
    expect(kidsContext(view({ dialog: { type: "extrude" } }))).toBe("extrude");
    expect(kidsContext(view({ dialog: { type: "move" }, kidsPanel: "rotate" }))).toBe("rotate");
    expect(kidsContext(view({ dialog: { type: "move" } }))).toBe("move");
    expect(kidsContext(view({ dialog: { type: "fillet" } }))).toBe("other");
    expect(kidsContext(view({ workspace: "fabrication", selection: [{ kind: "body" }] }))).toBe("unfold");
  });

  it("shows only the basic tools for each state", () => {
    expect(kidsTools("idle", false)).toEqual(["shapes", "draw", "unfold"]);
    expect(kidsTools("idle", true)).toEqual(["shapes", "draw", "extrude", "unfold"]);
    expect(kidsTools("shapes", false)).toEqual(["box", "cylinder", "ball", "cancel"]);
    expect(kidsTools("selected", false)).toEqual(["move", "rotate", "size", "delete", "cancel"]);
    expect(kidsTools("sketch", false)).toEqual(["line", "rectangle", "circle", "extrude", "finish"]);
    expect(kidsTools("unfold", false)).toEqual(["back"]);
    // A command window has its own buttons.
    for (const c of ["extrude", "move", "rotate", "size", "other"] as KidsContext[]) {
      expect(kidsTools(c, true)).toEqual([]);
    }
  });

  it("labels every tool with a picture and kana words, and has help for it", () => {
    for (const [id, t] of Object.entries(KIDS_TOOLS)) {
      expect(t.icon, id).not.toBe("");
      expect(t.label, id).toMatch(KANA);
      expect(hasHelp(t.help), `${id}: ${t.help}`).toBe(true);
    }
    expect(hasHelp("ui.kids")).toBe(true);
    expect(hasHelp("solid.sphere")).toBe(true);
  });
});

describe("guide line", () => {
  const base = { context: "idle" as KidsContext, bodies: 1, drawing: false, notice: null, problem: false };

  it("follows what the child is doing", () => {
    expect(kidsGuide(base)).toBe("つくりたい かたちを えらんでね");
    expect(kidsGuide({ ...base, bodies: 0 })).toBe(KIDS_GUIDE.empty);
    expect(kidsGuide({ ...base, context: "selected" })).toBe("なにを する？");
    expect(kidsGuide({ ...base, context: "move" })).toBe(KIDS_GUIDE.move);
    expect(kidsGuide({ ...base, context: "extrude" })).toBe("たかさを きめよう");
    expect(kidsGuide({ ...base, context: "sketch", drawing: true })).toBe(KIDS_GUIDE.sketchTool);
    expect(kidsGuide({ ...base, context: "other" })).toBe("これは おとなモードで へんしゅうできるよ");
  });

  it("puts what just happened and problems first", () => {
    expect(kidsGuide({ ...base, context: "selected", notice: "made" })).toBe("かたちが できたよ！");
    expect(kidsGuide({ ...base, notice: "saved" })).toBe("ほぞん できたよ！");
    expect(kidsGuide({ ...base, notice: "saved", problem: true })).toBe("もういちど やってみよう");
    expect(kidsGuide({ ...base, context: "extrude", notice: "made" })).toBe("たかさを きめよう");
  });

  it("speaks in kana", () => {
    for (const text of Object.values(KIDS_GUIDE)) expect(text).toMatch(KANA);
  });
});

describe("+ and − buttons", () => {
  it("step plain numbers to round values without losing precision elsewhere", () => {
    expect(stepValue("20", 5)).toBe("25");
    expect(stepValue("20", -5)).toBe("15");
    expect(stepValue("12.5", 5)).toBe("15");
    expect(stepValue("12.5", -5)).toBe("10");
    expect(stepValue("7", -10)).toBe("0");
    expect(stepValue("-3", 15)).toBe("0");
    expect(stepValue("20", 0)).toBe("20");
    expect(stepValue("0.1", 0.05)).toBe("0.15");
  });

  it("stop at the minimum", () => {
    expect(stepValue("3", -5, 1)).toBe("1");
    expect(stepValue("1", -5, 1)).toBe("1");
    expect(stepValue("180", 15, -180)).toBe("195");
  });

  it("leave expressions to the normal screen", () => {
    expect(stepValue("width / 2", 5)).toBeNull();
    expect(stepValue("10 mm", 5)).toBeNull();
    expect(stepValue("", 5)).toBeNull();
  });
});

describe("shapes", () => {
  const make = (doc: CadDocument, shape: "box" | "cylinder" | "ball", at = { x: 0, y: 0 }) => {
    const store = new DocumentStore(doc);
    const out: CreatedRef = {};
    expect(store.execute(kidsShapeCommand(shape, solver, { at }, out))).toBe(true);
    return { store, out };
  };

  it("are ordinary history in one undo step, and the engine builds them", async () => {
    for (const shape of ["box", "cylinder", "ball"] as const) {
      const { store, out } = make(createDocument(), shape, { x: 30, y: 0 });
      const doc = store.document;
      const feature = doc.features[out.id!]!;
      expect(feature.type).toBe(shape === "ball" ? "sphere" : "extrude");
      expect(doc.timeline).toHaveLength(shape === "ball" ? 1 : 2);
      expect(doc.bodies[out.bodyId!]?.createdBy).toBe(out.id);

      const result = await new FeatureEngine(kernel, solver).recompute(doc);
      for (const f of Object.values(result.features)) expect(f.state, `${shape} ${f.id}`).toBe("ok");
      const g = result.bodies.find((b) => b.id === out.bodyId)!.geometry!;
      expect(g.bounds.min.z).toBeCloseTo(0, 4);
      expect(g.bounds.max.z).toBeCloseTo(20, 4);
      expect((g.bounds.min.x + g.bounds.max.x) / 2).toBeCloseTo(30, 4);

      store.undo();
      expect(store.document.timeline).toHaveLength(0);
      expect(Object.keys(store.document.bodies)).toHaveLength(0);
    }
  });

  it("keep their sketch solved, dimensioned and hidden", () => {
    const { store, out } = make(createDocument(), "box");
    const extrude = store.document.features[out.id!]!;
    if (extrude.type !== "extrude") throw new Error("not an extrude");
    const sketch = store.document.features[extrude.sketchId]!;
    if (sketch.type !== "sketch") throw new Error("not a sketch");
    expect(sketch.visible).toBe(false);
    expect(Object.values(sketch.sketch.dimensions).map((d) => d.expression)).toEqual(["20", "20"]);
    expect(sizeFields(store.document, out.bodyId!).fields.map((f) => [f.label, f.expression])).toEqual([
      ["よこ", "20"],
      ["たて", "20"],
      ["たかさ", "20"],
    ]);
  });

  it("go next to what is there", () => {
    expect(nextShapeSpot(null)).toEqual({ x: 0, y: 0 });
    expect(nextShapeSpot(10)).toEqual({ x: 30, y: 0 });
    expect(nextShapeSpot(31)).toEqual({ x: 55, y: 0 });
  });
});

describe("size panel", () => {
  it("offers the diameter of a ball and the sizes of a cylinder", () => {
    const ball = (() => {
      const store = new DocumentStore(createDocument());
      const out: CreatedRef = {};
      store.execute(kidsShapeCommand("ball", solver, { at: { x: 0, y: 0 } }, out));
      return sizeFields(store.document, out.bodyId!);
    })();
    expect(ball).toEqual({
      fields: [{ kind: "feature", featureId: expect.any(String), key: "diameter", label: "ふとさ", expression: "20" }],
      limited: false,
    });
    const store = new DocumentStore(createDocument());
    const out: CreatedRef = {};
    store.execute(kidsShapeCommand("cylinder", solver, { at: { x: 0, y: 0 } }, out));
    expect(sizeFields(store.document, out.bodyId!).fields.map((f) => f.label)).toEqual(["ふとさ", "たかさ"]);
  });

  it("leaves sizes made of parameters to the normal screen", () => {
    const store = new DocumentStore(createDocument());
    store.execute(addParameter({ name: "h", expression: "30", unit: "mm" }));
    const out: CreatedRef = {};
    store.execute(kidsShapeCommand("box", solver, { at: { x: 0, y: 0 } }, out));
    store.execute(updateFeature(out.id!, { distance: "h" }));
    const { fields, limited } = sizeFields(store.document, out.bodyId!);
    expect(fields.map((f) => f.label)).toEqual(["よこ", "たて"]);
    expect(limited).toBe(true);
    expect(sizeFields(store.document, "nothing")).toEqual({ fields: [], limited: true });
  });
});
