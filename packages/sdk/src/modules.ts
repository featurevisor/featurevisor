import type { BucketBy, Context, FeatureKey } from "@featurevisor/types";

import type { EvaluateOptions, Evaluation } from "./evaluate.js";
import type { BucketKey, BucketValue } from "./bucketer.js";
import type {
  FeaturevisorDiagnosticHandler,
  FeaturevisorModuleReportedDiagnostic,
  FeaturevisorModuleDiagnosticOptions,
} from "./diagnostics.js";

/**
 * bucketKey
 */
export interface ConfigureBucketKeyOptions {
  featureKey: FeatureKey;
  context: Context;
  bucketBy: BucketBy;
  bucketKey: string; // the initial bucket key, which can be modified by modules
}

export type ConfigureBucketKey = (options: ConfigureBucketKeyOptions) => BucketKey;

/**
 * bucketValue
 */
export interface ConfigureBucketValueOptions {
  featureKey: FeatureKey;
  bucketKey: string;
  context: Context;
  bucketValue: number; // the initial bucket value, which can be modified by modules
}

export type ConfigureBucketValue = (options: ConfigureBucketValueOptions) => BucketValue;

export type FeaturevisorUnsubscribe = () => void;
export type FeaturevisorModuleUnsubscribe = () => Promise<void>;

export interface FeaturevisorModuleApi {
  getRevision: () => string;
  onDiagnostic: (
    handler: FeaturevisorDiagnosticHandler,
    options?: FeaturevisorModuleDiagnosticOptions,
  ) => FeaturevisorUnsubscribe;
  reportDiagnostic: (diagnostic: FeaturevisorModuleReportedDiagnostic) => void;
}

/**
 * Modules
 */
export interface FeaturevisorModule {
  name?: string;

  setup?: (api: FeaturevisorModuleApi) => void;

  before?: (options: EvaluateOptions) => EvaluateOptions;

  bucketKey?: ConfigureBucketKey;

  bucketValue?: ConfigureBucketValue;

  after?: (evaluation: Evaluation, options: EvaluateOptions) => Evaluation;

  close?: () => void | Promise<void>;
}
