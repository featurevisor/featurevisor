import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext";

export interface FeaturevisorProviderProps {
  sdk: FeaturevisorInstance;
  children: React.ReactNode;
}

export function FeaturevisorProvider(props: FeaturevisorProviderProps) {
  return (
    <FeaturevisorContext.Provider value={props.sdk}>{props.children}</FeaturevisorContext.Provider>
  );
}
