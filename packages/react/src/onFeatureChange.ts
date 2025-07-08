import { FeaturevisorInstance } from "@featurevisor/sdk";
import { FeatureKey } from "@featurevisor/types";

export function onFeatureChange(sdk: FeaturevisorInstance, featureKey: FeatureKey, fn) {
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

  // sticky_set
  const unsubscribeStickySet = sdk.on("sticky_set", ({ features }) => {
    if (Array.isArray(features) && features.indexOf(featureKey) > -1) {
      fn();
    }
  });

  return function () {
    unsubscribeDatafileSet();
    unsubscribeContextSet();
    unsubscribeStickySet();
  };
}
