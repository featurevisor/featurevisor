import { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey } from "@featurevisor/types";

export function onFeatureChange(sdk: Featurevisor, featureKey: FeatureKey, fn: () => void) {
  // datafile_set
  const unsubscribeDatafileSet = sdk.on("datafile_set", ({ features }) => {
    if (Array.isArray(features) && features.indexOf(featureKey) > -1) {
      fn();
    }
  });

  // context_set
  const unsubscribeContextSet = sdk.on("context_set", () => {
    fn();
  });

  // sticky_features_set
  const unsubscribeStickyFeaturesSet = sdk.on("sticky_features_set", ({ features }) => {
    if (Array.isArray(features) && features.indexOf(featureKey) > -1) {
      fn();
    }
  });

  return function () {
    unsubscribeDatafileSet();
    unsubscribeContextSet();
    unsubscribeStickyFeaturesSet();
  };
}
