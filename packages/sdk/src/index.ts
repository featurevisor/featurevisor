export { createFeaturevisor } from "./instance.js";

export type { Featurevisor, FeaturevisorOptions, OverrideOptions } from "./instance.js";
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
  EventDetailsByName,
  StickySetEventDetails,
} from "./events.js";
export type { EventCallback, EventDetails, EventName } from "./emitter.js";

export type * from "@featurevisor/types";
