import type { AttributeKey } from "./attribute";

export type Operator =
  | "equals"
  | "notEquals"
  | "exists"
  | "notExists"

  // numeric
  | "greaterThan"
  | "greaterThanOrEquals"
  | "lessThan"
  | "lessThanOrEquals"

  // string
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"

  // semver (string)
  | "semverEquals"
  | "semverNotEquals"
  | "semverGreaterThan"
  | "semverGreaterThanOrEquals"
  | "semverLessThan"
  | "semverLessThanOrEquals"

  // date comparisons
  | "before"
  | "after"

  // array of strings
  | "includes"
  | "notIncludes"

  // regex
  | "matches"
  | "notMatches"

  // array of strings
  | "in"
  | "notIn";

export type ConditionValue = string | number | boolean | Date | null | undefined | string[];

export interface PlainCondition {
  attribute: AttributeKey;
  operator: Operator;
  value?: ConditionValue; // for all operators, except for "exists" and "notExists"
  regexFlags?: string; // for regex operators only (matches, notMatches)
}

export interface AndCondition {
  and: Condition[];
}

export interface OrCondition {
  or: Condition[];
}

export interface NotCondition {
  not: Condition[];
}

export type AndOrNotCondition = AndCondition | OrCondition | NotCondition;

export type Condition = PlainCondition | AndOrNotCondition | string;
