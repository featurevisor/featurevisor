import type { Condition, Context, DatafileContent } from "@featurevisor/types";
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

  if (Array.isArray(conditions)) {
    return conditions.map((condition) => buildScopedCondition(condition, context, datafileReader));
  }

  return buildScopedCondition(conditions, context, datafileReader);
}

function buildScopedCondition(
  condition: Condition,
  context: Context,
  datafileReader: DatafileReader,
): Condition {
  if (condition === "*") {
    return condition;
  }

  const matched = datafileReader.allConditionsAreMatched(condition, context);

  if (matched) {
    return "*";
  }

  return condition;
}
