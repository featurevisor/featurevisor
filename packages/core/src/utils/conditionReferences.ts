import type { ConditionLeaf, Conditions } from "@featurevisor/types";
import { walkConditionLeaves } from "../datasource/conditions";

/** Preserve structural references even in branches that would short circuit. */
export function conditionLeaves(value: unknown): ConditionLeaf[] {
  const leaves: ConditionLeaf[] = [];
  walkConditionLeaves(value as Conditions | undefined, (leaf) => leaves.push(leaf));
  return leaves;
}

/** Visit selector locations, never arbitrary variable values or mutation operands. */
export function definitionConditionLeaves(value: unknown): ConditionLeaf[] {
  if (Array.isArray(value)) return value.flatMap(definitionConditionLeaves);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const result = conditionLeaves(record.conditions);
  for (const field of ["rules", "force", "variations", "variableOverrides", "overrides"]) {
    const nested = record[field];
    if (Array.isArray(nested)) result.push(...definitionConditionLeaves(nested));
    else if (nested && typeof nested === "object")
      for (const entries of Object.values(nested))
        result.push(...definitionConditionLeaves(entries));
  }
  return result;
}
