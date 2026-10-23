import type { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey, VariableKey } from "@featurevisor/types";

import { useSubscription } from "./changeTracker.js";
import { onFeatureChange } from "./onFeatureChange.js";
import { onVariableChange } from "./onVariableChange.js";

export function useEvaluationSubscription(
  sdk: Featurevisor,
  key: FeatureKey | VariableKey,
  isStandaloneVariable = false,
): void {
  useSubscription(
    sdk,
    (refresh) =>
      isStandaloneVariable
        ? onVariableChange(sdk, key, refresh)
        : onFeatureChange(sdk, key, refresh),
    [key, isStandaloneVariable],
  );
}
