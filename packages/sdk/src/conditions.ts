import type { Context, PlainCondition, AttributeValue } from "@featurevisor/types";

import { GetRegex } from "./datafileReader";
import { compareVersions } from "./compareVersions";

export function getValueFromContext(obj, path): AttributeValue {
  if (path.indexOf(".") === -1) {
    return obj[path];
  }

  return path.split(".").reduce((o, i) => (o ? o[i] : undefined), obj);
}

export function conditionIsMatched(
  condition: PlainCondition,
  context: Context,
  getRegex: GetRegex,
): boolean {
  const { attribute, operator, value, regexFlags } = condition;
  const contextValueFromPath = getValueFromContext(context, attribute) as AttributeValue;

  if (operator === "equals") {
    return contextValueFromPath === value;
  } else if (operator === "notEquals") {
    return contextValueFromPath !== value;
  } else if (operator === "before" || operator === "after") {
    // date comparisons
    const valueInContext = contextValueFromPath as string | Date;

    const dateInContext =
      valueInContext instanceof Date ? valueInContext : new Date(valueInContext);
    const dateInCondition = value instanceof Date ? value : new Date(value as string);

    return operator === "before"
      ? dateInContext < dateInCondition
      : dateInContext > dateInCondition;
  } else if (
    Array.isArray(value) &&
    (["string", "number"].indexOf(typeof contextValueFromPath) !== -1 ||
      contextValueFromPath === null)
  ) {
    // in / notIn (where condition value is an array)
    const valueInContext = contextValueFromPath as string;

    if (operator === "in") {
      return value.indexOf(valueInContext) !== -1;
    } else if (operator === "notIn") {
      return value.indexOf(valueInContext) === -1;
    }
  } else if (typeof contextValueFromPath === "string" && typeof value === "string") {
    // string
    const valueInContext = contextValueFromPath as string;

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
    } else if (operator === "matches") {
      const regex = getRegex(value, regexFlags || "");
      return regex.test(valueInContext);
    } else if (operator === "notMatches") {
      const regex = getRegex(value, regexFlags || "");
      return !regex.test(valueInContext);
    }
  } else if (typeof contextValueFromPath === "number" && typeof value === "number") {
    // numeric
    const valueInContext = contextValueFromPath as number;

    if (operator === "greaterThan") {
      return valueInContext > value;
    } else if (operator === "greaterThanOrEquals") {
      return valueInContext >= value;
    } else if (operator === "lessThan") {
      return valueInContext < value;
    } else if (operator === "lessThanOrEquals") {
      return valueInContext <= value;
    }
  } else if (operator === "exists") {
    return typeof contextValueFromPath !== "undefined";
  } else if (operator === "notExists") {
    return typeof contextValueFromPath === "undefined";
  } else if (Array.isArray(contextValueFromPath) && typeof value === "string") {
    // includes / notIncludes (where context value is an array)
    const valueInContext = contextValueFromPath as string[];

    if (operator === "includes") {
      return valueInContext.indexOf(value) > -1;
    } else if (operator === "notIncludes") {
      return valueInContext.indexOf(value) === -1;
    }
  }

  return false;
}
