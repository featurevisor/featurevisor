import type { BucketBy, Conditions, Context, FeatureKey } from "@featurevisor/types";

import type { ConditionReaders, Evaluation, EvaluationOptions } from "./evaluate.js";
import type { BucketKey, BucketValue } from "./bucketer.js";
import type { TrackResult } from "./reads.js";
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

export type BeforeEvaluation = <TOptions extends EvaluationOptions>(options: TOptions) => TOptions;

export interface FeaturevisorModuleApi {
  getRevision: () => string;
  onDiagnostic: (
    handler: FeaturevisorDiagnosticHandler,
    options?: FeaturevisorModuleDiagnosticOptions,
  ) => FeaturevisorUnsubscribe;
  reportDiagnostic: (diagnostic: FeaturevisorModuleReportedDiagnostic) => void;
  /**
   * Runs `callback` and returns its result with what the evaluations inside it
   * read: attributes, segments, features and variables. Nothing is recorded
   * outside it, so getters cost what they did before.
   */
  track: <T>(callback: () => T) => TrackResult<T>;
  /**
   * An entry of a datafile section, such as `getEntry("schemas", "signUp")`, as
   * stored and never copied, so treat it as read only. Undefined when the
   * section or the entry is missing. A section is any top level datafile key
   * besides the SDK's own whose value is an object.
   */
  getEntry: (section: string, key: string) => unknown;
  /** The keys of a datafile section's entries, or an empty list for a missing section. */
  getEntryKeys: (section: string) => string[];
  /**
   * Answers conditions as Core writes them in datafiles, for a package's own
   * entries, with the instance's engine: segments, attributes, and feature and
   * variable leaves, which read through the getters in one dependency session,
   * with sticky values and modules, as `dependencyOf: { type, key }`. `readers`
   * answer leaves only the package knows, such as `{ input: "country", ... }`,
   * and `valueFrom` naming a reader, `{ input: "password" }`, compares two
   * reads. `value` is always a value, never read.
   * `context` is merged over the instance's, as a getter's is. A condition that
   * cannot be answered, such as a dependency cycle, reports `evaluation_error`
   * and does not match.
   */
  matchConditions: (
    conditions: Conditions | string,
    context: Context,
    options?: { type?: string; key?: string; readers?: ConditionReaders },
  ) => boolean;
}

/**
 * Modules
 */
export interface FeaturevisorModule {
  name?: string;

  setup?: (api: FeaturevisorModuleApi) => void;

  beforeEvaluation?: BeforeEvaluation;

  bucketKey?: ConfigureBucketKey;

  bucketValue?: ConfigureBucketValue;

  afterEvaluation?: (evaluation: Evaluation, options: EvaluationOptions) => Evaluation;

  close?: () => void | Promise<void>;
}
