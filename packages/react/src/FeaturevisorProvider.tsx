import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";
import { ScopeContext } from "./scope.js";

export interface FeaturevisorProviderProps {
  instance: Featurevisor;
  children: React.ReactNode;
}

export function FeaturevisorProvider(props: FeaturevisorProviderProps) {
  return (
    <FeaturevisorContext.Provider value={props.instance}>
      {/* A new instance starts outside any scope, since its attributes may differ. */}
      <ScopeContext.Provider value={undefined}>{props.children}</ScopeContext.Provider>
    </FeaturevisorContext.Provider>
  );
}
