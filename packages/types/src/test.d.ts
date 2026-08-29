import type { AttributeValue } from "./attribute";
import type { Context } from "./context";
import type {
  VariableKey,
  FeatureKey,
  VariationValue,
  StickyFeatures,
  VariableValue,
  EnvironmentKey,
  Weight,
  Required,
  RequiredFeature,
  Variation,
  Force,
  ResolvedVariableSchema,
  EvaluatedFeature,
} from "./feature";
import type { Traffic } from "./datafile";
import type { SegmentKey } from "./segment";
import type { TargetKey } from "./target";
import type { StickyVariables, GlobalVariableKey, DatafileVariable } from "./variable";

export interface AssertionMatrix {
  [key: string]: AttributeValue[];
}

export interface ExpectedEvaluation {
  type?: "flag" | "variation" | "variable";
  featureKey?: FeatureKey;
  reason?: string;
  bucketKey?: string;
  bucketValue?: number;
  ruleKey?: string;
  error?: unknown;
  enabled?: boolean;
  traffic?: Traffic;
  forceIndex?: number;
  force?: Force;
  required?: Required[];
  requiredFeatures?: RequiredFeature[];
  stickyFeature?: EvaluatedFeature;
  sticky?: EvaluatedFeature;
  variation?: Variation;
  variationValue?: VariationValue;
  variableKey?: VariableKey | GlobalVariableKey;
  variableValue?: VariableValue;
  variableSchema?: ResolvedVariableSchema;
  variableOverrideIndex?: number;
  variableOverrideKey?: string;
  variableOverridePath?: string[];
  variable?: DatafileVariable;
}

export interface ExpectedEvaluations {
  flag?: ExpectedEvaluation;
  variation?: ExpectedEvaluation;
  variables?: {
    [key: VariableKey]: ExpectedEvaluation;
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
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  environment: EnvironmentKey;
  target?: TargetKey;
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
  promotable?: boolean;
  feature: FeatureKey;
  assertions: FeatureAssertion[];
}

export interface SegmentAssertion {
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  context: Context;
  expectedToMatch: boolean;
}

export interface VariableAssertion {
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  environment?: EnvironmentKey;
  target?: TargetKey;
  at?: Weight; // bucket weight for feature evaluations reached through requiredFeatures
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  context?: Context;
  defaultVariableValue?: VariableValue;
  expectedValue?: VariableValue;
  expectedEvaluation?: ExpectedEvaluation;
}

export interface TestVariable {
  key?: string;
  promotable?: boolean;
  variable: GlobalVariableKey;
  assertions: VariableAssertion[];
}

export interface TestSegment {
  key?: string; // file path
  promotable?: boolean;
  segment: SegmentKey;
  assertions: SegmentAssertion[];
}

export type Test = TestSegment | TestFeature | TestVariable;

/**
 * Used by test runner
 */
export interface TestResultAssertionError {
  type: "flag" | "variation" | "variable" | "segment" | "evaluation";
  expected: unknown;
  actual: unknown;
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
  type: "feature" | "segment" | "variable";
  key: string;
  notFound?: boolean;
  passed: boolean;
  duration: number;
  assertions: TestResultAssertion[];
}
