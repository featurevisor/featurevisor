"use client";

import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";
import { ScopeContext } from "./scope.js";

/**
 * Provides an instance to the hooks below. Each hook renders again only when
 * its own value changes, and evaluates again only when something its last
 * answer read has changed. A module that reads changing application state
 * needs that state passed through the context.
 */
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
