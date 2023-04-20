import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

export const FeaturevisorContext = React.createContext<FeaturevisorInstance | undefined>(undefined);
