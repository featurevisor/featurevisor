import type { Featurevisor } from "@featurevisor/sdk";
import type { FeatureKey } from "@featurevisor/types";

import { onFeaturesChange } from "./onFeaturesChange.js";

export function onFeatureChange(sdk: Featurevisor, featureKey: FeatureKey, fn: () => void) {
  return onFeaturesChange(sdk, [featureKey], fn);
}
