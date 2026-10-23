import type { Featurevisor } from "@featurevisor/sdk";

import { useSdk } from "./useSdk.js";

/**
 * The provided instance, for hooks that cannot work without one. useSdk itself
 * still returns undefined outside a provider, as it always has.
 */
export function useRequiredSdk(): Featurevisor {
  const sdk = useSdk();

  if (!sdk) {
    throw new Error(
      "Featurevisor SDK is not available. Wrap the component in FeaturevisorProvider.",
    );
  }

  return sdk;
}
