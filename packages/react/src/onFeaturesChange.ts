import type { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey } from "@featurevisor/types";

/**
 * Calls fn when any of the features may evaluate differently: a datafile that
 * changes one of them, a new context, or new sticky values.
 */
export function onFeaturesChange(
  sdk: Featurevisor,
  featureKeys: readonly FeatureKey[],
  fn: () => void,
) {
  // A copy, so changing the caller's array later does not change the subscription.
  const keys = featureKeys.slice();

  // datafile_set
  const unsubscribeDatafileSet = sdk.on("datafile_set", ({ features }) => {
    if (Array.isArray(features) && features.some((key) => keys.indexOf(key) > -1)) {
      fn();
    }
  });

  // context_set
  const unsubscribeContextSet = sdk.on("context_set", () => {
    fn();
  });

  // Sticky event keys are direct changes, while required variable and feature
  // dependencies can be transitive. Any nonempty sticky set may affect these features.
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
