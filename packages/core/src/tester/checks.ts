import { allConditionsAreMatched, getPortableTimestamp } from "@featurevisor/sdk";
import type {
  PlainCondition,
  TestVariableReference,
  TestCheckReference,
  FeatureCheck,
  SegmentCheck,
  VariableCheck,
  TestResultAssertionError,
} from "@featurevisor/types";
import { getBacktrackingError } from "../linter/regexSafety";

const own = (value: object, key: string | number) =>
  Object.prototype.hasOwnProperty.call(value, key);
const emptiness = ["empty", "notEmpty"];
const unary = ["exists", "notExists", "isNull", "notNull", ...emptiness];
const numeric = ["greaterThan", "greaterThanOrEquals", "lessThan", "lessThanOrEquals"];
const strings = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "matches",
  "notMatches",
  "semverEquals",
  "semverNotEquals",
  "semverGreaterThan",
  "semverGreaterThanOrEquals",
  "semverLessThan",
  "semverLessThanOrEquals",
];
export const checkOperators = [
  ...unary,
  ...numeric,
  ...strings,
  "equals",
  "notEquals",
  "before",
  "after",
  "includes",
  "notIncludes",
  "includesAny",
  "notIncludesAny",
  "in",
  "notIn",
];
const missing = Symbol("missing test path");
const scalar = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));

function getEmptinessSize(value: unknown): number | null {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value && Object.prototype.toString.call(value) === "[object Object]") {
    for (const key in value as object) {
      if (own(value as object, key)) return 1;
    }
    return 0;
  }
  return null;
}

function hasLogicalGroup<T extends "and" | "or" | "not">(
  check: VariableCheck,
  operator: T,
): check is Extract<VariableCheck, Record<T, VariableCheck[]>> {
  return own(check, operator);
}

export function getCheckPath(path: unknown): Array<string | number> {
  if (path === undefined) return [];
  const parts = typeof path === "string" ? path.split(".") : path;
  if (!Array.isArray(parts)) throw new Error("path must be a string or an array");
  return parts.map((part) => {
    if (typeof part === "string") {
      if (
        ["__proto__", "prototype", "constructor"].includes(part) ||
        part.includes("*") ||
        (typeof path === "string" && !part)
      )
        throw new Error("Unsafe, wildcard or empty path component");
      if (typeof path === "string" && /^(0|[1-9]\d*)$/.test(part)) {
        if (!Number.isSafeInteger(Number(part)))
          throw new Error("Path index must be a safe integer");
        return Number(part);
      }
      return part;
    }
    if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0) return part;
    throw new Error("Path components must be string keys or nonnegative integer indices");
  });
}

export function validateCheckReference(
  reference: unknown,
  owner?: string,
): asserts reference is TestVariableReference {
  if (!reference || typeof reference !== "object" || Array.isArray(reference))
    throw new Error("Expected a variable reference");
  const r = reference as TestVariableReference;
  if (Object.keys(r).some((k) => !["feature", "variable", "path"].includes(k)))
    throw new Error("Unknown variable reference property");
  if (r.feature !== undefined && (typeof r.feature !== "string" || !r.feature))
    throw new Error("feature must be a nonempty string");
  if (r.variable !== undefined && (typeof r.variable !== "string" || !r.variable))
    throw new Error("variable must be a nonempty string");
  if (!r.variable && (!owner || r.feature !== undefined))
    throw new Error("An explicit variable is required in a scenario or feature reference");
  getCheckPath(r.path);
}

