/**
 * Kids Mode as plain functions of the app state that already exists: which buttons show, and
 * what the guide says. Kids Mode keeps no selection or editing state of its own.
 */

export type UiMode = "standard" | "kids";

/** What the child is doing, read from `appState`. */
export type KidsContext =
  | "idle"
  | "selected"
  | "sketch"
  | "extrude"
  | "move"
  | "rotate"
  | "sphere"
  | "size"
  | "shapes"
  | "unfold"
  /** A dialog that Kids Mode has no simple screen for. */
  | "other";

/** The part of `appState` the context is read from. */
export interface KidsStateView {
  workspace: "design" | "fabrication";
  activeSketchId: string | null;
  selection: readonly { kind: string }[];
  dialog: { type: string; mode?: string } | null;
  kidsPanel: KidsPanel | null;
}

/**
 * Kids Mode panels: the row of shapes, the size of the selected body, and which of the two
 * buttons opened the Move dialog (both use its free mode; the panel shows either the
 * distances or the angles).
 */
export type KidsPanel = "shapes" | "size" | "move" | "rotate";

export function kidsContext(s: KidsStateView): KidsContext {
  if (s.workspace === "fabrication") return "unfold";
  if (s.dialog) {
    switch (s.dialog.type) {
      case "extrude":
        return "extrude";
      case "sphere":
        return "sphere";
      case "move":
        return s.kidsPanel === "rotate" ? "rotate" : "move";
      default:
        return "other";
    }
  }
  if (s.activeSketchId) return "sketch";
  if (s.kidsPanel === "shapes") return "shapes";
  const body = s.selection.some((x) => x.kind === "body" || x.kind === "face" || x.kind === "edge");
  if (!body) return "idle";
  return s.kidsPanel === "size" ? "size" : "selected";
}

export type KidsTool =
  | "shapes"
  | "draw"
  | "extrude"
  | "unfold"
  | "move"
  | "rotate"
  | "size"
  | "delete"
  | "line"
  | "rectangle"
  | "circle"
  | "finish"
  | "back"
  | "box"
  | "cylinder"
  | "ball"
  | "cancel";

/** Buttons of the toolbar. Undo, redo, save and open are always in the header. */
export function kidsTools(context: KidsContext, hasSketch: boolean): KidsTool[] {
  switch (context) {
    case "idle":
      return hasSketch ? ["shapes", "draw", "extrude", "unfold"] : ["shapes", "draw", "unfold"];
    case "selected":
      return ["move", "rotate", "size", "delete", "cancel"];
    case "sketch":
      return ["line", "rectangle", "circle", "extrude", "finish"];
    case "shapes":
      return ["box", "cylinder", "ball", "cancel"];
    case "unfold":
      return ["back"];
    default:
      // A command window is open: it has its own buttons.
      return [];
  }
}

export interface KidsToolLabel {
  label: string;
  icon: string;
  /** Help topic shown on long press / right click. */
  help: string;
}

export const KIDS_TOOLS: Record<KidsTool, KidsToolLabel> = {
  shapes: { label: "かたちを つくる", icon: "shapes", help: "ui.kids" },
  draw: { label: "おえかき", icon: "pencil", help: "solid.pick-sketch-plane" },
  extrude: { label: "たかくする", icon: "extrude", help: "solid.extrude" },
  unfold: { label: "てんかいず", icon: "unfold", help: "fabrication.laser" },
  move: { label: "うごかす", icon: "move-3d", help: "solid.move" },
  rotate: { label: "まわす", icon: "revolve", help: "solid.move" },
  size: { label: "おおきさ", icon: "scale", help: "ui.kids" },
  delete: { label: "けす", icon: "trash", help: "ui.kids" },
  line: { label: "せん", icon: "line", help: "sketch.line" },
  rectangle: { label: "しかく", icon: "rectangle-2point", help: "sketch.rectangle-2point" },
  circle: { label: "まる", icon: "circle", help: "sketch.circle" },
  finish: { label: "おわる", icon: "finish", help: "ui.kids" },
  back: { label: "かたちに もどる", icon: "back", help: "ui.kids" },
  box: { label: "はこ", icon: "box", help: "ui.kids" },
  cylinder: { label: "つつ", icon: "cylinder", help: "ui.kids" },
  ball: { label: "たま", icon: "sphere", help: "solid.sphere" },
  cancel: { label: "やめる", icon: "close", help: "ui.kids" },
};

