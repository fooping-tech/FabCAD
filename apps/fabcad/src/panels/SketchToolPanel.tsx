import { type ReactElement, useEffect, useRef, useState } from "react";
import { type ToolOptions, appState } from "../app/appState";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { createTool } from "../sketch/createTools";
import { offsetSketch } from "../sketch/offsetGeometry";
import { cancelOffset, commitOffset, patchOffset } from "../sketch/offsetTool";
import { TOOLS_WITH_WINDOW } from "../sketch/toolWindows";
import { FloatingPanel } from "../ui/FloatingPanel";

/**
 * A number typed into a command window. The text is kept while it is being typed ("0.", "")
 * and passed on whenever it reads as a number of at least `min`.
 */
function NumberField({
  label,
  value,
  min,
  step = 1,
  unit,
  integer = false,
  autoFocus = false,
  onChange,
  onEnter,
  onEscape,
}: {
  label: string;
  value: number;
  min: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  autoFocus?: boolean;
  onChange: (v: number) => void;
  onEnter?: () => void;
  onEscape?: () => void;
}): ReactElement {
  const [text, setText] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Changes from elsewhere (dragging the preview) show up; what is being typed stays.
    setText((t) => (Number(t) === value && t.trim() !== "" ? t : String(value)));
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.select();
  }, [autoFocus]);
  const valid = (v: number): boolean => Number.isFinite(v) && v >= min && (!integer || Number.isInteger(v));
  return (
    <label className="field tool-field">
      <span className="label">{label}</span>
      <span className="tool-input">
        <input
          ref={ref}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          enterKeyHint="done"
          value={text}
          min={min}
          step={step}
          aria-invalid={!valid(Number(text))}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== "" && valid(v)) onChange(v);
          }}
          onBlur={() => setText(String(value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter?.();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onEscape?.();
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

const TITLES: Record<string, string> = {
  "polygon-inscribed": "Polygon",
  "polygon-circumscribed": "Polygon",
  fillet: "Sketch Fillet",
  chamfer: "Sketch Chamfer",
  offset: "Offset",
};

function setOptions(patch: Partial<ToolOptions>): void {
  appState.set((s) => ({ toolOptions: { ...s.toolOptions, ...patch } }));
}

/** Distance, side and OK of the Offset being previewed. */
function OffsetBody(): ReactElement | null {
  const offset = useStore(appState, (s) => s.sketchOffset);
  const doc = useDocument();
  if (!offset) return null;
  const feature = doc.features[offset.sketchId];
  const possible = feature?.type === "sketch" && offsetSketch(feature.sketch, offset) !== null;
  return (
    <>
      <div className="form">
        <NumberField
          label="Distance"
          unit="mm"
          value={offset.distance}
          min={0.001}
          step={0.5}
          autoFocus
          onChange={(distance) => patchOffset({ distance })}
          onEnter={() => possible && commitOffset()}
          onEscape={cancelOffset}
        />
        <div className="field tool-field">
          <span className="label">Direction</span>
          <button
            className="btn small"
            title="Offset to the other side"
            onClick={() => patchOffset({ side: offset.side === 1 ? -1 : 1 })}
          >
            ⇄ Flip
          </button>
        </div>
      </div>
      <div className="form-actions" style={{ alignItems: "center" }}>
        {!possible && (
          <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
            Too far for this chain.
          </span>
        )}
        <button className="btn" onClick={cancelOffset}>
          Cancel
        </button>
        <button className="btn accent" disabled={!possible} onClick={commitOffset}>
          OK
        </button>
      </div>
    </>
  );
}

function OptionsBody({ tool, options }: { tool: string; options: ToolOptions }): ReactElement | null {
  switch (tool) {
    case "polygon-inscribed":
    case "polygon-circumscribed":
      return (
        <NumberField label="Sides" integer value={options.polygonSides} min={3} onChange={(v) => setOptions({ polygonSides: v })} />
      );
    case "fillet":
      return (
        <NumberField label="Radius" unit="mm" value={options.filletRadius} min={0.01} step={0.5} onChange={(v) => setOptions({ filletRadius: v })} />
      );
    case "chamfer":
      return (
        <NumberField label="Distance" unit="mm" value={options.chamferDistance} min={0.01} step={0.5} onChange={(v) => setOptions({ chamferDistance: v })} />
      );
    default:
      return null;
  }
}

/**
 * Options of the running sketch command, in a window beside the click that started the
 * operation. Sketch Offset waits in it for OK; the other commands read their options from it
 * at their next click.
 */
export function SketchToolPanel(): ReactElement | null {
  const tool = useStore(appState, (s) => s.tool);
  const anchor = useStore(appState, (s) => s.toolPanel);
  const active = useStore(appState, (s) => s.activeSketchId);
  const options = useStore(appState, (s) => s.toolOptions);
  if (!active || !anchor || !TOOLS_WITH_WINDOW.has(tool)) return null;
  const title = TITLES[tool] ?? createTool(tool)?.label ?? tool;
  if (tool === "offset") {
    return (
      <FloatingPanel id="sketch-tool" anchor={anchor} title={title} className="tool-window" onClose={cancelOffset} closeLabel="Cancel (Esc)">
        <div className="floating-body">
          <OffsetBody />
        </div>
      </FloatingPanel>
    );
  }
  return (
    <FloatingPanel
      id="sketch-tool"
      anchor={anchor}
      title={title}
      className="tool-window"
      onClose={() => appState.set({ toolPanel: null })}
    >
      <div className="floating-body">
        <div className="form">
          <OptionsBody tool={tool} options={options} />
        </div>
      </div>
    </FloatingPanel>
  );
}
