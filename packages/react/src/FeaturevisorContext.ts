import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

type FeaturevisorContextValue = {
  sdk: FeaturevisorInstance
  suspend: boolean
}
export const FeaturevisorContext = React.createContext<FeaturevisorContextValue | undefined>(undefined);
