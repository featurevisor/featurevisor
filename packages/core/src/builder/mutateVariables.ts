import type { VariableSchema, VariableValue } from "@featurevisor/types";
import { mutate } from "./mutator";

/**
 * Resolve variable values from schema defaults and overrides.
 * Override keys may be variable keys or dot-notation paths (e.g. "foo", "foo.a.b").
 * Uses the mutator so nested paths and mutation notations are supported.
 * Returns only variables that were desired to be overridden (i.e. appear in overrides).
 */
export function resolveVariablesWithOverrides(
  variablesSchema: Record<string, VariableSchema> | undefined,
  overrides: Record<string, VariableValue> | undefined,
): Record<string, VariableValue> | undefined {
  if (!overrides || Object.keys(overrides).length === 0) {
    return undefined;
  }
  if (!variablesSchema || Object.keys(variablesSchema).length === 0) {
    return undefined;
  }

  const variableKeysToOutput = new Set<string>();
  for (const overrideKey of Object.keys(overrides)) {
    const firstSegment = overrideKey.includes(".") ? overrideKey.split(".")[0] : overrideKey;
    const variableKey = firstSegment.replace(/\s*\[.*\]\s*$/, "").trim();
    if (variableKey && variablesSchema[variableKey]) {
      variableKeysToOutput.add(variableKey);
    }
  }

  const result: Record<string, VariableValue> = {};

  for (const variableKey of variableKeysToOutput) {
    const schema = variablesSchema[variableKey];
    let value: VariableValue =
      schema.defaultValue !== undefined && schema.defaultValue !== null
        ? (JSON.parse(JSON.stringify(schema.defaultValue)) as VariableValue)
        : undefined;

    const keysForThisVariable = Object.keys(overrides)
      .filter(
        (k) =>
          k === variableKey ||
          k.startsWith(variableKey + ".") ||
          k.startsWith(variableKey + "["),
      )
      .sort((a, b) => a.length - b.length);

    for (const overrideKey of keysForThisVariable) {
      const overrideValue = overrides[overrideKey];
      if (overrideKey === variableKey) {
        value =
          overrideValue !== undefined && overrideValue !== null
            ? (JSON.parse(JSON.stringify(overrideValue)) as VariableValue)
            : overrideValue;
      } else {
        const notation =
          overrideKey.startsWith(variableKey + "[")
            ? overrideKey.slice(variableKey.length)
            : overrideKey.slice(variableKey.length + 1);
        value = mutate(schema, value, notation, overrideValue);
      }
    }

    result[variableKey] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
