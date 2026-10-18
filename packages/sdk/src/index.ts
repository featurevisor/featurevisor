export { createFeaturevisor } from "./instance.js";
export { getRequiredVariableValueAtPath } from "./instance.js";

// Runtime exports below this line are intentionally narrow.
// `createFeaturevisor()` is the main public API; these helpers stay public
// because the core package uses them directly while building specialized
// datafiles. Keep additional helper exports type-only unless a real runtime
// consumer needs them.
export { MAX_BUCKETED_NUMBER } from "./bucketer.js";
export { allConditionsAreMatched, getPortableTimestamp } from "./conditions.js";
export { isValidVersion } from "./compareVersions.js";
export { applyVariableOperations } from "./mutations.js";

export type {
  Featurevisor,
  FeaturevisorOptions,
  OverrideOptions,
  SpawnOptions,
} from "./instance.js";
export type { FeaturevisorChildInstance } from "./child.js";
export type { Evaluation, EvaluationOptions, EvaluationReason } from "./evaluate.js";
export type { DependencyOf } from "./session.js";
export type {
  FeaturevisorDiagnostic,
  FeaturevisorDiagnosticHandler,
  FeaturevisorLogLevel,
  FeaturevisorModuleDiagnosticOptions,
  FeaturevisorModuleReportedDiagnostic,
} from "./diagnostics.js";
export type {
  ConfigureBucketKey,
  ConfigureBucketKeyOptions,
  ConfigureBucketValue,
  ConfigureBucketValueOptions,
  BeforeEvaluation,
  FeaturevisorModule,
  FeaturevisorModuleApi,
  FeaturevisorModuleUnsubscribe,
  FeaturevisorUnsubscribe,
} from "./modules.js";
export type {
  ContextSetEventDetails,
  DatafileSetEventDetails,
  ErrorEventDetails,
  EventCallback,
  EventDetails,
  EventDetailsByName,
  EventName,
  StickyFeaturesSetEventDetails,
  StickyVariablesSetEventDetails,
} from "./events.js";

export type * from "@featurevisor/types";
