import type { FeatureKey, TopLevelVariableKey } from "@featurevisor/types";

import type { FeaturevisorDiagnostic } from "./diagnostics.js";

/** @deprecated Use `StickyFeaturesSetEventDetails` or `StickyVariablesSetEventDetails`. */
export interface StickySetEventDetails {
  features: FeatureKey[];
  variables: TopLevelVariableKey[];
  replaced: boolean;
}

export interface StickyFeaturesSetEventDetails {
  features: FeatureKey[];
  replaced: boolean;
}

export interface StickyVariablesSetEventDetails {
  variables: TopLevelVariableKey[];
  replaced: boolean;
}

export interface DatafileSetEventDetails {
  revision: string;
  previousRevision: string;
  revisionChanged: boolean;
  features: FeatureKey[];
  variables: TopLevelVariableKey[];
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
  /** @deprecated Use `sticky_features_set` or `sticky_variables_set`. */
  sticky_set: StickySetEventDetails;
  error: ErrorEventDetails;
}

export type EventName = keyof EventDetailsByName;

export type EventDetails = EventDetailsByName[EventName];

export type EventCallback<TEventName extends EventName = EventName> = (
  details: EventDetailsByName[TEventName],
) => void;
