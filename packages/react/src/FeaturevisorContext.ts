import * as React from "react";
import { Featurevisor } from "@featurevisor/sdk";

export const FeaturevisorContext = React.createContext<Featurevisor | undefined>(undefined);
