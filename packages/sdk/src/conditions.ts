import type {
  Context,
  PlainCondition,
  AttributeValue,
  Condition,
  GroupSegment,
  Segment,
  SegmentKey,
} from "@featurevisor/types";

import { compareVersions } from "./compareVersions.js";
import type { FeaturevisorDiagnosticReporter } from "./diagnostics.js";

export type GetRegex = (regexString: string, regexFlags: string) => RegExp;

export function getValueFromContext(obj: Context, path: string): AttributeValue {
  if (path.indexOf(".") === -1) {
    return obj[path];
  }

  return path
    .split(".")
    .reduce<unknown>(
      (o, i) => (o && typeof o === "object" ? (o as Record<string, unknown>)[i] : undefined),
      obj,
    ) as AttributeValue;
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
  } else if (
    Array.isArray(contextValueFromPath) &&
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null)
  ) {
    // includes / notIncludes (where context value is an array of primitive values)
    const valueInContext = contextValueFromPath as Array<string | number | boolean | null>;
    const primitiveValue = value as string | number | boolean | null;

    if (operator === "includes") {
      return valueInContext.indexOf(primitiveValue) > -1;
    } else if (operator === "notIncludes") {
      return valueInContext.indexOf(primitiveValue) === -1;
    }
  }

  return false;
}

function getUncachedRegex(regexString: string, regexFlags: string): RegExp {
  return new RegExp(regexString, regexFlags);
}

// Package-local normalization helpers. They remain exported from this module
// so instance/evaluator tests can exercise them directly, but the SDK root
// does not expose them as public runtime APIs.
export function parseConditionsIfStringified(
  conditions: Condition | Condition[],
  reportDiagnostic?: FeaturevisorDiagnosticReporter,
): Condition | Condition[] {
  if (typeof conditions !== "string") {
    return conditions;
  }

  if (conditions === "*") {
    return conditions;
  }

  try {
    return JSON.parse(conditions);
  } catch (e) {
    reportDiagnostic?.({
      level: "error",
      code: "conditions_parse_error",
      message: "Error parsing conditions",
      originalError: e,
      conditions,
    });

    return conditions;
  }
}

export function parseSegmentsIfStringified(
  segments: GroupSegment | GroupSegment[],
): GroupSegment | GroupSegment[] {
  if (typeof segments === "string" && (segments.startsWith("{") || segments.startsWith("["))) {
    return JSON.parse(segments);
  }

  return segments;
}

export function allConditionsAreMatched(
  conditions: Condition[] | Condition,
  context: Context,
  getRegex: GetRegex = getUncachedRegex,
  reportDiagnostic?: FeaturevisorDiagnosticReporter,
): boolean {
  if (typeof conditions === "string") {
    return conditions === "*";
  }

  if ("attribute" in conditions) {
    try {
      return conditionIsMatched(conditions, context, getRegex);
    } catch (e) {
      reportDiagnostic?.({
        level: "warn",
        code: "condition_match_error",
        message: e instanceof Error ? e.message : String(e),
        originalError: e,
        condition: conditions,
        context,
      });

      return false;
    }
  }

  if ("and" in conditions && Array.isArray(conditions.and)) {
    return conditions.and.every((c) =>
      allConditionsAreMatched(c, context, getRegex, reportDiagnostic),
    );
  }

  if ("or" in conditions && Array.isArray(conditions.or)) {
    return conditions.or.some((c) =>
      allConditionsAreMatched(c, context, getRegex, reportDiagnostic),
    );
  }

  if ("not" in conditions && Array.isArray(conditions.not)) {
    if (conditions.not.length === 0) {
      return false;
    }

    return (
      allConditionsAreMatched({ and: conditions.not }, context, getRegex, reportDiagnostic) ===
      false
    );
  }

  if (Array.isArray(conditions)) {
    return conditions.every((c) => allConditionsAreMatched(c, context, getRegex, reportDiagnostic));
  }

  return false;
}

export function allSegmentsAreMatched(
  groupSegments: GroupSegment | GroupSegment[] | "*",
  context: Context,
  getSegment: (segmentKey: SegmentKey) => Segment | undefined,
  getRegex: GetRegex = getUncachedRegex,
  reportDiagnostic?: FeaturevisorDiagnosticReporter,
): boolean {
  if (groupSegments === "*") {
    return true;
  }

  if (typeof groupSegments === "string") {
    const segment = getSegment(groupSegments);

    return segment
      ? allConditionsAreMatched(
          parseConditionsIfStringified(segment.conditions, reportDiagnostic),
          context,
          getRegex,
          reportDiagnostic,
        )
      : false;
  }

  if (typeof groupSegments === "object") {
    if ("and" in groupSegments && Array.isArray(groupSegments.and)) {
      return groupSegments.and.every((groupSegment) =>
        allSegmentsAreMatched(groupSegment, context, getSegment, getRegex, reportDiagnostic),
      );
    }

    if ("or" in groupSegments && Array.isArray(groupSegments.or)) {
      return groupSegments.or.some((groupSegment) =>
        allSegmentsAreMatched(groupSegment, context, getSegment, getRegex, reportDiagnostic),
      );
    }

    if ("not" in groupSegments && Array.isArray(groupSegments.not)) {
      if (groupSegments.not.length === 0) {
        return false;
      }

      return (
        allSegmentsAreMatched(
          { and: groupSegments.not },
          context,
          getSegment,
          getRegex,
          reportDiagnostic,
        ) === false
      );
    }
  }

  if (Array.isArray(groupSegments)) {
    return groupSegments.every((groupSegment) =>
      allSegmentsAreMatched(groupSegment, context, getSegment, getRegex, reportDiagnostic),
    );
  }

  return false;
}
