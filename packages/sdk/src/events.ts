import type { StickyFeatures, FeatureKey, DatafileContent } from "@featurevisor/types";

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

export function getParamsForStickySetEvent(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace: boolean,
): StickySetEventDetails {
  const keysBefore = Object.keys(previousStickyFeatures);
  const keysAfter = Object.keys(newStickyFeatures);

  const allKeys = [...keysBefore, ...keysAfter];
  const uniqueFeaturesAffected = allKeys.filter(
    (element, index) => allKeys.indexOf(element) === index,
  );

  return {
    features: uniqueFeaturesAffected,
    replaced: replace,
  };
}

export function getParamsForDatafileSetEvent(
  previousDatafile: DatafileContent,
  newDatafile: DatafileContent,
  replace = false,
): DatafileSetEventDetails {
  const previousRevision = previousDatafile.revision;
  const previousFeatureKeys = Object.keys(previousDatafile.features);

  const newRevision = newDatafile.revision;
  const newFeatureKeys = Object.keys(newDatafile.features);

  // results
  const removedFeatures: FeatureKey[] = [];
  const changedFeatures: FeatureKey[] = [];
  const addedFeatures: FeatureKey[] = [];

  // checking against existing datafile
  for (const previousFeatureKey of previousFeatureKeys) {
    if (newFeatureKeys.indexOf(previousFeatureKey) === -1) {
      // feature was removed in new datafile
      removedFeatures.push(previousFeatureKey);

      continue;
    }

    // feature exists in both datafiles, check if it was changed
    const previousFeature = previousDatafile.features[previousFeatureKey];
    const newFeature = newDatafile.features[previousFeatureKey];

    if (previousFeature?.hash !== newFeature?.hash) {
      // feature was changed in new datafile
      changedFeatures.push(previousFeatureKey);
    }
  }

  // checking against new datafile
  for (const newFeatureKey of newFeatureKeys) {
    if (previousFeatureKeys.indexOf(newFeatureKey) === -1) {
      // feature was added in new datafile
      addedFeatures.push(newFeatureKey);
    }
  }

  // combine all affected feature keys
  const allAffectedFeatures: FeatureKey[] = [
    ...removedFeatures,
    ...changedFeatures,
    ...addedFeatures,
  ].filter((element, index, array) => array.indexOf(element) === index);

  const details = {
    revision: newRevision,
    previousRevision,
    revisionChanged: previousRevision !== newRevision,

    features: allAffectedFeatures,
    replaced: replace,
  };

  return details;
}
