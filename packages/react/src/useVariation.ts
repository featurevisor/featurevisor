import { useEffect, useState } from "react";

import { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";

export function useVariation(featureKey: FeatureKey, context: Context = {}): VariationValue | null {
  const sdk = useSdk();
  const [variationValue, setVariationValue] = useState<VariationValue | null>(() =>
    sdk.getVariation(featureKey, context),
  );

  useEffect(() => {
    setVariationValue(sdk.getVariation(featureKey, context));

    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariation(featureKey, context);
      setVariationValue((prev) => (newValue !== prev ? newValue : prev));
    });

    return unsubscribe;
  }, [sdk, featureKey, context]);

  return variationValue;
}
