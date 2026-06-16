import * as React from "react";
import { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";

export function useSdk(): Featurevisor {
  const sdk = React.useContext(FeaturevisorContext);

  return sdk as Featurevisor;
}
