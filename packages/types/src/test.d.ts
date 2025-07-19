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
} from "./feature";
import type { SegmentKey } from "./segment";

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

/**
 * Used by test runner
 */
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
