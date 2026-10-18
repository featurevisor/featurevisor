import type { Context } from "./context";
import type {
  VariableKey,
  FeatureKey,
  VariationValue,
  StickyFeatures,
  VariableValue,
  EnvironmentKey,
  Weight,
  Variation,
  Force,
  ResolvedVariableSchema,
  EvaluatedFeature,
} from "./feature";
import type { Traffic } from "./datafile";
import type { Segment, SegmentKey } from "./segment";
import type { TargetKey } from "./target";
import type { StickyVariables, DatafileVariable } from "./variable";
import type { Conditions } from "./condition";

export type AssertionMatrixValue =
  | string
  | number
  | boolean
  | null
  | AssertionMatrixValue[]
  | { [key: string]: AssertionMatrixValue };

export interface AssertionMatrix {
  [key: string]: AssertionMatrixValue[];
}

export type TestEntityType = "feature" | "segment" | "variable" | "scenario";

/** Normalized input for CLI test runners, independent of report and datafile versions. */
export interface TestExecutionDocument {
  kind: "featurevisor.test-execution";
  schemaVersion: 1;
  tests: Test[];
}

/** Added only to normalized test specs when execution metadata is requested. */
export interface TestExecutionMetadata {
  source: string;
  set: string | null;
  entityType: TestEntityType;
}

/** Added only to normalized, expanded assertions when execution metadata is requested. */
export interface TestCaseExecutionMetadata {
  id: string;
  assertionIndex: number;
  matrixIndex: number | null;
  matrixValues: Record<string, AssertionMatrixValue>;
}

export interface ExpectedEvaluation {
  conditions?: Conditions;
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
  stickyFeature?: EvaluatedFeature;
  variation?: Variation;
  variationValue?: VariationValue;
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: ResolvedVariableSchema;
  variableOverrideIndex?: number;
  variableOverrideKey?: string;
  variableOverridePath?: string[];
  variableOverridePaths?: string[][];
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
  /** Documentation only. */
  description?: string;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
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
  _case?: TestCaseExecutionMetadata;
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  environment?: EnvironmentKey;
  target?: TargetKey;
  at: Weight; // bucket weight: 0 to 100

  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
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
  _test?: TestExecutionMetadata;
  key?: string; // file path
  promotable?: boolean;
  feature: FeatureKey;
  assertions: FeatureAssertion[];
}

export interface SegmentAssertion {
  _case?: TestCaseExecutionMetadata;
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  context: Context;
  environment?: EnvironmentKey;
  target?: TargetKey;
  at?: Weight;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  expectedToMatch: boolean;
}

export interface VariableAssertion {
  _case?: TestCaseExecutionMetadata;
  key?: string;
  promotable?: boolean;
  matrix?: AssertionMatrix;
  description?: string;
  environment?: EnvironmentKey;
  target?: TargetKey;
  at?: Weight; // percentage position for feature evaluations reached through conditions
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  context?: Context;
  defaultVariableValue?: VariableValue;
  expectedValue?: VariableValue;
  expectedEvaluation?: ExpectedEvaluation;
  checks?: TestCheck[];
  children?: VariableChildAssertion[];
}

export interface VariableChildAssertion {
  /** Documentation only. */
  description?: string;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  context?: Context;
  defaultVariableValue?: VariableValue;
  expectedValue?: VariableValue;
  expectedEvaluation?: ExpectedEvaluation;
  checks?: TestCheck[];
}

/** A CLI test operand. Omitted variable inherits a global variable spec's key. */
export interface TestVariableReference {
  variable?: string;
  feature?: string;
  path?: string | Array<string | number>;
}

/** A reference discovered in a test check, before optional variable owner resolution. */
export type TestCheckReference =
  | (TestVariableReference & { segment?: never })
  | { feature: string; variable?: never; path?: never; segment?: never }
  | { segment: string; feature?: never; variable?: never; path?: never };

/** Only explicitly supplied feature expectations are checked. */
export interface TestCheckMetadata {
  key?: string;
  description?: string;
}

