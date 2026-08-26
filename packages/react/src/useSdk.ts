import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";

export function useSdk(): Featurevisor {
  const sdk = React.useContext(FeaturevisorContext);

  return sdk as Featurevisor;
}
