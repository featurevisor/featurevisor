import { inject } from "vue";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { PROVIDER_NAME } from "./setupApp";

export function useSdk(): FeaturevisorInstance {
  const sdk = inject(PROVIDER_NAME) as FeaturevisorInstance;

  return sdk;
}
