// React server components cannot create a context, so this runs on the client.
"use client";

import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

export const FeaturevisorContext = React.createContext<Featurevisor | undefined>(undefined);
