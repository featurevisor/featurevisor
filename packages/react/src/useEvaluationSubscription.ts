import { useEffect, useReducer } from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey, VariableKey } from "@featurevisor/types";

import { onFeatureChange } from "./onFeatureChange.js";
import { onVariableChange } from "./onVariableChange.js";

export function useEvaluationSubscription(
  sdk: Featurevisor,
  key: FeatureKey | VariableKey,
  isStandaloneVariable = false,
): void {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);

  useEffect(() => {
    const unsubscribe = isStandaloneVariable
      ? onVariableChange(sdk, key, refresh)
      : onFeatureChange(sdk, key, refresh);

    // Subscribe before reading again so SDK changes since rendering are not lost.
    // Only subscription inputs trigger this effect. Contexts and fresh evaluation
    // results must not cause subscription churn or enter React state.
    refresh();

    return unsubscribe;
  }, [sdk, key, isStandaloneVariable]);
}
