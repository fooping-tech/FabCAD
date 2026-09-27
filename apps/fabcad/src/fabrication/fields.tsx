import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { type NumberRule, formatNumber, parseNumberInput } from "./numberInput";

/** Small form controls shared by the fabrication panels. */

export function ChevronIcon(): ReactNode {
  return (
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3.5 1.5 7 5 3.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SectionProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsible `.panel` block of the side panel. */
export function Section({ title, badge, defaultOpen = true, children }: SectionProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="panel">
      <div className="panel-title">
        <button
          type="button"
          className={`fab-section-toggle${open ? " open" : ""}`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronIcon />
          <span className="fab-section-name">{title}</span>
          {badge}
        </button>
      </div>
      {open ? (
        <div className="panel-body padded" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  /** Current value; `undefined` shows the placeholder (the default). */
  value: number | undefined;
  /** Default value, shown as placeholder when the field is empty. */
  defaultValue?: number;
  unit?: string;
  rule?: NumberRule;
  hint?: string;
  disabled?: boolean;
  /** Called on blur / Enter with a valid value that differs from `value`. */
  onCommit: (value: number | undefined) => void;
}

/**
 * Number input that commits on blur or Enter, never on a keystroke. Invalid text is marked,
 * is never committed, and is reverted when the field loses focus. Escape cancels the edit.
 */
export function NumberField({
  label,
  value,
  defaultValue,
  unit,
  rule,
  hint,
  disabled,
  onCommit,
}: NumberFieldProps): ReactNode {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : formatNumber(value));
  const parsed = draft === null ? null : parseNumberInput(draft, rule);
  const error = parsed && !parsed.ok ? parsed.error : null;

  const commit = (keepInvalid: boolean): void => {
    if (draft === null) return;
    const result = parseNumberInput(draft, rule);
    if (!result.ok) {
      if (!keepInvalid) setDraft(null);
      return;
    }
    setDraft(null);
    const same =
      result.value === undefined || value === undefined
        ? result.value === value
        : Math.abs(result.value - value) < 1e-9;
    if (!same) onCommit(result.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    }
    // Keep workspace shortcuts away from the text being edited.
    e.stopPropagation();
  };

  return (
    <div className="field">
      <label htmlFor={id} title={label}>
        {label}
      </label>
      <span className="fab-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className={`num${error ? " invalid" : ""}`}
          value={shown}
          placeholder={defaultValue === undefined ? undefined : formatNumber(defaultValue)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(false)}
          onKeyDown={onKeyDown}
        />
        {unit ? <span className="fab-unit">{unit}</span> : null}
      </span>
      {error ? (
        <div className="field-error" id={`${id}-note`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint" id={`${id}-note`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Called on blur / Enter with the trimmed, non-empty text when it changed. */
  onCommit: (value: string) => void;
}

export function TextField({ label, value, placeholder, disabled, onCommit }: TextFieldProps): ReactNode {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text.length > 0 && text !== value) onCommit(text);
  };
  return (
    <div className="field">
      <label htmlFor={id} title={label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(null);
          e.stopPropagation();
        }}
      />
    </div>
  );
}

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}

export function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedFieldProps<T>): ReactNode {
  const id = useId();
  return (
    <div className="field">
      <span className="label" id={id} title={label}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "on" : undefined}
            title={o.title}
            onClick={() => {
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface CheckFieldProps {
  label: string;
  checked: boolean;
  note?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckField({ label, checked, note, disabled, onChange }: CheckFieldProps): ReactNode {
  return (
    <label className="fab-check" title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
      {note ? <span className="fab-check-note">{note}</span> : null}
    </label>
  );
}
