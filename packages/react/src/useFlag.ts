import type { Featurevisor } from "@featurevisor/sdk";
import type { Context, FeatureKey } from "@featurevisor/types";

import { useRequiredSdk } from "./useRequiredSdk.js";
import { useScopedContext } from "./scope.js";
import { useEvaluated, type Evaluated } from "./useEvaluated.js";

function flag(sdk: Featurevisor, featureKey: FeatureKey): Evaluated<boolean> {
  return {
    compute: (merged) => sdk.isEnabled(featureKey, merged),
    options: { equals: Object.is, follows: { features: [featureKey] } },
  };
}

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useRequiredSdk();
  const scopedContext = useScopedContext(context);

  return useEvaluated(sdk, featureKey, scopedContext, flag, featureKey);
}
