import type { Condition, Conditions, Context } from "@featurevisor/types";
import { allConditionsAreMatched } from "@featurevisor/sdk";
import type { Featurevisor } from "@featurevisor/sdk";
import { parseConditions } from "../datasource/conditions";

type PartialResult = { value: boolean | undefined; conditions: Conditions };
const constant = (value: boolean): PartialResult => ({
  value,
  conditions: value ? "*" : { or: [] },
});

/** Resolve supplied context only. Dependencies remain runtime expressions. */
function specialize(
  featurevisor: Pick<Featurevisor, "getSegment"> | undefined,
  input: Conditions,
  context: Context | undefined,
  visiting = new Set<string>(),
): PartialResult {
  const conditions = parseConditions(input);
  if (conditions === "*") return constant(true);
  if (typeof conditions === "string") {
    if (!featurevisor || visiting.has(conditions)) return { value: undefined, conditions };
    const segment = featurevisor.getSegment(conditions);
    if (!segment) return { value: undefined, conditions };
    const next = new Set(visiting);
    next.add(conditions);
    const result = specialize(featurevisor, segment.conditions, context, next);
    return result.value === undefined ? { value: undefined, conditions } : constant(result.value);
  }
  const group = Array.isArray(conditions)
    ? "array"
    : "and" in conditions
      ? "and"
      : "or" in conditions
        ? "or"
        : "not" in conditions
          ? "not"
          : undefined;
  if (group) {
    const entries: Condition[] = Array.isArray(conditions)
      ? conditions
      : group === "and" && "and" in conditions
        ? conditions.and
        : group === "or" && "or" in conditions
          ? conditions.or
          : "not" in conditions
            ? conditions.not
            : [];
    // Empty expressions are false, even NOT, matching the runtime contract.
    if (!entries.length) return constant(false);
    const results = entries.map((entry) => specialize(featurevisor, entry, context, visiting));
    const decisive = group === "or";
    const boundary = results.findIndex((result) => result.value === decisive);
    const prefix = boundary === -1 ? results : results.slice(0, boundary);
    const children = prefix
      .filter((result) => result.value === undefined)
      .map((result) => result.conditions as Condition);
    if (boundary !== -1) {
      // Earlier unknown leaves may evaluate dependencies and invoke modules.
      // Keep those reads before the decisive constant, but not skipped branches.
      if (!children.length) return constant(group === "not" ? !decisive : decisive);
      children.push(constant(decisive).conditions as Condition);
    } else if (!children.length) return constant(group !== "not" && group !== "or");
    return {
      value: undefined,
      conditions:
        group === "array"
          ? children
          : group === "or"
            ? { or: children }
            : group === "not"
              ? { not: children }
              : { and: children },
    };
  }
  if (typeof conditions !== "object" || !("attribute" in conditions) || !context)
    return { value: undefined, conditions };
  let value: unknown = context;
  // Missing paths are unknown because a Target supplies only part of the context.
  for (const key of conditions.attribute.split(".")) {
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key))
      return { value: undefined, conditions };
    value = (value as Record<string, unknown>)[key];
  }
  return constant(allConditionsAreMatched(conditions, context));
}

export function applyContextToConditions(
  featurevisor: Featurevisor,
  conditions: Conditions,
  context: Context,
): Conditions {
  return specialize(featurevisor, conditions, context).conditions;
}
export function removeRedundantConditions(conditions: Conditions): Conditions {
  return specialize(undefined, conditions, undefined).conditions;
}
/** Transitional internal name. */
export const applyContextToCondition = applyContextToConditions;
