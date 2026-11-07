import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { patchDialog, setTool } from "../app/actions";
import { type Dialog, appState, lastViewportPoint } from "../app/appState";
import { modelState, redo, undo, useDocument, useHistoryState } from "../app/session";
import { useStore } from "../app/tinyStore";
import { useHelpTrigger } from "../help/useHelpTrigger";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Icon } from "../ui/Icon";
import {
  cancelCommand,
  finishCommand,
  finishDrawing,
  homeView,
  kidsOpen,
  kidsSave,
  leaveUnfold,
  makeShape,
  openPanel,
  removeSelection,
  setSize,
  setUiMode,
  showUnfold,
  startDrawing,
  startExtrude,
  startMove,
} from "./kidsActions";
import {
  KIDS_GUIDE,
  KIDS_TOOLS,
  type KidsContext,
  type KidsTool,
  kidsContext,
  kidsGuide,
  kidsTools,
  stepValue,
} from "./kidsModel";
import { type SizeField, SIZE_MIN, SIZE_SLIDER_MAX, SIZE_STEP, sizeFields } from "./sizeFields";

/**
 * The screen of Kids Mode: big buttons with a picture and a word, a guide line, and simple
 * windows for the commands. Everything here calls the commands of the normal screen.
 */

function useKidsContext(): KidsContext {
  const workspace = useStore(appState, (s) => s.workspace);
  const activeSketchId = useStore(appState, (s) => s.activeSketchId);
  const selection = useStore(appState, (s) => s.selection);
  const dialog = useStore(appState, (s) => s.dialog);
  const kidsPanel = useStore(appState, (s) => s.kidsPanel);
  return kidsContext({ workspace, activeSketchId, selection, dialog, kidsPanel });
}

