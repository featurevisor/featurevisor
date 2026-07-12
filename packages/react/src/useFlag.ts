import { useEffect, useState } from "react";

import type { Context, FeatureKey } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useSdk();
  const [isEnabled, setIsEnabled] = useState(() => sdk.isEnabled(featureKey, context));

  useEffect(() => {
    setIsEnabled(sdk.isEnabled(featureKey, context));

    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.isEnabled(featureKey, context);
      setIsEnabled((prev) => (newValue !== prev ? newValue : prev));
    });

    return unsubscribe;
  }, [sdk, featureKey, context]);

  return isEnabled;
}
