import { useEffect, useState } from "react";

import type { Context, FeatureKey, VariationValue } from "@featurevisor/types";

import { useSdk } from "./useSdk.js";
import { onFeatureChange } from "./onFeatureChange.js";

/**
 * Returns the evaluated variation and updates it when the feature changes. The
 * optional type parameter only narrows the compile time result.
 */
export function useVariation<TVariation extends VariationValue = VariationValue>(
  featureKey: FeatureKey,
  context: Context = {},
): TVariation | null {
  const sdk = useSdk();
  const [variationValue, setVariationValue] = useState<TVariation | null>(() =>
    sdk.getVariation<TVariation>(featureKey, context),
  );

  useEffect(() => {
    setVariationValue(sdk.getVariation<TVariation>(featureKey, context));

    const unsubscribe = onFeatureChange(sdk, featureKey, () => {
      const newValue = sdk.getVariation<TVariation>(featureKey, context);
      setVariationValue((prev) => (newValue !== prev ? newValue : prev));
    });

    return unsubscribe;
  }, [sdk, featureKey, context]);

  return variationValue;
}
