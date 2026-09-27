/** Parsing and validation of number fields (pure, shared by all fabrication forms). */

export interface NumberRule {
  /** Smallest allowed value. */
  min?: number;
  /** When true, the value must be greater than `min` instead of greater or equal. */
  exclusiveMin?: boolean;
  max?: number;
  /** Allow an empty field, meaning "use the default". */
  allowEmpty?: boolean;
}

export type NumberParse =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

export function parseNumberInput(text: string, rule: NumberRule = {}): NumberParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return rule.allowEmpty ? { ok: true, value: undefined } : { ok: false, error: "Required" };
  }
  const normalized = trimmed.replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return { ok: false, error: "Not a number" };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, error: "Not a number" };
  if (rule.min !== undefined) {
    if (rule.exclusiveMin && value <= rule.min) {
      return { ok: false, error: `Must be greater than ${formatNumber(rule.min)}` };
    }
    if (!rule.exclusiveMin && value < rule.min) {
      return { ok: false, error: `Must be ${formatNumber(rule.min)} or more` };
    }
  }
  if (rule.max !== undefined && value > rule.max) {
    return { ok: false, error: `Must be ${formatNumber(rule.max)} or less` };
  }
  return { ok: true, value };
}

/** Compact display of a number: at most `decimals` decimals, no trailing zeros. */
export function formatNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return "";
  const text = value.toFixed(decimals);
  const trimmed = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  return trimmed === "-0" ? "0" : trimmed;
}
