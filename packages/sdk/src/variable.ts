import type { Context, VariableType, VariableValue } from "@featurevisor/types";

export type VariableGetter<TOptions> = (
  featureKeyOrVariableKey: string,
  variableKeyOrContext?: string | Context,
  contextOrOptions?: Context | TOptions,
  options?: TOptions,
) => VariableValue | null;

export function getValueByType(value: VariableValue, fieldType: VariableType): VariableValue {
  if (value === undefined || value === null) {
    return null;
  }

  switch (fieldType) {
    case "string":
      return typeof value === "string" ? value : null;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? value : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "array":
      return Array.isArray(value) ? value : null;
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? value : null;
    default:
      return value;
  }
}
