import type { SketchTextProps } from "@fabcad/sketch";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef } from "react";
import { appState, lastViewportPoint } from "../app/appState";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { ExpressionInput } from "../panels/ExpressionInput";
import { FloatingPanel } from "../ui/FloatingPanel";
import { Icon } from "../ui/Icon";
import {
  cancelText,
  commitText,
  patchText,
  setTextFont,
  textDialogProblem,
  textOf,
} from "./textCommands";
import { pickUserFont, textState, typography } from "./typography";

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="field" style={{ alignItems: "start" }}>
      <span className="label" style={{ paddingTop: 5 }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}): ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? "on" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const H_ALIGN: { id: SketchTextProps["horizontalAlign"]; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Right" },
];
const V_ALIGN: { id: SketchTextProps["verticalAlign"]; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "baseline", label: "Base" },
  { id: "bottom", label: "Bottom" },
];

export function TextDialog(): ReactElement | null {
  const dialog = useStore(appState, (s) => s.dialog);
  const fonts = useStore(textState, (s) => s.fonts);
  const loading = useStore(textState, (s) => s.loading);
  const doc = useDocument();
  const area = useRef<HTMLTextAreaElement>(null);
  const active = dialog?.type === "text" ? dialog : null;
  const text = active ? textOf(active.sketchId, active.textId) : null;
  // Beside the click that placed (or opened) the text.
  const anchor = useMemo(() => (active ? lastViewportPoint() : null), [active?.textId]);

  useEffect(() => {
    if (!active) return;
    area.current?.focus();
    if (active.fresh) area.current?.select();
    // Only when the dialog opens for another text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.textId]);

  // Undo while the dialog is open takes the text away: the dialog goes with it.
  useEffect(() => {
    if (active && !text) appState.set({ dialog: null });
  }, [active, text]);

  if (!active || !text) return null;
  void doc;
  const problem = textDialogProblem(active.sketchId, active.textId);
  const known = fonts.some((f) => f.id === text.fontId);
  const path = text.path;
  const pathEntity = path
    ? (() => {
        const f = doc.features[active.sketchId];
        return f?.type === "sketch" ? f.sketch.entities[path.entityId] : undefined;
      })()
    : undefined;
  const font = fonts.find((f) => f.id === text.fontId);
  const vertical = text.direction === "vertical";

  return (
    <FloatingPanel
      id="text-dialog"
      anchor={anchor}
      title={active.fresh ? "Text" : "Edit Text"}
      className="text-dialog"
      onClose={cancelText}
    >
      <div className="floating-body">
        <Field label="Text">
          <textarea
            ref={area}
            aria-label="Text"
            value={text.text}
            rows={2}
            spellCheck={false}
            onChange={(e) => patchText({ text: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") cancelText();
              // Enter makes a new line; Ctrl / Cmd + Enter finishes.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitText();
              }
            }}
          />
        </Field>
        <Field label="Font">
          <select
            aria-label="Font"
            value={known ? text.fontId : "__missing"}
            onChange={(e) => {
              if (e.target.value === "__load") {
                void pickUserFont().then((info) => info && setTextFont(info.id));
              } else if (e.target.value !== "__missing") {
                setTextFont(e.target.value);
              }
            }}
          >
            {!known && <option value="__missing">{text.fontName} (not loaded)</option>}
            <optgroup label="FabCAD fonts">
              {fonts
                .filter((f) => f.bundled)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.family}
                  </option>
                ))}
            </optgroup>
            {fonts.some((f) => !f.bundled) && (
              <optgroup label="Your fonts (this session)">
                {fonts
                  .filter((f) => !f.bundled)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.family}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="__load">Load a font file (TTF, OTF, WOFF)…</option>
          </select>
          {loading.includes(text.fontId) && <div className="field-hint">Loading the font…</div>}
          {font && !font.bundled && (
            <div className="field-hint">
              Read in this browser only. The font file is not stored in the project.
            </div>
          )}
        </Field>
        <Field label="Height">
          <ExpressionInput
            label="Height"
            value={text.height}
            kind="length"
            onChange={(v) => patchText({ height: v })}
            onEnter={commitText}
            live
          />
        </Field>
        <Field label="Spacing">
          <ExpressionInput
            label="Letter spacing"
            value={text.letterSpacing}
            kind="length"
            onChange={(v) => patchText({ letterSpacing: v })}
            onEnter={commitText}
            live
          />
        </Field>
        <Field label="Line pitch">
          <ExpressionInput
            label="Line spacing"
            value={text.lineSpacing}
            kind="none"
            onChange={(v) => patchText({ lineSpacing: v })}
            onEnter={commitText}
            live
          />
        </Field>
        {!path && (
          <>
            <Field label="Angle">
              <ExpressionInput
                label="Angle"
                value={text.rotation}
                kind="angle"
                        onChange={(v) => patchText({ rotation: v })}
                onEnter={commitText}
                live
              />
            </Field>
            <Field label="Direction">
              <Segmented
                label="Direction"
                value={text.direction}
                options={[
                  { id: "horizontal", label: "Horizontal" },
                  { id: "vertical", label: "Vertical 縦" },
                ]}
                onChange={(direction) => patchText({ direction })}
              />
              {vertical && font && !font.vertical && (
                <div className="field-hint">This font has no vertical forms.</div>
              )}
            </Field>
            <Field label="Align">
              <Segmented
                label="Horizontal alignment"
                value={text.horizontalAlign}
                options={H_ALIGN}
                onChange={(horizontalAlign) => patchText({ horizontalAlign })}
              />
              <div style={{ height: 4 }} />
              <Segmented
                label="Vertical alignment"
                value={text.verticalAlign}
                options={V_ALIGN}
                onChange={(verticalAlign) => patchText({ verticalAlign })}
              />
            </Field>
          </>
        )}
        <Field label="Path">
          <div
            className={`pick-box${active.picking === "path" ? " on" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Path"
            onClick={() =>
              appState.set({
                dialog: { ...active, picking: active.picking === "path" ? null : "path" },
                hint: "Text: select the line, arc, circle or spline the text follows.",
              })
            }
          >
            <span>
              {active.picking === "path"
                ? "Select a curve…"
                : path
                  ? pathEntity
                    ? `${pathEntity.type.charAt(0).toUpperCase()}${pathEntity.type.slice(1)} selected`
                    : "Curve missing"
                  : "None — click to select a curve"}
            </span>
            {path && (
              <button
                className="clear"
                aria-label="Remove the path"
                onClick={(e) => {
                  e.stopPropagation();
                  patchText({ path: undefined });
                }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        </Field>
        {path && (
          <>
            <Field label="Offset">
              <ExpressionInput
                label="Path offset"
                value={path.offset}
                kind="length"
                        onChange={(v) => patchText({ path: { ...path, offset: v } })}
                onEnter={commitText}
                live
              />
            </Field>
            <Field label="Start">
              <ExpressionInput
                label="Path start"
                value={path.start}
                kind="length"
                        onChange={(v) => patchText({ path: { ...path, start: v } })}
                onEnter={commitText}
                live
              />
            </Field>
            <Field label="Align">
              <Segmented
                label="Alignment on the path"
                value={path.align}
                options={H_ALIGN}
                onChange={(align) => patchText({ path: { ...path, align } })}
              />
            </Field>
            <Field label="Side">
              <label className="check">
                <input
                  type="checkbox"
                  checked={path.flip}
                  onChange={(e) => patchText({ path: { ...path, flip: e.target.checked } })}
                />
                Flip
              </label>
            </Field>
          </>
        )}
        <Field label="Options">
          <label className="check">
            <input
              type="checkbox"
              checked={text.construction === true}
              onChange={(e) => patchText({ construction: e.target.checked })}
            />
            Construction (no profile)
          </label>
        </Field>
        {problem && <div className="field-error" style={{ gridColumn: "1 / -1" }}>{problem}</div>}
        {!typography.capabilities.shaping && typography.capabilities.shapingError && (
          <div className="field-hint" style={{ gridColumn: "1 / -1" }}>
            Simple text layout is used: {typography.capabilities.shapingError}
          </div>
        )}
        <div className="form-actions">
          <button className="btn small" onClick={cancelText}>
            Cancel
          </button>
          <button className="btn small primary" disabled={problem !== null} onClick={commitText}>
            OK
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
