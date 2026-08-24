import { Featurevisor } from "@featurevisor/sdk";
import type { TopLevelVariableKey } from "@featurevisor/types";

export function onVariableChange(
  sdk: Featurevisor,
  variableKey: TopLevelVariableKey,
  fn: () => void,
) {
  const unsubscribeDatafileSet = sdk.on("datafile_set", ({ features, variables }) => {
    if (variables.indexOf(variableKey) !== -1 || features.length > 0) fn();
  });
  const unsubscribeContextSet = sdk.on("context_set", fn);
  const unsubscribeStickySet = sdk.on("sticky_set", ({ features, variables }) => {
    if (variables.indexOf(variableKey) !== -1 || features.length > 0) fn();
  });

  return () => {
    unsubscribeDatafileSet();
    unsubscribeContextSet();
    unsubscribeStickySet();
  };
}