export function getCheckReferences(checks: unknown, owner?: string): TestCheckReference[] {
  if (!Array.isArray(checks) || !checks.length)
    throw new Error("checks and logical groups must be nonempty arrays");
  const siblingKeys = new Set<string>();
  for (let index = 0; index < checks.length; index++) {
    if (!own(checks, index)) throw new Error("checks and logical groups cannot be sparse arrays");
    const check = checks[index];
    if (!check || typeof check !== "object" || Array.isArray(check)) continue;
    if (own(check, "key")) {
      if (typeof check.key !== "string" || !check.key.length) {
        throw new Error("Check keys must be nonempty strings");
      }
      if (siblingKeys.has(check.key)) {
        throw new Error(`Duplicate sibling check key "${check.key}"`);
      }
      siblingKeys.add(check.key);
    }
    if (own(check, "description") && typeof check.description !== "string") {
      throw new Error("Check descriptions must be strings");
    }
  }
  return checks.flatMap((check) => {
    if (!check || typeof check !== "object" || Array.isArray(check))
      throw new Error("Invalid check");
    const keys = Object.keys(check);
    const structuralKeys = keys.filter((key) => !["key", "description"].includes(key));
    const groups = structuralKeys.filter((k) => ["and", "or", "not"].includes(k));
    if (groups.length) {
      if (structuralKeys.length !== 1)
        throw new Error("A logical group must contain exactly one operator");
      return getCheckReferences(check[groups[0]], owner);
    }
    if (own(check, "segment") || own(check, "matches")) {
      if (keys.some((key) => !["key", "description", "segment", "matches"].includes(key)))
        throw new Error("Segment checks only accept segment and matches");
      if (typeof check.segment !== "string" || !check.segment)
        throw new Error("Segment checks require a nonempty segment key");
      if (typeof check.matches !== "boolean")
        throw new Error("Segment check matches must be a boolean");
      return [{ segment: check.segment }];
    }
    if (own(check, "enabled") || own(check, "variation")) {
      if (keys.some((k) => !["key", "description", "feature", "enabled", "variation"].includes(k)))
        throw new Error("Feature checks only accept feature, enabled and variation");
      if (!own(check, "feature") || typeof check.feature !== "string" || !check.feature)
        throw new Error("Feature checks require a nonempty feature key");
      if (own(check, "enabled") && typeof check.enabled !== "boolean")
        throw new Error("Feature check enabled must be a boolean");
      if (
        own(check, "variation") &&
        check.variation !== null &&
        typeof check.variation !== "string"
      )
        throw new Error("Feature check variation must be a string or null");
      return [{ feature: check.feature }];
    }
    if (
      keys.some(
        (k) =>
          ![
            "key",
            "description",
            "feature",
            "variable",
            "path",
            "operator",
            "value",
            "compareTo",
            "regexFlags",
          ].includes(k),
      )
    )
      throw new Error("Unknown check property");
    if (!checkOperators.includes(check.operator))
      throw new Error(`Unknown check operator "${check.operator}"`);
    const reference: TestVariableReference = {};
    for (const k of ["feature", "variable", "path"]) if (own(check, k)) reference[k] = check[k];
    validateCheckReference(reference, owner);
    const operands = Number(own(check, "value")) + Number(own(check, "compareTo"));
    if (operands !== (unary.includes(check.operator) ? 0 : 1))
      throw new Error(
        "Provide exactly one of value or compareTo, or neither for presence/null operators",
      );
    if (own(check, "regexFlags")) {
      if (
        !["matches", "notMatches"].includes(check.operator) ||
        typeof check.regexFlags !== "string" ||
        !/^(?!.*(.).*\1)[gims]*$/.test(check.regexFlags)
      )
        throw new Error("Invalid portable regex flags");
    }
    if (own(check, "compareTo")) {
      validateCheckReference(check.compareTo, owner);
      return [reference, check.compareTo];
    }
    if (own(check, "value")) validateOperand(check.operator, check.value);
    return [reference];
  });
}

function portableRegex(pattern: string, flags = "") {
  if (
    /\(\?/.test(pattern) ||
    /\\(?:[1-9]|k<|k'|g<|g')/.test(pattern) ||
    /(?:[?*+]|\{\d+(?:,\d*)?\})\+/.test(pattern)
  )
    throw new Error("Unsupported portable regular expression");
  const backtracking = getBacktrackingError(pattern);
  if (backtracking) throw new Error(`Regular expression ${backtracking}.`);
  return new RegExp(pattern, flags);
}

export function parsePortableTimestamp(value: string): number {
  const timestamp = getPortableTimestamp(value);
  if (timestamp === null) {
    throw new Error("Date comparisons require portable timestamps within years 0001 to 9999 UTC");
  }

  return timestamp;
}

function validateOperand(operator: string, value: unknown) {
  if (numeric.includes(operator)) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Numeric comparison requires finite numbers");
  } else if (strings.includes(operator) || ["before", "after"].includes(operator)) {
    if (typeof value !== "string") throw new Error("String comparison requires strings");
    if (["matches", "notMatches"].includes(operator)) portableRegex(value);
    if (["before", "after"].includes(operator)) parsePortableTimestamp(value);
  } else if (["in", "notIn", "includesAny", "notIncludesAny"].includes(operator)) {
    if (!Array.isArray(value) || !value.every(scalar))
      throw new Error("Membership comparison requires an array of primitive values");
  } else if (!scalar(value))
    throw new Error(
      "Comparison requires a primitive value; use expectedValue for structured equality",
    );
}

export type CheckResolver = (reference: TestVariableReference & { variable: string }) => unknown;
export type FeatureCheckResolver = (feature: string, property: "enabled" | "variation") => unknown;
export type SegmentCheckResolver = (segment: string) => boolean;

function resolve(
  reference: TestVariableReference,
  owner: string | undefined,
  getter: CheckResolver,
): unknown {
  const { path, feature } = reference;
  let value = getter({ feature, variable: reference.variable || owner! });
  for (const part of getCheckPath(path)) {
    if (typeof part === "number") {
      if (!Array.isArray(value) || !own(value, part)) return missing;
    } else if (!value || typeof value !== "object" || !own(value, part)) return missing;
    value = value[part];
  }
  return value;
}

