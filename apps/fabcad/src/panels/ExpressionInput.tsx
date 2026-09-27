import { evaluateExpression, formatQuantity } from "@fabcad/cad-document";
import { type ReactElement, useEffect, useState } from "react";
import { currentScope, useDocument } from "../app/session";
import { pressEscape } from "../app/shortcuts";

/** Evaluate for display: returns the formatted value or the error. */
export function previewExpression(
  expression: string,
  kind: "length" | "angle" | "none",
): { text: string; error: boolean } {
  try {
    const q = evaluateExpression(expression, currentScope());
    if (kind !== "none" && q.kind !== "none" && q.kind !== kind) {
      return { text: kind === "length" ? "Expected a length" : "Expected an angle", error: true };
    }
    return {
      text: formatQuantity({ value: q.value, kind: kind === "none" ? q.kind : kind }),
      error: false,
    };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), error: true };
  }
}

/**
 * On touch devices value fields bring up the number keys; a button switches to the letter keys
 * for parameters and expressions. A field that already holds an expression starts with letters.
 */
export function useNumericKeypad(value: string): {
  touch: boolean;
  text: boolean;
  inputMode: "decimal" | "text" | undefined;
  toggle: () => void;
} {
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const [text, setText] = useState(() => /[A-Za-z_(]/.test(value));
  return {
    touch,
    text,
    inputMode: touch ? (text ? "text" : "decimal") : undefined,
    toggle: () => setText((t) => !t),
  };
}

/**
 * Text field for a value or parameter expression ("50", "width / 2", "t + 0.1 mm").
 * `live` reports every keystroke; otherwise the value is committed on Enter or blur.
 */
export function ExpressionInput({
  value,
  kind,
  onChange,
  live = false,
  label,
  autoFocus,
  onEnter,
}: {
  value: string;
  kind: "length" | "angle" | "none";
  onChange: (value: string) => void;
  live?: boolean;
  label: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}): ReactElement {
  useDocument();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const preview = previewExpression(draft, kind);
  const isPlain = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(draft);
  const unit = kind === "length" ? "mm" : kind === "angle" ? "deg" : "";
  const keypad = useNumericKeypad(draft);
  return (
    <div>
      <div className={`unit-field${unit ? " has-unit" : ""}${keypad.touch ? " has-keys" : ""}`}>
      <input
        value={draft}
        inputMode={keypad.inputMode}
        enterKeyHint="done"
        aria-label={label}
        aria-invalid={preview.error}
        className={preview.error ? "invalid" : ""}
        spellCheck={false}
        autoFocus={autoFocus}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          if (live) onChange(e.target.value);
        }}
        onBlur={() => {
          if (!live && draft !== value) onChange(draft);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            if (!live && draft !== value) onChange(draft);
            onEnter?.();
          } else if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
            // In a command dialog Esc cancels the command, not just the typing.
            if (live) pressEscape();
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
      {keypad.touch && (
        <button
          type="button"
          className="keys-toggle"
          title={keypad.text ? "Number keys" : "Letter keys, for parameters and expressions"}
          aria-label={keypad.text ? "Switch to number keys" : "Switch to letter keys"}
          onPointerDown={(e) => e.preventDefault()}
          onClick={keypad.toggle}
        >
          {keypad.text ? "123" : "abc"}
        </button>
      )}
      </div>
      {(preview.error || !isPlain) && (
        <div className={preview.error ? "field-error" : "value-preview"} style={{ marginTop: 2 }}>
          {preview.error ? preview.text : `= ${preview.text}`}
        </div>
      )}
    </div>
  );
}
