import type { Featurevisor } from "@featurevisor/sdk";
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

  // Sticky event keys are direct changes, while required variable and feature
  // dependencies can be transitive. Any nonempty sticky set may affect this feature.
  const unsubscribeStickyFeaturesSet = sdk.on("sticky_features_set", ({ features }) => {
    if (features.length > 0) fn();
  });
  const unsubscribeStickyVariablesSet = sdk.on("sticky_variables_set", ({ variables }) => {
    if (variables.length > 0) fn();
  });

  return function () {
    unsubscribeDatafileSet();
    unsubscribeContextSet();
    unsubscribeStickyFeaturesSet();
    unsubscribeStickyVariablesSet();
  };
}