/** Something that just happened, shown by the guide for a moment. */
export type KidsNotice = "made" | "saved" | "deleted";

/** Messages of the guide line. */
export const KIDS_GUIDE = {
  idle: "つくりたい かたちを えらんでね",
  empty: "「かたちを つくる」を おしてみよう",
  selected: "なにを する？",
  sketch: "ゆびや マウスで えを かこう。かけたら「たかくする」",
  sketchTool: "てん を じゅんばんに おしてね",
  extrude: "たかさを きめよう",
  move: "やじるしを ドラッグして うごかそう",
  rotate: "＋ と − で まわそう",
  sphere: "おおきさを きめよう",
  shapes: "どの かたちに する？",
  size: "＋ と − で おおきさを かえよう",
  unfold: "ひらいた かたちだよ",
  other: "これは おとなモードで へんしゅうできるよ",
  made: "かたちが できたよ！",
  saved: "ほぞん できたよ！",
  deleted: "けしたよ。もどす で もとに もどせるよ",
  error: "もういちど やってみよう",
} as const;

export interface GuideInput {
  context: KidsContext;
  /** Bodies in the project. */
  bodies: number;
  /** A sketch tool other than select is active. */
  drawing: boolean;
  notice: KidsNotice | null;
  /** A warning or an error is being shown (a toast or a failed feature). */
  problem: boolean;
}

export function kidsGuide(input: GuideInput): string {
  if (input.problem) return KIDS_GUIDE.error;
  // What just happened is shown until the child starts something else.
  if (input.notice && (input.context === "idle" || input.context === "selected")) {
    return KIDS_GUIDE[input.notice];
  }
  switch (input.context) {
    case "idle":
      return input.bodies === 0 ? KIDS_GUIDE.empty : KIDS_GUIDE.idle;
    case "sketch":
      return input.drawing ? KIDS_GUIDE.sketchTool : KIDS_GUIDE.sketch;
    default:
      return KIDS_GUIDE[input.context];
  }
}

/**
 * The + / − of a value. Only a plain number is changed (in the unit the field already has:
 * mm or degrees); an expression with parameters is left to the normal screen and gives null.
 * A press goes to the next multiple of the step (12.5 → 15 or 10), so the values stay round,
 * and never below `min`. A delta of 0 leaves the value as it is.
 */
export function stepValue(expression: string, delta: number, min = -Infinity): string | null {
  const text = expression.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  const step = Math.abs(delta);
  let next = value;
  if (delta > 0) next = (Math.floor(value / step + 1e-9) + 1) * step;
  if (delta < 0) next = (Math.ceil(value / step - 1e-9) - 1) * step;
  if (next < min) next = Math.max(min, Math.min(value, next));
  if (next < min) next = min;
  return String(Math.round(next * 1000) / 1000);
}

/** Whether an expression is a plain number that the kids controls can change. */
export const isPlainNumber = (expression: string): boolean => stepValue(expression, 0) !== null;

// -------------------------------------------------------------- persistence

export const UI_MODE_KEY = "fabcad.ui-mode";

type ModeStorage = Pick<Storage, "getItem" | "setItem">;

/** The mode saved in this browser: standard unless Kids Mode was chosen. */
export function loadUiMode(storage: ModeStorage | null): UiMode {
  try {
    return storage?.getItem(UI_MODE_KEY) === "kids" ? "kids" : "standard";
  } catch {
    return "standard";
  }
}

/** Storage may be blocked: the mode then applies to this visit only. */
export function saveUiMode(storage: ModeStorage | null, mode: UiMode): boolean {
  try {
    if (!storage) return false;
    storage.setItem(UI_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** `window.localStorage`, or null where there is none or it cannot be reached. */
export function browserStorage(): ModeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
