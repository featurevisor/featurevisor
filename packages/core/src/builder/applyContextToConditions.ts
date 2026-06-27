import type {
  Condition,
  AndCondition,
  OrCondition,
  NotCondition,
  Context,
} from "@featurevisor/types";
import type { Featurevisor } from "@featurevisor/sdk";

export function applyContextToConditions(
  datafileReader: Featurevisor,
  conditions: Condition | Condition[],
  context: Context,
): Condition | Condition[] {
  const withContextApplied = applyContextToCondition(datafileReader, conditions, context);
  const removed = removeRedundantConditions(withContextApplied);

  return removed;
}

export function removeRedundantConditions(
  conditions: Condition | Condition[],
): Condition | Condition[] {
  if (conditions === "*") {
    return conditions;
  }

  if (Array.isArray(conditions)) {
    // Recursively process each condition
    const processed = conditions.map((c) => removeRedundantConditions(c)) as Condition[];

    // Filter out "*" values
    const filtered = processed.filter((c) => c !== "*");

    // If all were "*", return "*"
    if (filtered.length === 0) {
      return "*";
    }

    return filtered;
  }

  if (typeof conditions === "object") {
    if ("and" in conditions) {
      const processed = conditions.and.map((c) => removeRedundantConditions(c)) as Condition[];
      const filtered = processed.filter((c) => c !== "*");

      // If all were "*", return "*"
      if (filtered.length === 0) {
        return "*";
      }

      return {
        and: filtered,
      } as AndCondition;
    }

    if ("or" in conditions) {
      const processed = conditions.or.map((c) => removeRedundantConditions(c)) as Condition[];
      const filtered = processed.filter((c) => c !== "*");

      // If all were "*", return "*"
      if (filtered.length === 0) {
        return "*";
      }

      return {
        or: filtered,
      } as OrCondition;
    }

    if ("not" in conditions) {
      const processed = conditions.not.map((c) => removeRedundantConditions(c)) as Condition[];
      const filtered = processed.filter((c) => c !== "*");

      // `not` negates the implicit AND of its children. Matched children are true
      // and can be removed: not(true && X) becomes not(X). If every child was
      // true, keep not("*") so it remains an always-false expression.
      if (filtered.length === 0) {
        return {
          not: ["*"],
        } as NotCondition;
      }

      return {
        not: filtered,
      } as NotCondition;
    }
  }

  return conditions;
}

export function applyContextToCondition(
  datafileReader: Featurevisor,
  condition: Condition | Condition[],
  context: Context,
): Condition | Condition[] {
  if (condition === "*") {
    return condition;
  }

  if (Array.isArray(condition)) {
    return condition.map((c) => applyContextToCondition(datafileReader, c, context)) as Condition[];
  }

  if (typeof condition === "object") {
    // plain condition
    if ("attribute" in condition) {
      const matched = datafileReader.allConditionsAreMatched(condition, context);

      if (matched) {
        return "*";
      }
    }

    // AND, OR, NOT conditions
    if ("and" in condition) {
      return {
        and: condition.and.map((c) => applyContextToCondition(datafileReader, c, context)),
      } as AndCondition;
    }

    if ("or" in condition) {
      return {
        or: condition.or.map((c) => applyContextToCondition(datafileReader, c, context)),
      } as OrCondition;
    }

    if ("not" in condition) {
      return {
        not: condition.not.map((c) => applyContextToCondition(datafileReader, c, context)),
      } as NotCondition;
    }
  }

  return condition;
}
