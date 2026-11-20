import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluationSubscription } from "./useEvaluationSubscription.js";
import { useEvaluated, useEveryUpdate } from "./useEvaluated.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);

  // The provider's choice is fixed when it mounts, so each component calls the same hooks.
  if (useEveryUpdate()) {
    useEvaluationSubscription(sdk, featureKey);
    return sdk.isEnabled(featureKey, scopedContext);
  }

  return useEvaluated(
    sdk,
    featureKey,
    scopedContext,
    (merged) => sdk.isEnabled(featureKey, merged),
    {
      equals: Object.is,
      follows: { features: [featureKey] },
    },
  );
}
