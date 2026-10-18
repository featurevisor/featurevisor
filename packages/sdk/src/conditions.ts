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

/**
 * Parse the shared calendar, timezone and millisecond date comparison format.
 * @internal Shared with the CLI, not a supported application API.
 */
export function getPortableTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return timestamp >= -62135596800000 && timestamp <= 253402300799999 ? timestamp : null;
  }
  if (typeof value !== "string") return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts) return null;
  const year = +parts[1],
    month = +parts[2],
    day = +parts[3];
  const offsetHour = +(parts[10] || 0),
    offsetMinute = +(parts[11] || 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    +parts[4] > 23 ||
    +parts[5] > 59 ||
    +parts[6] > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  )
    return null;
  const date = new Date(0);
  // setUTCFullYear preserves years 0001 to 0099, unlike the Date.UTC shortcut.
  date.setUTCFullYear(year, month - 1, day);
  const timestamp =
    date.setUTCHours(+parts[4], +parts[5], +parts[6], +((parts[7] || "") + "000").slice(0, 3)) -
    (offsetHour * 60 + offsetMinute) * (parts[9] === "-" ? -60000 : 60000);
  return timestamp >= -62135596800000 && timestamp <= 253402300799999 ? timestamp : null;
}

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
  return valueIsMatched(getValueFromContext(context, condition.attribute), condition, getRegex);
}

/** Shared comparisons for context conditions and evaluated variable requirements. */
export function valueIsMatched(
  contextValueFromPath: unknown,
  condition: Pick<PlainCondition, "operator" | "value" | "regexFlags">,
  getRegex: GetRegex,
): boolean {
  const { operator, value, regexFlags } = condition;

  if (operator === "isNull") return contextValueFromPath === null;
  if (operator === "notNull")
    return contextValueFromPath !== undefined && contextValueFromPath !== null;

  if (operator === "empty" || operator === "notEmpty") {
    let size = -1;
    if (typeof contextValueFromPath === "string" || Array.isArray(contextValueFromPath)) {
      size = contextValueFromPath.length;
    } else if (
      contextValueFromPath &&
      Object.prototype.toString.call(contextValueFromPath) === "[object Object]"
    ) {
      size = 0;
      // Only presence matters. Do not count or allocate all object keys.
      for (const key in contextValueFromPath as object) {
        if (Object.prototype.hasOwnProperty.call(contextValueFromPath, key)) {
          size = 1;
          break;
        }
      }
    }
    return size >= 0 && (operator === "empty" ? size === 0 : size > 0);
  }

  if (operator === "equals") {
    return contextValueFromPath === value;
  } else if (operator === "notEquals") {
    return contextValueFromPath !== value;
  } else if (operator === "before" || operator === "after") {
    // date comparisons
    const dateInContext = getPortableTimestamp(contextValueFromPath);
    const dateInCondition = getPortableTimestamp(value);

    if (dateInContext === null || dateInCondition === null) {
      return false;
    }

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
      regex.lastIndex = 0;
      return regex.test(valueInContext);
    } else if (operator === "notMatches") {
      const regex = getRegex(value, regexFlags || "");
      regex.lastIndex = 0;
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
  } else if (Array.isArray(contextValueFromPath)) {
    if (operator === "includes" || operator === "notIncludes") {
      return (
        (value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean") &&
        (contextValueFromPath.indexOf(value) !== -1) === (operator === "includes")
      );
    } else if (
      Array.isArray(value) &&
      (operator === "includesAny" || operator === "notIncludesAny")
    ) {
      // Validate the complete candidate list before a positive or negative match.
      for (let i = 0; i < value.length; i++) {
        const candidate = value[i];
        if (
          candidate !== null &&
          typeof candidate !== "string" &&
          typeof candidate !== "number" &&
          typeof candidate !== "boolean"
        )
          return false;
      }
      const matched = value.some((candidate) => contextValueFromPath.indexOf(candidate) !== -1);
      return matched === (operator === "includesAny");
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

  if (!/^[{[\"]/.test(conditions)) {
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
      details: { conditions },
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
  if (!conditions || (typeof conditions !== "object" && typeof conditions !== "string"))
    return false;
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
        details: { condition: conditions, context },
      });

      return false;
    }
  }

  if ("and" in conditions && Array.isArray(conditions.and)) {
    return (
      conditions.and.length > 0 &&
      conditions.and.every((c) => allConditionsAreMatched(c, context, getRegex, reportDiagnostic))
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
    return (
      conditions.length > 0 &&
      conditions.every((c) => allConditionsAreMatched(c, context, getRegex, reportDiagnostic))
    );
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
