export { createFeaturevisor } from "./instance.js";

// Runtime exports below this line are intentionally narrow.
// `createFeaturevisor()` is the main public API; these helpers stay public
// because the core package uses them directly while building specialized
// datafiles. Keep additional helper exports type-only unless a real runtime
// consumer needs them.
export { MAX_BUCKETED_NUMBER } from "./bucketer.js";
export { allConditionsAreMatched, allSegmentsAreMatched } from "./conditions.js";

export type {
  Featurevisor,
  FeaturevisorOptions,
  OverrideOptions,
  SpawnOptions,
} from "./instance.js";
export type { FeaturevisorChildInstance } from "./child.js";
export type { Evaluation, EvaluationReason } from "./evaluate.js";
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
  StickySetEventDetails,
} from "./events.js";

export type * from "@featurevisor/types";
