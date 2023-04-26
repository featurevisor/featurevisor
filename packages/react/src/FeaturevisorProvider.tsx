import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { FeaturevisorContext } from "./FeaturevisorContext";

export interface FeaturevisorProviderProps {
  sdk: FeaturevisorInstance;
  suspend?: boolean;
  children: React.ReactNode;
}

export function FeaturevisorProvider(props: FeaturevisorProviderProps) {
  const contextValue = React.useMemo(() => {
    return {
      sdk: props.sdk,
      suspend: props.suspend ?? false
    }
  }, [props.sdk, props.suspend])
  return (
    <FeaturevisorContext.Provider value={contextValue}>{props.children}</FeaturevisorContext.Provider>
  );
}
