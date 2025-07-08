import { useEffect, useState } from "react";

import { Context, FeatureKey } from "@featurevisor/types";

import { useSdk } from "./useSdk";
import { onFeatureChange } from "./onFeatureChange";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useSdk();
  const initialValue = sdk.isEnabled(featureKey, context);
  const [isEnabled, setIsEnabled] = useState(initialValue);

  useEffect(() => {
    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.isEnabled(featureKey, context);

      if (newValue !== isEnabled) {
        setIsEnabled(newValue);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [featureKey, context]);

  return isEnabled;
}
