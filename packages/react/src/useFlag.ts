import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);
  useEvaluationSubscription(sdk, featureKey);

  return sdk.isEnabled(featureKey, scopedContext);
}
