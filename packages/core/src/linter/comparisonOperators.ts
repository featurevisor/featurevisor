import { checkOperators } from "../tester/checks";
import { applyCombinationToValue, getMatrixCombinations } from "../list/matrix";
import type { AssertionMatrix } from "@featurevisor/types";

/** Use the same exact operator names accepted by authored CLI checks. */
export const comparisonOperators = checkOperators;

export type PolicyPath = Array<string | number>;

/** Traverse only comparison expressions, never unrelated objects such as mutation values. */
export function findDisallowedOperators(
  expression: unknown,
  disallowed: readonly string[],
  path: PolicyPath,
): Array<{ path: PolicyPath; operator: string }> {
  if (!expression || typeof expression !== "object") return [];
  if (Array.isArray(expression)) {
    return expression.flatMap((entry, index) =>
      findDisallowedOperators(entry, disallowed, [...path, index]),
    );
  }
  const record = expression as Record<string, unknown>;
  const results: Array<{ path: PolicyPath; operator: string }> = [];
  if (typeof record.operator === "string" && disallowed.includes(record.operator)) {
    results.push({ path: [...path, "operator"], operator: record.operator });
  }
  for (const group of ["and", "or", "not"]) {
    if (Object.prototype.hasOwnProperty.call(record, group)) {
      results.push(...findDisallowedOperators(record[group], disallowed, [...path, group]));
    }
  }
  return results;
}

/** Inspect only authored selectors, including nested rules and override trees. */
export function findDisallowedAuthoredOperators(
  definition: unknown,
  disallowed: readonly string[],
  path: PolicyPath = [],
): Array<{ path: PolicyPath; operator: string }> {
  if (!definition || typeof definition !== "object") return [];
  if (Array.isArray(definition)) {
    return definition.flatMap((entry, index) =>
      findDisallowedAuthoredOperators(entry, disallowed, [...path, index]),
    );
  }
  const record = definition as Record<string, unknown>;
  // At these paths the object is a map, not an authored selector node. Its keys
  // may happen to equal selector field names, so descend without interpreting them.
  const parent = path[path.length - 1];
  if (
    parent === "rules" ||
    parent === "force" ||
    parent === "variableOverrides" ||
    parent === "overrides"
  ) {
    return Object.entries(record).flatMap(([key, value]) =>
      findDisallowedAuthoredOperators(value, disallowed, [...path, key]),
    );
  }
  const results: Array<{ path: PolicyPath; operator: string }> = [];
  for (const field of ["conditions"]) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      results.push(...findDisallowedOperators(record[field], disallowed, [...path, field]));
    }
  }
  for (const field of ["rules", "force", "variations", "variableOverrides", "overrides"]) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      results.push(...findDisallowedAuthoredOperators(record[field], disallowed, [...path, field]));
    }
  }
  return results;
}

/** Inspect authored check containers, not expected values or unrelated literals. */
export function findDisallowedCheckOperators(
  spec: unknown,
  disallowed: readonly string[],
  path: PolicyPath = [],
): Array<{ path: PolicyPath; operator: string }> {
  if (!spec || typeof spec !== "object") return [];
  if (Array.isArray(spec)) {
    return spec.flatMap((entry, index) =>
      findDisallowedCheckOperators(entry, disallowed, [...path, index]),
    );
  }
  const record = spec as Record<string, unknown>;
  if (record.matrix && typeof record.matrix === "object" && !Array.isArray(record.matrix)) {
    const { matrix, ...body } = record;
    return getMatrixCombinations(matrix as AssertionMatrix).flatMap((combination) =>
      findDisallowedCheckOperators(applyCombinationToValue(body, combination), disallowed, path),
    );
  }
  const issues = Object.prototype.hasOwnProperty.call(record, "checks")
    ? findDisallowedOperators(record.checks, disallowed, [...path, "checks"])
    : [];
  for (const field of ["assertions", "children"]) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      issues.push(...findDisallowedCheckOperators(record[field], disallowed, [...path, field]));
    }
  }
  return issues;
}
