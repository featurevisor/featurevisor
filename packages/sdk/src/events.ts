import type { FeatureKey, VariableKey } from "@featurevisor/types";

import type { FeaturevisorDiagnostic } from "./diagnostics.js";

export interface StickyFeaturesSetEventDetails {
  features: FeatureKey[];
  replaced: boolean;
}

export interface StickyVariablesSetEventDetails {
  variables: VariableKey[];
  replaced: boolean;
}

export interface DatafileSetEventDetails {
  revision: string;
  previousRevision: string;
  revisionChanged: boolean;
  /**
   * Feature keys changed directly or affected through segment, required feature
   * and required variable dependencies.
   */
  features: FeatureKey[];
  /**
   * Global variable keys changed directly or affected through segment, feature
   * and required variable dependencies.
   */
  variables: VariableKey[];
  replaced: boolean;
}

export interface ContextSetEventDetails {
  context: Record<string, unknown>;
  replaced: boolean;
}

export interface ErrorEventDetails {
  diagnostic: FeaturevisorDiagnostic;
}

export interface EventDetailsByName {
  datafile_set: DatafileSetEventDetails;
  context_set: ContextSetEventDetails;
  sticky_features_set: StickyFeaturesSetEventDetails;
  sticky_variables_set: StickyVariablesSetEventDetails;
  error: ErrorEventDetails;
}

export type EventName = keyof EventDetailsByName;

export type EventDetails = EventDetailsByName[EventName];

export type EventCallback<TEventName extends EventName = EventName> = (
  details: EventDetailsByName[TEventName],
) => void;
