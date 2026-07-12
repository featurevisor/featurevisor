import * as React from "react";
import { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";

export interface FeaturevisorProviderProps {
  instance: Featurevisor;
  children: React.ReactNode;
}

export function FeaturevisorProvider(props: FeaturevisorProviderProps) {
  return (
    <FeaturevisorContext.Provider value={props.instance}>
      {props.children}
    </FeaturevisorContext.Provider>
  );
}
