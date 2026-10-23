import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useRequiredSdk();
  useEvaluationSubscription(sdk, featureKey);

  return sdk.isEnabled(featureKey, context);
}
