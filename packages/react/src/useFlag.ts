import type { Context, FeatureKey } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useSdk();
  useEvaluationSubscription(sdk, featureKey);

  return sdk.isEnabled(featureKey, context);
}
