import type { VariableType, VariableValue } from "@featurevisor/types";

type FieldType = string | VariableType;
type ValueType = VariableValue;

export function getValueByType(value: ValueType, fieldType: FieldType): ValueType {
  try {
    if (value === undefined) {
      return null;
    }

    switch (fieldType) {
      case "string":
        return typeof value === "string" ? value : null;
      case "integer":
        return parseInt(value as string, 10);
      case "double":
        return parseFloat(value as string);
      case "boolean":
        return value === true;
      case "array":
        return Array.isArray(value) ? value : null;
      case "object":
        return typeof value === "object" ? value : null;
      // @NOTE: `json` is not handled here intentionally
      default:
        return value;
    }
  } catch (e) {
    return null;
  }
}
