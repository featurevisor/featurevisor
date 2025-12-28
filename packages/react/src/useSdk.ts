import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext";

export function useSdk(): FeaturevisorInstance {
  const sdk = React.useContext(FeaturevisorContext);

  return sdk as FeaturevisorInstance;
}

export function useFeaturevisor(): FeaturevisorInstance {
  return useSdk();
}
