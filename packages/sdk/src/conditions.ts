import { compareVersions } from "compare-versions";

import { Context, Condition, PlainCondition } from "@featurevisor/types";

import { Logger } from "./logger";

export function conditionIsMatched(condition: PlainCondition, context: Context): boolean {
  const { attribute, operator, value } = condition;

  if (operator === "equals") {
    return context[attribute] === value;
  } else if (operator === "notEquals") {
    return context[attribute] !== value;
  } else if (operator === "before" || operator === "after") {
    // date comparisons
    const valueInContext = context[attribute] as string | Date;

    const dateInContext =
      valueInContext instanceof Date ? valueInContext : new Date(valueInContext);
    const dateInCondition = value instanceof Date ? value : new Date(value as string);

    return operator === "before"
      ? dateInContext < dateInCondition
      : dateInContext > dateInCondition;
  } else if (Array.isArray(value)) {
    // array
    const valueInContext = context[attribute] as string;

    if (operator === "in") {
      return value.indexOf(valueInContext) !== -1;
    } else if (operator === "notIn") {
      return value.indexOf(valueInContext) === -1;
    }
  } else if (typeof context[attribute] === "string" && typeof value === "string") {
    // string
    const valueInContext = context[attribute] as string;

    if (operator === "contains") {
      return valueInContext.indexOf(value) !== -1;
    } else if (operator === "notContains") {
      return valueInContext.indexOf(value) === -1;
    } else if (operator === "startsWith") {
      return valueInContext.startsWith(value);
    } else if (operator === "endsWith") {
      return valueInContext.endsWith(value);
    } else if (operator === "semverEquals") {
      return compareVersions(valueInContext, value) === 0;
    } else if (operator === "semverNotEquals") {
      return compareVersions(valueInContext, value) !== 0;
    } else if (operator === "semverGreaterThan") {
      return compareVersions(valueInContext, value) === 1;
    } else if (operator === "semverGreaterThanOrEquals") {
      return compareVersions(valueInContext, value) >= 0;
    } else if (operator === "semverLessThan") {
      return compareVersions(valueInContext, value) === -1;
    } else if (operator === "semverLessThanOrEquals") {
      return compareVersions(valueInContext, value) <= 0;
    }
  } else if (typeof context[attribute] === "number" && typeof value === "number") {
    // numeric
    const valueInContext = context[attribute] as number;

    if (operator === "greaterThan") {
      return valueInContext > value;
    } else if (operator === "greaterThanOrEquals") {
      return valueInContext >= value;
    } else if (operator === "lessThan") {
      return valueInContext < value;
    } else if (operator === "lessThanOrEquals") {
      return valueInContext <= value;
    }
  }

  return false;
}

export function allConditionsAreMatched(
  conditions: Condition[] | Condition,
  context: Context,
  logger: Logger,
): boolean {
  if ("attribute" in conditions) {
    try {
      return conditionIsMatched(conditions, context);
    } catch (e) {
      logger.warn(e.message, {
        error: e,
        details: {
          condition: conditions,
          context,
        },
      });

      return false;
    }
  }

  if ("and" in conditions && Array.isArray(conditions.and)) {
    return conditions.and.every((c) => allConditionsAreMatched(c, context, logger));
  }

  if ("or" in conditions && Array.isArray(conditions.or)) {
    return conditions.or.some((c) => allConditionsAreMatched(c, context, logger));
  }

  if ("not" in conditions && Array.isArray(conditions.not)) {
    return conditions.not.every(
      () =>
        allConditionsAreMatched(
          {
            and: conditions.not,
          },
          context,
          logger,
        ) === false,
    );
  }

  if (Array.isArray(conditions)) {
    return conditions.every((c) => allConditionsAreMatched(c, context, logger));
  }

  return false;
}
