import { inject } from "vue";
import { FeaturevisorInstance } from "@featurevisor/sdk";

export function useSdk(): FeaturevisorInstance {
  const sdk = inject("featurevisor") as FeaturevisorInstance;

  return sdk;
}
