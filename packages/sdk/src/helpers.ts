import type { VariableType, VariableValue } from "@featurevisor/types";

type FieldType = string | VariableType;
export type ValueType = VariableValue;

export function getValueByType(value: ValueType, fieldType: FieldType): ValueType {
  if (value === undefined || value === null) {
    return null;
  }

  switch (fieldType) {
    case "string":
      return typeof value === "string" ? value : null;
    case "integer": {
      const result = typeof value === "number" ? value : Number(value);
      return Number.isInteger(result) ? result : null;
    }
    case "double": {
      const result = typeof value === "number" ? value : Number(value);
      return Number.isFinite(result) ? result : null;
    }
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "array":
      return Array.isArray(value) ? value : null;
    case "object":
      return typeof value === "object" && !Array.isArray(value) ? value : null;
    // @NOTE: `json` is not handled here intentionally
    default:
      return value;
  }
}
