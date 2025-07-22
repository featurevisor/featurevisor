import type {
  FeatureKey,
  Context,
  RuleKey,
  Traffic,
  Force,
  Required,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  VariableSchema,
  EvaluatedFeature,
  StickyFeatures,
} from "@featurevisor/types";

import { Logger } from "./logger";
import { HooksManager } from "./hooks";
import { DatafileReader } from "./datafileReader";
import { BucketKey, BucketValue } from "./bucketer";

export enum EvaluationReason {
  // feature specific
  FEATURE_NOT_FOUND = "feature_not_found", // feature is not found in datafile
  DISABLED = "disabled", // feature is disabled
  REQUIRED = "required", // required features are not enabled
  OUT_OF_RANGE = "out_of_range", // out of range when mutually exclusive experiments are involved via Groups

  // variations specific
  NO_VARIATIONS = "no_variations", // feature has no variations
  VARIATION_DISABLED = "variation_disabled", // feature is disabled, and variation's disabledVariationValue is used

  // variable specific
  VARIABLE_NOT_FOUND = "variable_not_found", // variable's schema is not defined in the feature
  VARIABLE_DEFAULT = "variable_default", // default variable value used
  VARIABLE_DISABLED = "variable_disabled", // feature is disabled, and variable's disabledValue is used
  VARIABLE_OVERRIDE = "variable_override", // variable overridden from inside a variation

  // common
  NO_MATCH = "no_match", // no rules matched
  FORCED = "forced", // against a forced rule
  STICKY = "sticky", // against a sticky feature
  RULE = "rule", // against a regular rule
  ALLOCATED = "allocated", // regular allocation based on bucketing

  ERROR = "error", // error
}

export interface Evaluation {
  // required
  type: EvaluationType;
  featureKey: FeatureKey;
  reason: EvaluationReason;

  // common
  bucketKey?: BucketKey;
  bucketValue?: BucketValue;
  ruleKey?: RuleKey;
  error?: Error;
  enabled?: boolean;
  traffic?: Traffic;
  forceIndex?: number;
  force?: Force;
  required?: Required[];
  sticky?: EvaluatedFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: VariableSchema;
}

export interface EvaluateDependencies {
  context: Context;

  logger: Logger;
  hooksManager: HooksManager;
  datafileReader: DatafileReader;

  // OverrideOptions
  sticky?: StickyFeatures;

  defaultVariationValue?: VariationValue;
  defaultVariableValue?: VariableValue;

  flagEvaluation?: Evaluation;
}

type EvaluationType = "flag" | "variation" | "variable";

export interface EvaluateParams {
  type: EvaluationType;
  featureKey: FeatureKey;
  variableKey?: VariableKey;
}

export type EvaluateOptions = EvaluateParams & EvaluateDependencies;
