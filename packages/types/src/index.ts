export type AttributeKey = string;

export type AttributeValue = string | number | boolean | null | undefined;

export interface Attributes {
  [key: AttributeKey]: AttributeValue;
}

export interface Attribute {
  archived?: boolean; // only available in YAML
  key: AttributeKey;
  type: AttributeValue;
  capture?: boolean;
}

export type Operator =
  | "equals"
  | "notEquals"

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

  // array of strings
  | "in"
  | "notIn";

export type ConditionValue = string | number | boolean | null | undefined | string[];

export interface PlainCondition {
  attribute: AttributeKey;
  operator: Operator;
  value: ConditionValue;
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

export type Condition = PlainCondition | AndOrNotCondition;

export type SegmentKey = string;

export interface Segment {
  archived?: boolean; // only available in YAML
  key: SegmentKey;
  conditions: Condition | Condition[] | string; // string only when stringified for datafile
}

export type PlainGroupSegment = SegmentKey;

export interface AndGroupSegment {
  and: GroupSegment[];
}

export interface OrGroupSegment {
  or: GroupSegment[];
}

export interface NotGroupSegment {
  not: GroupSegment[];
}

export type AndOrNotGroupSegment = AndGroupSegment | OrGroupSegment | NotGroupSegment;

// group of segment keys with and/or conditions, or just string
export type GroupSegment = PlainGroupSegment | AndOrNotGroupSegment;

export type VariationType = "boolean" | "string" | "integer" | "double";
export type VariationValue = boolean | string | number | null | undefined;

export type VariableKey = string;
export type VariableType =
  | "boolean"
  | "string"
  | "integer"
  | "double"
  | "array"
  | "object"
  | "json";
export interface VariableObjectValue {
  [key: string]: VariableValue;
}
export type VariableValue =
  | boolean
  | string
  | number
  | string[]
  | VariableObjectValue
  | null
  | undefined;

export interface VariableOverrideSegments {
  segments: GroupSegment | GroupSegment[];
}

export interface VariableOverrideConditions {
  conditions: Condition | Condition[];
}

export interface VariableOverrideBase {
  value: VariableValue;
}

export type VariableOverrideSegmentsOrConditions =
  | VariableOverrideSegments
  | VariableOverrideConditions;

// export type VariableOverride = VariableOverrideBase & VariableOverrideSegmentsOrConditions;

export interface VariableOverride {
  value: VariableValue;

  // one of the below must be present in YAML
  // @TODO: try with above commented out TypeScript later
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];
}

export interface Variable {
  key: VariableKey;
  value: VariableValue;
  overrides?: VariableOverride[];
}

export interface Variation {
  description?: string; // only available in YAML
  type: VariationType;
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: Variable[];
}

export interface VariableSchema {
  key: VariableKey;
  type: VariableType;
  defaultValue: VariableValue;
}

export type FeatureKey = string;

export interface Force {
  // one of the below must be present in YAML
  // @TODO: make it better with TypeScript
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];

  variation: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export type BucketKey = string;
export type BucketValue = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

/**
 * Datafile-only types
 */
export type Percentage = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

export interface Allocation {
  variation: VariationValue;
  percentage: Percentage;
}

export interface Traffic {
  key: RuleKey;
  segments: GroupSegment | GroupSegment[] | "*";
  percentage: Percentage;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
  allocation: Allocation[];
}

export type BucketBy = AttributeKey | AttributeKey[]; // @TODO: have first available attribute as well?
export interface Feature {
  key: FeatureKey;
  // @TODO: introduce new `parent` key?
  // @TODO: introduce `type` for distinguishing between feature flags and experiments?
  defaultVariation: VariationValue;
  variablesSchema?: VariableSchema[];
  variations: Variation[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
}

export interface DatafileContent {
  schemaVersion: string;
  revision: string;
  attributes: Attribute[];
  segments: Segment[];
  features: Feature[];
}

/**
 * YAML-only type
 */
export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type RuleKey = string;

export interface Rule {
  key: RuleKey;
  segments: GroupSegment | GroupSegment[];
  percentage: Weight;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export interface Environment {
  expose?: boolean;
  rules: Rule[];
  force?: Force[];
}

export interface ParsedFeature {
  key: FeatureKey;

  archived: boolean;
  description: string;
  tags: string[];

  bucketBy?: AttributeKey | AttributeKey[]; // @TODO: have first available attribute as well?

  defaultVariation: VariationValue;
  variablesSchema?: VariableSchema[];
  variations: Variation[];

  environments: {
    [key: EnvironmentKey]: Environment;
  };
}

/**
 * For maintaining old allocations info,
 * allowing for gradual rollout of new allocations
 * with consistent bucketing
 */
export interface ExistingFeature {
  variations: {
    // @TODO: use Exclude with Variation?
    value: VariationValue;
    weight: Weight;
  }[];
  traffic: {
    // @TODO: use Exclude with Traffic?
    key: RuleKey;
    percentage: Percentage;
    allocation: Allocation[];
  }[];
}

export interface ExistingFeatures {
  [key: FeatureKey]: ExistingFeature;
}

export interface ExistingState {
  features: ExistingFeatures;
}

/**
 * Site index and history
 */
export interface HistoryEntity {
  type: "attribute" | "segment" | "feature";
  key: string;
}

export interface HistoryEntry {
  commit: string;
  author: string;
  timestamp: string;
  entities: HistoryEntity[];
}

export interface LastModified {
  commit: string;
  timestamp: string;
  author: string;
}

export interface SearchIndex {
  links?: {
    feature: string;
    segment: string;
    attribute: string;
    commit: string;
  };
  entities: {
    attributes: (Attribute & {
      lastModified?: LastModified;
      usedInSegments: SegmentKey[];
      usedInFeatures: FeatureKey[];
    })[];
    segments: (Segment & {
      lastModified?: LastModified;
      usedInFeatures: FeatureKey[];
    })[];
    features: (ParsedFeature & {
      lastModified?: LastModified;
    })[];
  };
}
