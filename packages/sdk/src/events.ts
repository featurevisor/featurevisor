import type { FeatureKey, GlobalVariableKey } from "@featurevisor/types";

import type { FeaturevisorDiagnostic } from "./diagnostics.js";

/** @deprecated Use `StickyFeaturesSetEventDetails` or `StickyVariablesSetEventDetails`. */
export interface StickySetEventDetails {
  features: FeatureKey[];
  variables?: GlobalVariableKey[];
  replaced: boolean;
}

export interface StickyFeaturesSetEventDetails {
  features: FeatureKey[];
  replaced: boolean;
}

export interface StickyVariablesSetEventDetails {
  variables: GlobalVariableKey[];
  replaced: boolean;
}

export interface DatafileSetEventDetails {
  revision: string;
  previousRevision: string;
  revisionChanged: boolean;
  /** Feature keys changed directly or affected through segment and required feature dependencies. */
  features: FeatureKey[];
  /** Global variable keys changed directly or affected through segment and feature dependencies. */
  variables: GlobalVariableKey[];
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
  /**
   * @deprecated Use `sticky_features_set` or `sticky_variables_set`.
   * Variable updates emit this event with an empty `features` array. That does
   * not mean sticky features were cleared.
   */
  sticky_set: StickySetEventDetails;
  error: ErrorEventDetails;
}

export type EventName = keyof EventDetailsByName;

export type EventDetails = EventDetailsByName[EventName];

export type EventCallback<TEventName extends EventName = EventName> = (
  details: EventDetailsByName[TEventName],
) => void;
