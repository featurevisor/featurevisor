import {
  FeatureKey,
  Context,
  BucketKey,
  BucketValue,
  RuleKey,
  Traffic,
  Force,
  Required,
  OverrideFeature,
  Variation,
  VariationValue,
  VariableKey,
  VariableValue,
  VariableSchema,
  StickyFeatures,
  InitialFeatures,
} from "@featurevisor/types";

import { Logger } from "./logger";
import { DatafileReader } from "./datafileReader";
import { getBucket } from "./bucket";
import { getMatchedTraffic, findForceFromFeature } from "./feature";

export enum EvaluationReason {
  NOT_FOUND = "not_found",
  NO_VARIATIONS = "no_variations",
  NO_MATCH = "no_match",
  DISABLED = "disabled",
  REQUIRED = "required",
  OUT_OF_RANGE = "out_of_range",
  FORCED = "forced",
  INITIAL = "initial",
  STICKY = "sticky",
  RULE = "rule",
  ALLOCATED = "allocated",
  DEFAULTED = "defaulted",
  OVERRIDE = "override",
  ERROR = "error",
}

type EvaluationType = "flag" | "variation" | "variable";

export interface Evaluation {
  // required
  // type: EvaluationType; // @TODO: bring in later
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
  sticky?: OverrideFeature;
  initial?: OverrideFeature;

  // variation
  variation?: Variation;
  variationValue?: VariationValue;

  // variable
  variableKey?: VariableKey;
  variableValue?: VariableValue;
  variableSchema?: VariableSchema;
}

export interface EvaluateOptions {
  type: EvaluationType;

  featureKey: FeatureKey;
  context: Context;

  stickyFeatures: StickyFeatures;
  initialFeatures: InitialFeatures;

  logger: Logger;
  datafileReader: DatafileReader;

  bucketKeySeparator: string;
}

export function evaluate(options: EvaluateOptions): Evaluation {
  let evaluation: Evaluation = {
    // type: options.type, // @TODO: bring in later
    featureKey: options.featureKey,
    reason: EvaluationReason.NOT_FOUND,
  };

  return evaluation;
}
