import type { FeatureKey } from "@featurevisor/types";

import type { FeaturevisorDiagnostic } from "./diagnostics.js";

export interface StickySetEventDetails {
  features: FeatureKey[];
  replaced: boolean;
}

export interface DatafileSetEventDetails {
  revision: string;
  previousRevision: string;
  revisionChanged: boolean;
  features: FeatureKey[];
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
  sticky_set: StickySetEventDetails;
  error: ErrorEventDetails;
}

export type EventName = keyof EventDetailsByName;

export type EventDetails = EventDetailsByName[EventName];

export type EventCallback<TEventName extends EventName = EventName> = (
  details: EventDetailsByName[TEventName],
) => void;
