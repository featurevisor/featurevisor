/**
 * Plain text for authored operands, shared by requirement summaries and test checks.
 * These summaries explain authoring semantics, so nothing may be lost or made ambiguous.
 */

const plainPathPart = /^[A-Za-z_$][\w$-]*$/;

/**
 * Paths read the way the SDK resolves them. A string path splits on dots and turns whole
 * number parts into indexes. In an array path every string is a literal key, so `["a.b", 0]`
 * shows as `["a.b"][0]`, never as `a.b.0`.
 */
export function formatPath(path: unknown): string {
  if (path === undefined || path === null || path === "") return "";
  const parts: unknown[] =
    typeof path === "string"
      ? path.split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part))
      : Array.isArray(path)
        ? path
        : [path];
  return parts
    .map((part) =>
      typeof part === "number"
        ? `[${part}]`
        : typeof part === "string" && plainPathPart.test(part)
          ? `.${part}`
          : `[${JSON.stringify(String(part))}]`,
    )
    .join("");
}

/** Strings stay quoted so "" and "3" remain distinguishable from nothing and 3. */
export function formatOperand(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatOperand).join(", ")}]`;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

/** Human readable labels for array list comparisons. Other operator labels stay unchanged. */
export function formatComparisonOperator(operator: string): string {
  if (operator === "includesAny") return "includes any of";
  if (operator === "notIncludesAny") return "includes none of";
  return operator;
}

/** Operator, operand and regex flags, as in `equals ""` or `matches "^a" (flags i)`. */
export function formatComparison(comparison: {
  operator?: unknown;
  value?: unknown;
  hasValue?: boolean;
  regexFlags?: unknown;
}): string {
  return [
    typeof comparison.operator === "string"
      ? formatComparisonOperator(comparison.operator)
      : undefined,
    comparison.hasValue ? formatOperand(comparison.value) : undefined,
    typeof comparison.regexFlags === "string" && comparison.regexFlags
      ? `(flags ${comparison.regexFlags})`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export const DECODED_JSON_DESCRIPTION =
  "The alias receives the evaluated, decoded JSON value, which may be an object, array, scalar or null.";

export function formatVariableType(type: string | undefined, isComposed?: boolean) {
  return type === "json" && isComposed ? "json, decoded" : type;
}
