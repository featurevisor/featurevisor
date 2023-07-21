import { Context, FeatureKey } from "@featurevisor/types";

import { useSdk } from "./useSdk";

export function useFlag(featureKey: FeatureKey, context: Context = {}): boolean {
  const sdk = useSdk();

  return sdk.isEnabled(featureKey, context);
}
