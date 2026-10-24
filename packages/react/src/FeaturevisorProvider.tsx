import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";
import { ScopeContext } from "./scope.js";

export interface FeaturevisorProviderProps {
  instance: Featurevisor;
  children: React.ReactNode;
}

// A declared return type keeps React.JSX, which older @types/react releases
// such as 18.0 lack, out of the published declarations.
export function FeaturevisorProvider(props: FeaturevisorProviderProps): React.ReactElement {
  return (
    <FeaturevisorContext.Provider value={props.instance}>
      {/* A new instance starts outside any scope, since its attributes may differ. */}
      <ScopeContext.Provider value={undefined}>{props.children}</ScopeContext.Provider>
    </FeaturevisorContext.Provider>
  );
}
