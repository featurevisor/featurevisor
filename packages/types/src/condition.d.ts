import type { AttributeKey } from "./attribute";

export type Operator =
  | "equals"
  | "notEquals"
  | "exists"
  | "notExists"
  | "isNull"
  | "notNull"
  | "empty"
  | "notEmpty"

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

  // array membership
  | "includes"
  | "notIncludes"
  | "includesAny"
  | "notIncludesAny"

  // regex
  | "matches"
  | "notMatches"

  // array of strings
  | "in"
  | "notIn";

export type ConditionValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | Array<string | number | boolean | null>;

export interface AttributeCondition {
  attribute: AttributeKey;
  operator: Operator;
  value?: ConditionValue; // omitted for presence, null and emptiness operators
  regexFlags?: string; // for regex operators only (matches, notMatches)
}

/** @deprecated Use AttributeCondition. */
export type PlainCondition = AttributeCondition;

export interface FeatureCondition {
  feature: string;
  /** Expected result from isEnabled(). Defaults to true. */
  enabled?: boolean;
  /** Expected result from getVariation(), also when disabled. */
  variation?: string;
}

/** Variable keys are literal. Only path selects inside the evaluated value. */
export interface VariableCondition {
  variable: string;
  feature?: string;
  path?: string | (string | number)[];
  operator: Operator;
  value?: ConditionValue;
  regexFlags?: string;
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

export type ConditionLeaf = AttributeCondition | FeatureCondition | VariableCondition | string;
export type Condition = ConditionLeaf | AndOrNotCondition;
/** Arrays mean AND. The wildcard is valid only as the entire expression. */
export type Conditions = Condition | Condition[] | "*";
