import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext";

export interface FeaturevisorProviderProps {
  instance: FeaturevisorInstance;
  children: React.ReactNode;
}

export function FeaturevisorProvider(props: FeaturevisorProviderProps) {
  return (
    <FeaturevisorContext.Provider value={props.instance}>
      {props.children}
    </FeaturevisorContext.Provider>
  );
}
