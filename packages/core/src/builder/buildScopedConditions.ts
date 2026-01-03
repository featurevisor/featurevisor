import type {
  Condition,
  AndCondition,
  OrCondition,
  NotCondition,
  Context,
  DatafileContent,
} from "@featurevisor/types";
import { DatafileReader, createLogger } from "@featurevisor/sdk";

const emptyDatafile: DatafileContent = {
  schemaVersion: "2",
  revision: "unknown",
  segments: {},
  features: {},
};

export function buildScopedConditions(
  conditions: Condition | Condition[],
  context: Context,
): Condition | Condition[] {
  const datafileReader = new DatafileReader({
    datafile: emptyDatafile,
    logger: createLogger({ level: "fatal" }),
  });

  return buildScopedCondition(conditions, context, datafileReader);
}

export function removeRedundantConditions(
  conditions: Condition | Condition[],
): Condition | Condition[] {
  if (conditions === "*") {
    return conditions;
  }

  if (Array.isArray(conditions)) {
    return conditions.map((c) => removeRedundantConditions(c)) as Condition[];
  }

  if (typeof conditions === "object") {
    // @TODO: remove redundant conditions here
    if ("and" in conditions) {
      return {
        and: conditions.and.map((c) => removeRedundantConditions(c)),
      } as AndCondition;
    }

    if ("or" in conditions) {
      return {
        or: conditions.or.map((c) => removeRedundantConditions(c)),
      } as OrCondition;
    }

    if ("not" in conditions) {
      return {
        not: conditions.not.map((c) => removeRedundantConditions(c)),
      } as NotCondition;
    }
  }

  return conditions;
}

export function buildScopedCondition(
  condition: Condition | Condition[],
  context: Context,
  datafileReader: DatafileReader,
): Condition | Condition[] {
  if (condition === "*") {
    return condition;
  }

  if (Array.isArray(condition)) {
    return condition.map((c) => buildScopedCondition(c, context, datafileReader)) as Condition[];
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
        and: condition.and.map((c) => buildScopedCondition(c, context, datafileReader)),
      } as AndCondition;
    }

    if ("or" in condition) {
      return {
        or: condition.or.map((c) => buildScopedCondition(c, context, datafileReader)),
      } as OrCondition;
    }

    if ("not" in condition) {
      return {
        not: condition.not.map((c) => buildScopedCondition(c, context, datafileReader)),
      } as NotCondition;
    }
  }

  return condition;
}
