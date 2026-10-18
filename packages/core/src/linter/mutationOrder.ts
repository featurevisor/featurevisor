import { isDeepStrictEqual } from "util";
import type { ParsedFeature } from "@featurevisor/types";
import {
  resolveMutationsForMultipleVariables,
  resolveMutationsForSingleVariable,
} from "../builder/mutateVariables";

export interface MutationOrderChange {
  path: (string | number)[];
  message: string;
}

function changedMessage(
  entries: [string, unknown][],
  before: unknown,
  after: unknown,
): string | undefined {
  if (isDeepStrictEqual(before, after)) return undefined;
  let effect = "Later assignments change the resolved value";
  for (let later = 1; later < entries.length; later++) {
    const laterKey = entries[later][0];
    const earlier = entries
      .slice(0, later)
      .find(([key]) => [".", "[", ":"].some((separator) => key.startsWith(laterKey + separator)));
    if (earlier) {
      effect = `"${earlier[0]}" is overwritten by the later "${laterKey}" assignment`;
      break;
    }
  }
  return `${effect}. v3 resolution (shortest paths first): ${JSON.stringify(before)}; v4 resolution (authored order): ${JSON.stringify(after)}.`;
}

export function getMutationOrderChanges(feature: ParsedFeature): MutationOrderChange[] {
  const schema = feature.variablesSchema;
  if (!schema) return [];
  const changes: MutationOrderChange[] = [];

  const checkVariables = (
    values: Record<string, unknown> | undefined,
    path: (string | number)[],
  ) => {
    if (!values || Object.keys(values).length < 2) return;
    try {
      const entries = Object.entries(values);
      const after = resolveMutationsForMultipleVariables(schema, values as any);
      const before = resolveMutationsForMultipleVariables(
        schema,
        Object.fromEntries([...entries].sort(([a], [b]) => a.length - b.length)) as any,
      );
      const message = changedMessage(entries, before, after);
      if (message) changes.push({ path, message });
    } catch {
      // Schema validation reports malformed mutation maps.
    }
  };

  const checkOverrides = (
    overrides: Record<string, unknown> | undefined,
    baseValues: Record<string, unknown> | undefined,
    path: (string | number)[],
  ) => {
    for (const [variableKey, values] of Object.entries(overrides || {})) {
      (values as Array<{ mutate?: unknown; value?: unknown }>).forEach((override, index) => {
        const map = override.mutate || override.value;
        if (!schema[variableKey] || !map || typeof map !== "object" || Array.isArray(map)) return;
        const entries = Object.entries(map);
        if (entries.length < 2) return;
        if (!override.mutate && !entries.some(([key]) => /[.:[\]]/.test(key))) return;
        try {
          const base = resolveMutationsForMultipleVariables(schema, baseValues as any)?.[
            variableKey
          ];
          const after = resolveMutationsForSingleVariable(schema, variableKey, map as any, base);
          const before = resolveMutationsForSingleVariable(
            schema,
            variableKey,
            Object.fromEntries([...entries].sort(([a], [b]) => a.length - b.length)) as any,
            base,
          );
          const message = changedMessage(entries, before, after);
          if (message)
            changes.push({
              path: [
                ...path,
                "variableOverrides",
                variableKey,
                index,
                override.mutate ? "mutate" : "value",
              ],
              message,
            });
        } catch {
          // Schema validation reports malformed mutation maps.
        }
      });
    }
  };

  const ruleSets = Array.isArray(feature.rules)
    ? [{ rules: feature.rules, path: ["rules"] as (string | number)[] }]
    : Object.entries(feature.rules || {}).map(([environment, rules]) => ({
        rules: Array.isArray(rules) ? rules : [],
        path: ["rules", environment] as (string | number)[],
      }));
  for (const ruleSet of ruleSets) {
    ruleSet.rules.forEach((rule, index) => {
      const path = [...ruleSet.path, index];
      checkVariables(rule.variables, [...path, "variables"]);
      checkOverrides(rule.variableOverrides, rule.variables, path);
    });
  }
  feature.variations?.forEach((variation, index) => {
    const path = ["variations", index];
    checkVariables(variation.variables, [...path, "variables"]);
    checkOverrides(variation.variableOverrides, variation.variables, path);
  });
  const forceSets = Array.isArray(feature.force)
    ? [{ entries: feature.force, path: ["force"] as (string | number)[] }]
    : Object.entries(feature.force || {}).map(([environment, entries]) => ({
        entries: Array.isArray(entries) ? entries : [],
        path: ["force", environment] as (string | number)[],
      }));
  for (const forceSet of forceSets) {
    forceSet.entries.forEach((entry, index) =>
      checkVariables(entry.variables, [...forceSet.path, index, "variables"]),
    );
  }
  return changes;
}
