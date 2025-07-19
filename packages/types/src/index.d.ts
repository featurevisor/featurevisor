import { Attribute, AttributeKey, AttributeValue } from "./attribute";
import { Condition } from "./condition";
import { Context } from "./context";

export * from "./attribute";
export * from "./context";
export * from "./condition";

export type SegmentKey = string;

export interface Segment {
  archived?: boolean; // only available in YAML files
  key?: SegmentKey; // needed for supporting v1 datafile generation
  conditions: Condition | Condition[]; // string only when stringified for datafile
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

export type VariableOverrideSegmentsOrConditions =
  | VariableOverrideSegments
  | VariableOverrideConditions;

export interface VariableOverride {
  value: VariableValue;

  // one of the below must be present in YAML files
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];
}

export interface VariableV1 {
  key: VariableKey;
  value: VariableValue;
  description?: string; // only available in YAML files
  overrides?: VariableOverride[];
}

export interface VariationV1 {
  description?: string; // only available in YAML files
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: VariableV1[];
}

export interface Variation {
  description?: string; // only available in YAML files
  value: VariationValue;
  weight?: Weight; // 0 to 100 (available from parsed YAML, but not in datafile)
  variables?: {
    [key: VariableKey]: VariableValue;
  };
  variableOverrides?: {
    [key: VariableKey]: VariableOverride[];
  };
}

export interface VariableSchema {
  deprecated?: boolean;
  key?: VariableKey; // @NOTE: remove
  type: VariableType;
  defaultValue: VariableValue;
  description?: string; // only available in YAML files
  useDefaultWhenDisabled?: boolean;
  disabledValue?: VariableValue;
}

export type FeatureKey = string;

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
  range: Range;
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
  variationWeights?: {
    [key: string]: Weight;
  };

  allocation?: Allocation[];
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
  key?: FeatureKey; // needed for supporting v1 datafile generation
  hash?: string;
  deprecated?: boolean;
  required?: Required[];
  variablesSchema?: Record<VariableKey, VariableSchema>;
  disabledVariationValue?: VariationValue;
  variations?: Variation[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges
}

export interface FeatureV1 {
  key?: FeatureKey;
  hash?: string;
  deprecated?: boolean;
  required?: Required[];
  bucketBy: BucketBy;
  traffic: Traffic[];
  force?: Force[];
  ranges?: Range[]; // if in a Group (mutex), these are the available slot ranges

  variablesSchema?: VariableSchema[];
  variations?: VariationV1[];
}

export interface DatafileContentV1 {
  schemaVersion: string;
  revision: string;
  attributes: Attribute[];
  segments: Segment[];
  features: FeatureV1[];
}

export interface DatafileContent {
  schemaVersion: string;
  revision: string;
  segments: {
    [key: SegmentKey]: Segment;
  };
  features: {
    [key: FeatureKey]: Feature;
  };
}

export interface EvaluatedFeature {
  enabled: boolean;
  variation?: VariationValue;
  variables?: {
    [key: VariableKey]: VariableValue;
  };
}

export interface EvaluatedFeatures {
  [key: FeatureKey]: EvaluatedFeature;
}

export type StickyFeatures = EvaluatedFeatures;

/**
 * YAML-only type
 */
export type Weight = number; // 0 to 100

export type EnvironmentKey = string; // ideally "production", "staging", "testing", or "development" only

export type Tag = string;

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
  variationWeights?: {
    [key: string]: Weight;
  };
}

export interface RulesByEnvironment {
  [key: EnvironmentKey]: Rule[];
}

export interface Force {
  // one of the below must be present in YAML
  conditions?: Condition | Condition[];
  segments?: GroupSegment | GroupSegment[];

  enabled?: boolean;
  variation?: VariationValue;
  variables?: {
    [key: string]: VariableValue;
  };
}

export interface ForceByEnvironment {
  [key: EnvironmentKey]: Force[];
}

export type Expose = boolean | Tag[];

export interface ExposeByEnvironment {
  [key: EnvironmentKey]: Expose;
}

export interface ParsedFeature {
  key: FeatureKey;

  archived?: boolean;
  deprecated?: boolean;

  description: string;
  tags: Tag[];

  required?: Required[];

  bucketBy: BucketBy;

  disabledVariationValue?: VariationValue;

  variablesSchema?: Record<VariableKey, VariableSchema>;
  variations?: Variation[];

  expose?: ExposeByEnvironment | Expose;
  force?: ForceByEnvironment | Force[];
  rules?: RulesByEnvironment | Rule[];
}

/**
 * For maintaining old allocations info,
 * allowing for gradual rollout of new allocations
 * with consistent bucketing
 */
export interface ExistingFeature {
  hash?: string;
  variations?: {
    value: VariationValue;
    weight: Weight;
  }[];
  traffic: {
    key: RuleKey;
    percentage: Percentage;
    allocation?: Allocation[];
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

export interface ExpectedEvaluations {
  flag?: Record<string, any>;
  variation?: Record<string, any>;
  variables?: {
    [key: VariableKey]: Record<string, any>;
  };
}

export interface FeatureChildAssertion {
  sticky?: StickyFeatures;
  context?: Context;

  defaultVariationValue?: VariationValue;
  defaultVariableValues?: {
    [key: string]: VariableValue;
  };

  expectedToBeEnabled?: boolean;
  expectedVariation?: VariationValue;
  expectedVariables?: {
    [key: VariableKey]: VariableValue;
  };
  expectedEvaluations?: ExpectedEvaluations;
}

export interface FeatureAssertion {
  matrix?: AssertionMatrix;
  description?: string;
  environment: EnvironmentKey;
  at?: Weight; // bucket weight: 0 to 100

  sticky?: StickyFeatures;
  context?: Context;

  defaultVariationValue?: VariationValue;
  defaultVariableValues?: {
    [key: string]: VariableValue;
  };

  expectedToBeEnabled?: boolean;
  expectedVariation?: VariationValue;
  expectedVariables?: {
    [key: VariableKey]: VariableValue;
  };
  expectedEvaluations?: ExpectedEvaluations;

  children?: FeatureChildAssertion[];
}

export interface TestFeature {
  key?: string; // file path
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
  key?: string; // file path
  segment: SegmentKey;
  assertions: SegmentAssertion[];
}

export type Test = TestSegment | TestFeature;

export interface TestResultAssertionError {
  type: "flag" | "variation" | "variable" | "segment" | "evaluation";
  expected: string | number | boolean | Date | null | undefined;
  actual: string | number | boolean | Date | null | undefined;
  message?: string;
  details?: {
    evaluationType?: string; // e.g., "flag", "variation", "variable"
    evaluationKey?: string; // e.g., "myFeatureKey", "myVariableKey"
    childIndex?: number; // for children assertions
    [key: string]: any;
  };
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