export type FeatureCheck = TestCheckMetadata & {
  segment?: never;
  matches?: never;
  feature: string;
  variable?: never;
  path?: never;
  operator?: never;
  value?: never;
  compareTo?: never;
  regexFlags?: never;
} & (
    | { enabled: boolean; variation?: string | null }
    | { enabled?: boolean; variation: string | null }
  );

type UnaryCheckOperator = "exists" | "notExists" | "isNull" | "notNull" | "empty" | "notEmpty";
type ComparisonCheckOperator = Exclude<import("./condition").Operator, UnaryCheckOperator>;
type TestCheckValue = string | number | boolean | null | Array<string | number | boolean | null>;

/** Match an authored segment against the effective test context. */
export type SegmentCheck = TestCheckMetadata & {
  segment: SegmentKey;
  matches: boolean;
  feature?: never;
  variable?: never;
  path?: never;
  operator?: never;
  value?: never;
  compareTo?: never;
  regexFlags?: never;
  enabled?: never;
  variation?: never;
};

/** CLI checks compare evaluated getter results without altering runtime behaviour. */
export type TestCheck =
  | FeatureCheck
  | SegmentCheck
  | (TestCheckMetadata &
      TestVariableReference & {
        enabled?: never;
        variation?: never;
        segment?: never;
        matches?: never;
      } & (
        | { operator: UnaryCheckOperator; value?: never; compareTo?: never; regexFlags?: never }
        | {
            operator: ComparisonCheckOperator;
            value: TestCheckValue;
            compareTo?: never;
            regexFlags?: string;
          }
        | {
            operator: ComparisonCheckOperator;
            compareTo: TestVariableReference;
            value?: never;
            regexFlags?: string;
          }
      ))
  | (TestCheckMetadata & { and: TestCheck[] })
  | (TestCheckMetadata & { or: TestCheck[] })
  | (TestCheckMetadata & { not: TestCheck[] });

/** Existing name retained for consumers of variable assertion types. */
export type VariableCheck = TestCheck;

export interface ScenarioChildAssertion {
  /** Documentation only. */
  description?: string;
  context?: Context;
  stickyFeatures?: StickyFeatures;
  stickyVariables?: StickyVariables;
  checks: TestCheck[];
}

export interface ScenarioAssertion extends Omit<
  VariableAssertion,
  "expectedValue" | "expectedEvaluation" | "defaultVariableValue" | "children"
> {
  children?: ScenarioChildAssertion[];
}

/** A child situation in an authored scenario spec. */
export type ScenarioChild = ScenarioChildAssertion;

/** Authored anywhere in tests/, with one situation and checks at the root. */
export interface Scenario extends Omit<ScenarioAssertion, "_case" | "key" | "checks" | "children"> {
  checks: TestCheck[];
  children?: ScenarioChild[];
}

/** Normalized execution format shared by CLI runners, not the authoring format. */
export interface TestScenario {
  /** Segment closure included in expanded listings, compiled in the execution protocol. */
  _segments?: Record<SegmentKey, Segment>;
  _test?: TestExecutionMetadata;
  key?: string;
  promotable?: boolean;
  scenario: string;
  assertions: ScenarioAssertion[];
}

export interface TestVariable {
  /** Segment closure included in expanded listings, compiled in the execution protocol. */
  _segments?: Record<SegmentKey, Segment>;
  _test?: TestExecutionMetadata;
  key?: string;
  promotable?: boolean;
  variable: VariableKey;
  assertions: VariableAssertion[];
}

export interface TestSegment {
  /** Compiled segment closure supplied only by the CLI execution protocol. */
  _segments?: Record<SegmentKey, Segment>;
  _test?: TestExecutionMetadata;
  key?: string; // file path
  promotable?: boolean;
  segment: SegmentKey;
  assertions: SegmentAssertion[];
}

export type Test = TestSegment | TestFeature | TestVariable | TestScenario;

/**
 * Used by test runner
 */
export interface TestResultAssertionError {
  type: "flag" | "variation" | "variable" | "segment" | "evaluation" | "check";
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
  type: "feature" | "segment" | "variable" | "scenario";
  key: string;
  notFound?: boolean;
  passed: boolean;
  duration: number;
  assertions: TestResultAssertion[];
}
