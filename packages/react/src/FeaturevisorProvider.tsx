"use client";

import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext.js";
import { UpdatesContext, type FeaturevisorUpdates } from "./updates.js";
import { ScopeContext } from "./scope.js";

export type { FeaturevisorUpdates } from "./updates.js";

export interface FeaturevisorProviderProps {
  instance: Featurevisor;
  /**
   * Not set, each hook renders again only when its own value changes, and
   * evaluates only when something its last answer read has changed. `"every"`
   * keeps the earlier behaviour, for an application whose modules read state
   * outside the context. It is read once, when the provider mounts.
   */
  updates?: FeaturevisorUpdates;
  children: React.ReactNode;
}

// A declared return type keeps React.JSX, which older @types/react releases
// such as 18.0 lack, out of the published declarations.
export function FeaturevisorProvider(props: FeaturevisorProviderProps): React.ReactElement {
  // Hooks below choose how to update when they mount, so the choice stays fixed.
  const [updates] = React.useState(props.updates);

  return (
    <FeaturevisorContext.Provider value={props.instance}>
      <UpdatesContext.Provider value={updates}>
        {/* A new instance starts outside any scope, since its attributes may differ. */}
        <ScopeContext.Provider value={undefined}>{props.children}</ScopeContext.Provider>
      </UpdatesContext.Provider>
    </FeaturevisorContext.Provider>
  );
}
