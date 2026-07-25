import { inject } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";

import { PROVIDER_NAME } from "./setupApp.js";

export function useSdk(): Featurevisor {
  const sdk = inject<Featurevisor | undefined>(PROVIDER_NAME, undefined);

  if (!sdk) {
    throw new Error("Featurevisor SDK is not available. Call setupApp(app, featurevisor) first.");
  }

  return sdk;
}