export function runVariableChecks(
  checks: VariableCheck[],
  getter: CheckResolver,
  owner?: string,
  childIndex?: number,
  featureGetter?: FeatureCheckResolver,
  segmentGetter?: SegmentCheckResolver,
): TestResultAssertionError[] {
  const errors: TestResultAssertionError[] = [];
  const display = (v: unknown) => (v === missing ? "<missing>" : v);
  try {
    getCheckReferences(checks, owner);
  } catch (error) {
    return [
      {
        type: "check",
        expected: "valid checks",
        actual: checks,
        message: String(error),
        details: { childIndex },
      },
    ];
  }
  checks.forEach((check, index) => {
    const evaluated: unknown[] = [];
    function matches(node: VariableCheck, path: Array<string | number>): boolean {
      if (hasLogicalGroup(node, "and"))
        return node.and.every((c, i) => matches(c, [...path, "and", i]));
      if (hasLogicalGroup(node, "or"))
        return node.or.some((c, i) => matches(c, [...path, "or", i]));
      if (hasLogicalGroup(node, "not"))
        return !node.not.every((c, i) => matches(c, [...path, "not", i]));
      if (own(node, "segment")) {
        const check = node as SegmentCheck;
        const trace = {
          path,
          key: check.key,
          description: check.description,
          reference: { segment: check.segment },
          property: "matches",
          operator: "equals",
          actual: "<unresolved>" as unknown,
          expected: check.matches,
        };
        evaluated.push(trace);
        if (!segmentGetter) throw new Error("Segment check resolver is required");
        trace.actual = segmentGetter(check.segment);
        return trace.actual === trace.expected;
      }
      if (own(node, "enabled") || own(node, "variation")) {
        const featureCheck = node as FeatureCheck;
        let matched = true;
        for (const property of ["enabled", "variation"] as const) {
          if (!own(featureCheck, property)) continue;
          const trace = {
            path,
            key: featureCheck.key,
            description: featureCheck.description,
            reference: { feature: featureCheck.feature },
            property,
            operator: "equals",
            actual: "<unresolved>" as unknown,
            expected: featureCheck[property],
          };
          evaluated.push(trace);
          if (!featureGetter) throw new Error("Feature check resolver is required");
          trace.actual = featureGetter(featureCheck.feature, property);
          if (trace.actual !== trace.expected) matched = false;
        }
        return matched;
      }
      // Feature expectations were validated and handled above.
      if (!node.operator) throw new Error("A variable check operator is required");
      const trace = {
        path,
        key: node.key,
        description: node.description,
        reference: { variable: node.variable || owner, feature: node.feature, path: node.path },
        operator: node.operator,
        actual: "<unresolved>" as unknown,
        actualMissing: false,
        expectedMissing: false,
        compareTo: node.compareTo
          ? { ...node.compareTo, variable: node.compareTo.variable || owner }
          : undefined,
        expected: node.compareTo ? ("<unresolved>" as unknown) : node.value,
      };
      evaluated.push(trace);
      const left = resolve(node, owner, getter);
      trace.actual = display(left);
      trace.actualMissing = left === missing;
      const right = node.compareTo ? resolve(node.compareTo, owner, getter) : node.value;
      trace.expected = display(right);
      trace.expectedMissing = right === missing;
      if (node.operator === "exists") return left !== missing && left !== undefined;
      if (node.operator === "notExists") return left === missing || left === undefined;
      if (node.operator === "isNull") return left === null;
      if (node.operator === "notNull")
        return left !== missing && left !== undefined && left !== null;
      if (emptiness.includes(node.operator)) {
        if (left === missing || left === undefined || left === null) return false;
        const size = getEmptinessSize(left);
        if (size === null)
          throw new Error("Emptiness checks require a string, array or plain object");
        return node.operator === "empty" ? size === 0 : size > 0;
      }
      if (left === missing || right === missing) return false;
      validateOperand(node.operator, right);
      if (numeric.includes(node.operator)) validateOperand(node.operator, left);
      else if (strings.includes(node.operator) || ["before", "after"].includes(node.operator)) {
        if (typeof left !== "string") throw new Error("String comparison requires strings");
        if (["before", "after"].includes(node.operator)) validateOperand(node.operator, left);
      } else if (
        ["includes", "notIncludes", "includesAny", "notIncludesAny"].includes(node.operator)
      ) {
        if (!Array.isArray(left))
          throw new Error("includes comparisons require an array on the left");
      } else if (["in", "notIn"].includes(node.operator)) {
        if (left !== null && typeof left !== "string" && typeof left !== "number")
          throw new Error("in comparisons require a string, number or null on the left");
      } else if (!scalar(left)) throw new Error("Equality checks require primitive values");
      return allConditionsAreMatched(
        {
          attribute: "actual",
          operator: node.operator,
          value: right,
          regexFlags: node.regexFlags,
        } as PlainCondition,
        { actual: left } as any,
        portableRegex,
        (d) => {
          throw new Error(d.message);
        },
      );
    }
    try {
      if (matches(check, [index])) return;
      errors.push({
        type: "check",
        expected: true,
        actual: false,
        details: {
          checkIndex: index,
          checkKey: check.key,
          checkDescription: check.description,
          evaluated,
          childIndex,
        },
      });
    } catch (error) {
      errors.push({
        type: "check",
        expected: "successful comparison",
        actual: String(error),
        details: {
          checkIndex: index,
          checkKey: check.key,
          checkDescription: check.description,
          evaluated,
          childIndex,
        },
      });
    }
  });
  return errors;
}
