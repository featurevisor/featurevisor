import { compareVersions } from "compare-versions";

import { Attributes, Condition, PlainCondition } from "@featurevisor/types";

export function conditionIsMatched(condition: PlainCondition, attributes: Attributes): boolean {
  const { attribute, operator, value } = condition;

  if (operator === "equals") {
    return attributes[attribute] === value;
  } else if (operator === "notEquals") {
    return attributes[attribute] !== value;
  } else if (operator === "before" || operator === "after") {
    // date comparisons
    const valueInAttributes = attributes[attribute] as string | Date;

    const dateInAttributes =
      valueInAttributes instanceof Date ? valueInAttributes : new Date(valueInAttributes);
    const dateInCondition = value instanceof Date ? value : new Date(value as string);

    return operator === "before"
      ? dateInAttributes < dateInCondition
      : dateInAttributes > dateInCondition;
  } else if (typeof attributes[attribute] === "string" && Array.isArray(value)) {
    // array
    const valueInAttributes = attributes[attribute] as string;

    if (operator === "in") {
      return value.indexOf(valueInAttributes) !== -1;
    } else if (operator === "notIn") {
      return value.indexOf(valueInAttributes) === -1;
    }
  } else if (typeof attributes[attribute] === "string" && typeof value === "string") {
    // string
    const valueInAttributes = attributes[attribute] as string;

    if (operator === "contains") {
      return valueInAttributes.indexOf(value) !== -1;
    } else if (operator === "notContains") {
      return valueInAttributes.indexOf(value) === -1;
    } else if (operator === "startsWith") {
      return valueInAttributes.startsWith(value);
    } else if (operator === "endsWith") {
      return valueInAttributes.endsWith(value);
    } else if (operator === "semverEquals") {
      return compareVersions(valueInAttributes, value) === 0;
    } else if (operator === "semverNotEquals") {
      return compareVersions(valueInAttributes, value) !== 0;
    } else if (operator === "semverGreaterThan") {
      return compareVersions(valueInAttributes, value) === 1;
    } else if (operator === "semverGreaterThanOrEquals") {
      return compareVersions(valueInAttributes, value) >= 0;
    } else if (operator === "semverLessThan") {
      return compareVersions(valueInAttributes, value) === -1;
    } else if (operator === "semverLessThanOrEquals") {
      return compareVersions(valueInAttributes, value) <= 0;
    }
  } else if (typeof attributes[attribute] === "number" && typeof value === "number") {
    // numeric
    const valueInAttributes = attributes[attribute] as number;

    if (operator === "greaterThan") {
      return valueInAttributes > value;
    } else if (operator === "greaterThanOrEquals") {
      return valueInAttributes >= value;
    } else if (operator === "lessThan") {
      return valueInAttributes < value;
    } else if (operator === "lessThanOrEquals") {
      return valueInAttributes <= value;
    }
  }

  return false;
}

export function allConditionsAreMatched(
  conditions: Condition[] | Condition,
  attributes: Attributes,
): boolean {
  if ("attribute" in conditions) {
    return conditionIsMatched(conditions, attributes);
  }

  if ("and" in conditions && Array.isArray(conditions.and)) {
    return conditions.and.every((c) => allConditionsAreMatched(c, attributes));
  }

  if ("or" in conditions && Array.isArray(conditions.or)) {
    return conditions.or.some((c) => allConditionsAreMatched(c, attributes));
  }

  if ("not" in conditions && Array.isArray(conditions.not)) {
    return conditions.not.every(
      (c) =>
        allConditionsAreMatched(
          {
            and: conditions.not,
          },
          attributes,
        ) === false,
    );
  }

  if (Array.isArray(conditions)) {
    return conditions.every((c) => allConditionsAreMatched(c, attributes));
  }

  return false;
}
