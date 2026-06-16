import { inject } from "vue";
import { Featurevisor } from "@featurevisor/sdk";

import { PROVIDER_NAME } from "./setupApp.js";

export function useSdk(): Featurevisor {
  const sdk = inject(PROVIDER_NAME) as Featurevisor;

  return sdk;
}
