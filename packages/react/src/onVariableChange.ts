import type { Featurevisor } from "@featurevisor/sdk";
import type { VariableKey } from "@featurevisor/types";

export function onVariableChange(sdk: Featurevisor, variableKey: VariableKey, fn: () => void) {
  const unsubscribeDatafileSet = sdk.on("datafile_set", ({ variables }) => {
    if (variables.indexOf(variableKey) !== -1) fn();
  });
  const unsubscribeContextSet = sdk.on("context_set", fn);
  const unsubscribeStickyVariablesSet = sdk.on("sticky_variables_set", ({ variables }) => {
    if (variables.length > 0) fn();
  });
  const unsubscribeStickyFeaturesSet = sdk.on("sticky_features_set", ({ features }) => {
    if (features.length > 0) fn();
  });

  return () => {
    unsubscribeDatafileSet();
    unsubscribeContextSet();
    unsubscribeStickyVariablesSet();
    unsubscribeStickyFeaturesSet();
  };
}
