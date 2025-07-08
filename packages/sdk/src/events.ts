import type { StickyFeatures, FeatureKey } from "@featurevisor/types";

import type { EventDetails } from "./emitter";
import type { DatafileReader } from "./datafileReader";

export function getParamsForStickySetEvent(
  previousStickyFeatures: StickyFeatures = {},
  newStickyFeatures: StickyFeatures = {},
  replace,
): EventDetails {
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
  previousDatafileReader: DatafileReader,
  newDatafileReader: DatafileReader,
): EventDetails {
  const previousRevision = previousDatafileReader.getRevision();
  const previousFeatureKeys = previousDatafileReader.getFeatureKeys();

  const newRevision = newDatafileReader.getRevision();
  const newFeatureKeys = newDatafileReader.getFeatureKeys();

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
    const previousFeature = previousDatafileReader.getFeature(previousFeatureKey);
    const newFeature = newDatafileReader.getFeature(previousFeatureKey);

    if (previousFeature?.hash !== newFeature?.hash) {
      // feature was changed in new datafile
      changedFeatures.push(previousFeatureKey);
    }
  }

  // checking against new datafile
  const newFeatureKeysThatWereAdded: FeatureKey[] = [];
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
  };

  return details;
}
