import { useEffect, useState } from "react";

import { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk";
import { onFeatureChange } from "./onFeatureChange";

export function useVariation(featureKey: FeatureKey, context: Context = {}): VariationValue | null {
  const sdk = useSdk();
  const initialValue = sdk.getVariation(featureKey, context);
  const [variationValue, setVariationValue] = useState<VariationValue | null>(initialValue);

  useEffect(() => {
    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariation(featureKey, context);

      if (newValue !== variationValue) {
        setVariationValue(newValue);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [featureKey, context]);

  return variationValue;
}
