import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

export const FeaturevisorContext = React.createContext<Featurevisor | undefined>(undefined);
