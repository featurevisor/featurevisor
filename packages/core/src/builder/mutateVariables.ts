import type { VariableMutations, VariableSchema, VariableValue } from "@featurevisor/types";
import { mutate } from "./mutator";
import { mutationEntries } from "./mutationEntries";

const MUTATION_OP_SUFFIX = /:((?:append|prepend|appendUnique|removeValue|after|before|remove))$/;

/**
 * Get the root variable name from an override key (e.g. "tags:append" -> "tags", "payload.rows:append" -> "payload").
 */
export function rootVariableFromOverrideKey(
  overrideKey: string,
  variablesSchema?: Record<string, unknown>,
): string {
  const withoutSuffix = overrideKey.replace(MUTATION_OP_SUFFIX, "").trim();
  const exactDeclaredRoot = Object.keys(variablesSchema || {})
    .filter(
      (key) =>
        withoutSuffix === key ||
        withoutSuffix.startsWith(key + ".") ||
        withoutSuffix.startsWith(key + "[") ||
        overrideKey.startsWith(key + ":"),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (exactDeclaredRoot) return exactDeclaredRoot;
  const firstSegment = withoutSuffix.includes(".") ? withoutSuffix.split(".")[0] : withoutSuffix;
  return firstSegment.replace(/\s*\[.*\]\s*$/, "").trim();
}

/**
 * Resolve variable values from schema defaults and overrides.
 * Override keys may be variable keys or dot-notation paths (e.g. "foo", "foo.a.b", "tags:append", "items[id=2]:after").
 * Uses the mutator so nested paths and mutation notations are supported.
 * Returns only variables that were desired to be overridden (i.e. appear in overrides).
 */
export function resolveMutationsForMultipleVariables(
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
    const variableKey = rootVariableFromOverrideKey(overrideKey, variablesSchema);
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

    const keysForThisVariable = Object.keys(overrides).filter(
      (k) =>
        rootVariableFromOverrideKey(k, variablesSchema) === variableKey &&
        (k === variableKey ||
          k.startsWith(variableKey + ".") ||
          k.startsWith(variableKey + "[") ||
          k.startsWith(variableKey + ":")),
    );

    for (const overrideKey of keysForThisVariable) {
      const overrideValue = overrides[overrideKey];
      if (overrideKey === variableKey) {
        value =
          overrideValue !== undefined && overrideValue !== null
            ? (JSON.parse(JSON.stringify(overrideValue)) as VariableValue)
            : overrideValue;
      } else {
        const notation = overrideKey.startsWith(variableKey + "[")
          ? overrideKey.slice(variableKey.length)
          : overrideKey.startsWith(variableKey + ":")
            ? overrideKey.slice(variableKey.length)
            : overrideKey.slice(variableKey.length + 1);
        value = mutate(schema, value, notation, overrideValue);
      }
    }

    result[variableKey] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Resolve a single variable's override value (e.g. from variableOverrides).
 * If the value is a plain object with path-like keys, it is merged with the variable's default;
 * otherwise the value is returned as-is (full replacement).
 */
export function resolveMutationsForSingleVariable(
  variablesSchema: Record<string, VariableSchema> | undefined,
  variableKey: string,
  overrideValue: VariableValue | VariableMutations,
  baseValue?: VariableValue,
  explicitMutations = false,
): VariableValue {
  if (!variablesSchema || !variablesSchema[variableKey]) return overrideValue;
  if (overrideValue === null || overrideValue === undefined) return overrideValue;
  if (typeof overrideValue !== "object" || (Array.isArray(overrideValue) && !explicitMutations)) {
    return overrideValue;
  }

  const entries = mutationEntries(overrideValue as VariableMutations);
  if (entries.length === 0) return baseValue === undefined ? {} : baseValue;
  const schema = variablesSchema[variableKey];
  let value = baseValue === undefined ? schema.defaultValue : baseValue;
  // Mutation maps are ordered, just like global override operations. Do not sort paths.
  for (const [key, mutationValue] of entries) {
    value = key === variableKey ? mutationValue : mutate(schema, value, key, mutationValue);
  }
  return value;
}
