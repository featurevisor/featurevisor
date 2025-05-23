export type AttributeKey = string;

export type AttributeValue = string | number | boolean | Date | null | undefined;

export interface Context {
  [key: AttributeKey]: AttributeValue;
}

export type AttributeType = "boolean" | "string" | "integer" | "double" | "date" | "semver";

export interface Attribute {
  archived?: boolean; // only available in YAML files
  key: AttributeKey;
  type: AttributeType;
  capture?: boolean;
  description?: string; // only available in YAML files
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

  // date comparisons
  | "before"
  | "after"

  // array of strings
  | "in"
  | "notIn";

export type ConditionValue = string | number | boolean | Date | null | undefined | string[];

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
  archived?: boolean; // only available in YAML files
  key: SegmentKey;
  conditions: Condition | Condition[] | string; // string only when stringified for datafile
  description?: string; // only available in YAML files
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

export type VariationValue = string;

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

  // one of the below must be present in YAML files
  // @TODO: try with above commented out TypeScript later
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];
}

export interface Variable {
  key: VariableKey;
  value: VariableValue;
  description?: string; // only available in YAML files
  overrides?: VariableOverride[];
}

export interface Variation {
  description?: string; // only available in YAML files
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: Variable[];
}

export interface VariableSchema {
  deprecated?: boolean;
  key: VariableKey;
  type: VariableType;
  defaultValue: VariableValue;
  description?: string; // only available in YAML files
}

export type FeatureKey = string;

export interface Force {
  // one of the below must be present in YAML
  // @TODO: make it better with TypeScript
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export interface Slot {
  feature: FeatureKey | false;
  percentage: Weight; // 0 to 100
}

export interface Group {
  key: string;
  description: string;
  slots: Slot[];
}

export type BucketKey = string;
export type BucketValue = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

/**
 * Datafile-only types
 */
export type Percentage = number; // 0 to 100,000 (100% * 1000 to include three decimal places in same integer)

export type Range = [Percentage, Percentage]; // 0 to 100k

export interface Allocation {
  variation: VariationValue;
  range: Range; // @TODO: in future, turn it into `ranges`, so that Allocations with same variation do not repeat
}

export interface Traffic {
  key: RuleKey;
  segments: GroupSegment | GroupSegment[] | "*";
  percentage: Percentage;

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };

  allocation: Allocation[]; // @TODO: in v2, make it optional
}

export type PlainBucketBy = AttributeKey;
export type AndBucketBy = AttributeKey[];
export interface OrBucketBy {
  or: AttributeKey[];
}
export type BucketBy = PlainBucketBy | AndBucketBy | OrBucketBy;

export interface RequiredWithVariation {
  key: FeatureKey;
  variation: VariationValue;
}

export type Required = FeatureKey | RequiredWithVariation;

export interface Feature {
  key: FeatureKey;
  deprecated?: boolean;
  required?: Required[];
  variablesSchema?: VariableSchema[] | Record<VariableKey, VariableSchema>;
  variations?: Variation[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface DatafileContentV1 {
  schemaVersion: string;
  revision: string;
  attributes: Attribute[];
  segments: Segment[];
  features: Feature[];
}

export interface DatafileContentV2 {
  schemaVersion: string;
  revision: string;
  attributes: {
    [key: AttributeKey]: Attribute;
  };
  segments: {
    [key: SegmentKey]: Segment;
  };
  features: {
    [key: FeatureKey]: Feature;
  };
}

export type DatafileContent = DatafileContentV1 | DatafileContentV2;

export interface OverrideFeature {
  enabled: boolean;
  variation?: VariationValue;
  variables?: {
    [key: VariableKey]: VariableValue;
  };
}

export interface StickyFeatures {
  [key: FeatureKey]: OverrideFeature;
}

export type InitialFeatures = StickyFeatures;

/**
 * YAML-only type
 */
export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type RuleKey = string;

export interface Rule {
  key: RuleKey;
  description?: string; // only available in YAML
  segments: GroupSegment | GroupSegment[];
  percentage: Weight;

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export type Tag = string;

export type Expose = boolean | Tag[];

export interface Environment {
  expose?: Expose;
  rules: Rule[];
  force?: Force[];
}

export interface ParsedFeature {
  key: FeatureKey;

  archived?: boolean;
  deprecated?: boolean;

  description: string;
  tags: Tag[];

  required?: Required[];

  bucketBy: BucketBy;

  variablesSchema?: VariableSchema[];
  variations?: Variation[];

  // if using environments
  environments?: {
    [key: EnvironmentKey]: Environment;
  };

  // if not using environments
  expose?: Expose;
  rules?: Rule[];
  force?: Force[];
}

/**
 * For maintaining old allocations info,
 * allowing for gradual rollout of new allocations
 * with consistent bucketing
 */
export interface ExistingFeature {
  variations?: {
    // @TODO: use Exclude with Variation?
    value: VariationValue;
    weight: Weight;
  }[];
  traffic: {
    // @TODO: use Exclude with Traffic?
    key: RuleKey;
    percentage: Percentage;
    allocation: Allocation[]; // @TODO: in v2, make it optional
  }[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface ExistingFeatures {
  [key: FeatureKey]: ExistingFeature;
}

export interface ExistingState {
  features: ExistingFeatures;
}

/**
 * Tests
 */
export interface AssertionMatrix {
  [key: string]: AttributeValue[];
}

export interface FeatureAssertion {
  matrix?: AssertionMatrix;
  description?: string;
  environment: EnvironmentKey;
  at: Weight; // bucket weight: 0 to 100
  context: Context;
  expectedToBeEnabled: boolean;
  expectedVariation?: VariationValue;
  expectedVariables?: {
    [key: VariableKey]: VariableValue;
  };
}

export interface TestFeature {
  feature: FeatureKey;
  assertions: FeatureAssertion[];
}

export interface SegmentAssertion {
  matrix?: AssertionMatrix;
  description?: string;
  context: Context;
  expectedToMatch: boolean;
}

export interface TestSegment {
  segment: SegmentKey;
  assertions: SegmentAssertion[];
}

export type Test = TestSegment | TestFeature;

export interface TestResultAssertionError {
  type: "flag" | "variation" | "variable" | "segment";
  expected: string | number | boolean | Date | null | undefined;
  actual: string | number | boolean | Date | null | undefined;
  message?: string;
  details?: object;
}

export interface TestResultAssertion {
  description: string;
  duration: number;
  passed: boolean;
  errors?: TestResultAssertionError[];
}

export interface TestResult {
  type: "feature" | "segment";
  key: string;
  notFound?: boolean;
  passed: boolean;
  duration: number;
  assertions: TestResultAssertion[];
}

/**
 * Site index and history
 */
export type EntityType = "attribute" | "segment" | "feature" | "group" | "test";

export type CommitHash = string;

export interface HistoryEntity {
  type: EntityType;
  key: string;
}

export interface HistoryEntry {
  commit: CommitHash;
  author: string;
  timestamp: string;
  entities: HistoryEntity[];
}

export interface LastModified {
  commit: CommitHash;
  timestamp: string;
  author: string;
}

export interface SearchIndex {
  links?: {
    feature: string;
    segment: string;
    attribute: string;
    commit: CommitHash;
  };
  projectConfig: {
    tags: Tag[];
    environments: EnvironmentKey[] | false;
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

export interface EntityDiff {
  type: EntityType;
  key: string;
  created?: boolean;
  deleted?: boolean;
  updated?: boolean;
  content?: string;
}

export interface Commit {
  hash: CommitHash;
  author: string;
  timestamp: string;
  entities: EntityDiff[];
}