function KidsButton({
  icon,
  label,
  help,
  onClick,
  disabled,
  active,
  primary,
  small,
  short,
  className = "",
}: {
  icon: string;
  label: string;
  /** Shorter word for narrow screens. */
  short?: string;
  className?: string;
  help?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  small?: boolean;
}): ReactElement {
  const trigger = useHelpTrigger(help ? { id: help, title: label } : null);
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return (
    <button
      type="button"
      className={`kids-btn${small ? " small" : ""}${primary ? " primary" : ""}${active ? " on" : ""} ${className}`}
      aria-label={label}
      disabled={disabled}
      aria-pressed={active}
      {...handlers}
      onClick={guard(onClick)}
    >
      <Icon name={icon} size={small ? 22 : 30} />
      {short ? (
        <>
          <span className="kids-long">{label}</span>
          <span className="kids-short">{short}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

// -------------------------------------------------------------------- header

export function KidsHeader(): ReactElement {
  const history = useHistoryState();
  return (
    <header className="kids-header">
      <div className="kids-brand" title="FabCAD Kids Mode">
        <Icon name="kids" size={26} />
        <span>FabCAD</span>
      </div>
      <KidsButton small icon="save" label="ほぞん" help="ui.kids" onClick={kidsSave} />
      <KidsButton small icon="open" label="ひらく" help="ui.kids" onClick={() => void kidsOpen()} />
      <KidsButton small icon="undo" label="もどす" onClick={undo} disabled={!history.canUndo} />
      <KidsButton small icon="redo" label="やりなおす" onClick={redo} disabled={!history.canRedo} />
      <div className="header-spacer" />
      <KidsButton
        small
        icon="adult"
        label="おとなモード"
        short="おとな"
        help="ui.kids"
        onClick={() => setUiMode("standard")}
      />
    </header>
  );
}

/** The house button in the corner of the view: back to a view that shows everything. */
export function KidsHomeButton(): ReactElement {
  return <KidsButton small icon="home" label="みなおす" className="kids-home" onClick={homeView} />;
}

// ------------------------------------------------------------------- toolbar

function runTool(tool: KidsTool): void {
  switch (tool) {
    case "shapes":
      return openPanel("shapes");
    case "box":
    case "cylinder":
      return makeShape(tool);
    case "ball":
      return makeShape("ball");
    case "cancel":
      // やめる: close the row of shapes, or let go of the selected shape.
      openPanel(null);
      appState.set({ selection: [] });
      return;
    case "draw":
      return startDrawing();
    case "extrude":
      return startExtrude();
    case "unfold":
      return showUnfold();
    case "back":
      return leaveUnfold();
    case "move":
      return startMove("move");
    case "rotate":
      return startMove("rotate");
    case "size":
      return openPanel("size");
    case "delete":
      return removeSelection();
    case "line":
      return setTool("line");
    case "rectangle":
      return setTool("rectangle-2point");
    case "circle":
      return setTool("circle");
    case "finish":
      return finishDrawing();
  }
}

const TOOL_IDS: Partial<Record<KidsTool, string>> = {
  line: "line",
  rectangle: "rectangle-2point",
  circle: "circle",
};

export function KidsToolbar(): ReactElement {
  const context = useKidsContext();
  const doc = useDocument();
  const tool = useStore(appState, (s) => s.tool);
  const hasSketch = doc.timeline.some((id) => {
    const f = doc.features[id];
    return f?.type === "sketch" && f.visible && !f.suppressed;
  });
  const tools = kidsTools(context, hasSketch);
  return (
    <nav className="kids-toolbar" aria-label="どうぐ">
      {tools.map((t) => (
        <KidsButton
          key={t}
          icon={KIDS_TOOLS[t].icon}
          label={KIDS_TOOLS[t].label}
          help={KIDS_TOOLS[t].help}
          active={TOOL_IDS[t] !== undefined && tool === TOOL_IDS[t]}
          primary={t === "extrude" && context === "sketch"}
          onClick={() => runTool(t)}
        />
      ))}
    </nav>
  );
}

// --------------------------------------------------------------------- guide

export function KidsGuide(): ReactElement {
  const context = useKidsContext();
  const doc = useDocument();
  const tool = useStore(appState, (s) => s.tool);
  const notice = useStore(appState, (s) => s.kidsNotice);
  const toasts = useStore(appState, (s) => s.toasts);
  const problem = toasts.some((t) => t.kind !== "info");
  const bodies = Object.keys(doc.bodies).length;
  const text = kidsGuide({ context, bodies, drawing: tool !== "select", notice, problem });
  return (
    <div className={`kids-guide${problem ? " problem" : ""}`} role="status" aria-live="polite">
      <Icon name={problem ? "warning" : "kids"} size={24} />
      <span>{text}</span>
    </div>
  );
}

// ------------------------------------------------------------------- stepper

/**
 * A value with big − and + buttons and a slider. It changes plain numbers only (see
 * `stepValue`); an expression is shown as it is, to be changed in the normal screen.
 */
function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
  commitOnRelease,
}: {
  label: string;
  value: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (value: string) => void;
  /** The slider shows its value while dragged and changes it once, when let go. */
  commitOnRelease?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const shown = draft ?? value;
  const plain = stepValue(value, 0) !== null;
  if (!plain) {
    return (
      <div className="kids-stepper">
        <div className="kids-stepper-label">{label}</div>
        <div className="kids-note">{KIDS_GUIDE.other}</div>
      </div>
    );
  }
  const n = Number(shown);
  const press = (delta: number): void => {
    const next = stepValue(value, delta, min);
    if (next !== null && next !== value) onChange(next);
  };
  const release = (): void => {
    if (draft !== null && draft !== value) onChange(draft);
  };
  return (
    <div className="kids-stepper">
      <div className="kids-stepper-label">{label}</div>
      <div className="kids-stepper-row">
        <button type="button" className="kids-step" aria-label={`${label} を へらす`} onClick={() => press(-step)}>
          −
        </button>
        <output className="kids-value" aria-label={label}>
          {shown}
          <small>{unit}</small>
        </output>
        <button type="button" className="kids-step" aria-label={`${label} を ふやす`} onClick={() => press(step)}>
          ＋
        </button>
      </div>
      <input
        type="range"
        className="kids-slider"
        aria-label={label}
        min={Math.min(min, n)}
        max={Math.max(max, n)}
        step={1}
        value={n}
        onChange={(e) => {
          if (commitOnRelease) setDraft(e.target.value);
          else onChange(e.target.value);
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
    </div>
  );
}

// ---------------------------------------------------------- command windows

const MOVE_ROWS = [
  { key: "x", label: "よこ" },
  { key: "y", label: "おく" },
  { key: "z", label: "うえ" },
] as const;

const ROTATE_ROWS = [
  { key: "rz", label: "くるっと まわす" },
  { key: "rx", label: "まえに たおす" },
  { key: "ry", label: "よこに たおす" },
] as const;

function CommandBody({ dialog, context }: { dialog: Dialog; context: KidsContext }): ReactNode {
  if (dialog.type === "extrude") {
    const picked = dialog.profiles.length > 0;
    return picked ? (
      <Stepper
        label="たかさ"
        value={dialog.distance}
        unit="mm"
        step={SIZE_STEP}
        min={SIZE_MIN}
        max={SIZE_SLIDER_MAX}
        onChange={(distance) => patchDialog({ distance })}
      />
    ) : (
      <div className="kids-note">たかくする え を おしてね</div>
    );
  }
  if (dialog.type === "sphere") {
    return (
      <Stepper
        label="ふとさ"
        value={dialog.diameter}
        unit="mm"
        step={SIZE_STEP}
        min={SIZE_MIN}
        max={SIZE_SLIDER_MAX}
        onChange={(diameter) => patchDialog({ diameter })}
      />
    );
  }
  if (dialog.type === "move") {
    if (dialog.bodyIds.length === 0) return <div className="kids-note">うごかす かたちを おしてね</div>;
    const rows = context === "rotate" ? ROTATE_ROWS : MOVE_ROWS;
    const angle = context === "rotate";
    return rows.map((r) => (
      <Stepper
        key={r.key}
        label={r.label}
        value={dialog[r.key]}
        unit={angle ? "ど" : "mm"}
        step={angle ? 15 : SIZE_STEP}
        min={angle ? -180 : -SIZE_SLIDER_MAX}
        max={angle ? 180 : SIZE_SLIDER_MAX}
        onChange={(v) => patchDialog({ [r.key]: v } as Partial<Dialog>)}
      />
    ));
  }
  return <div className="kids-note">{KIDS_GUIDE.other}</div>;
}

const COMMAND_TITLES: Partial<Record<KidsContext, string>> = {
  extrude: "たかくする",
  sphere: "たま",
  move: "うごかす",
  rotate: "まわす",
  other: "おとなモードの どうぐ",
};

export function KidsCommandPanel(): ReactElement | null {
  const dialog = useStore(appState, (s) => s.dialog);
  const context = useKidsContext();
  const type = dialog?.type ?? null;
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setAnchor(type ? lastViewportPoint() : null), [type]);
  if (!dialog || dialog.type === "parameters" || dialog.type === "about" || dialog.type === "import-dxf") {
    return null;
  }
  if (dialog.type === "pick-sketch-plane" || dialog.type === "text") return null;
  const supported = context !== "other";
  return (
    <FloatingPanel
      id={`kids-${context}`}
      anchor={anchor}
      title={COMMAND_TITLES[context] ?? ""}
      className="kids-panel"
      onClose={cancelCommand}
      closeLabel="やめる"
    >
      <div className="kids-panel-body">
        <CommandBody dialog={dialog} context={context} />
      </div>
      <div className="kids-panel-actions">
        <KidsButton small icon="close" label="やめる" onClick={cancelCommand} />
        {supported && <KidsButton small primary icon="check" label="できた" onClick={finishCommand} />}
      </div>
    </FloatingPanel>
  );
}

/** おおきさ: the sizes of the selected body (see `sizeFields`). */
export function KidsSizePanel(): ReactElement | null {
  const context = useKidsContext();
  const doc = useDocument();
  const selection = useStore(appState, (s) => s.selection);
  const busy = useStore(modelState, (s) => s.busy);
  if (context !== "size") return null;
  const bodyId = selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : []))[0];
  if (!bodyId) return null;
  const { fields, limited } = sizeFields(doc, bodyId);
  const change = (f: SizeField, expression: string): void => {
    setSize(f, expression);
  };
  return (
    <FloatingPanel
      id="kids-size"
      anchor={lastViewportPoint()}
      title="おおきさ"
      className="kids-panel"
      onClose={() => openPanel(null)}
      closeLabel="とじる"
    >
      <div className="kids-panel-body" aria-busy={busy}>
        {fields.map((f) => (
          <Stepper
            key={f.kind === "feature" ? `${f.featureId}:${f.key}` : `${f.sketchId}:${f.dimensionId}`}
            label={f.label}
            value={f.expression}
            unit="mm"
            step={SIZE_STEP}
            min={SIZE_MIN}
            max={SIZE_SLIDER_MAX}
            commitOnRelease
            onChange={(v) => change(f, v)}
          />
        ))}
        {(fields.length === 0 || limited) && <div className="kids-note">{KIDS_GUIDE.other}</div>}
      </div>
      <div className="kids-panel-actions">
        <KidsButton small primary icon="check" label="できた" onClick={() => openPanel(null)} />
      </div>
    </FloatingPanel>
  );
}
