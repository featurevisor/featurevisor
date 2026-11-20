// Runs the existing suites with the behaviour from before: jest.every.config.js
// maps the provider to this one, which defaults `updates` to "every".
import * as React from "react";

import {
  FeaturevisorProvider as Provider,
  type FeaturevisorProviderProps,
} from "../src/FeaturevisorProvider";

export type { FeaturevisorProviderProps, FeaturevisorUpdates } from "../src/FeaturevisorProvider";

export function FeaturevisorProvider(props: FeaturevisorProviderProps): React.ReactElement {
  return <Provider {...props} updates={props.updates || "every"} />;
}
