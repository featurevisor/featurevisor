// Runs the existing suites with the behaviour from before: jest.every.config.js
// maps setupApp to this one, which defaults `updates` to "every".
import type { App } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";

import { setupApp as setup, type SetupAppOptions } from "../src/setupApp";

export { PROVIDER_NAME } from "../src/setupApp";
export type { FeaturevisorUpdates, SetupAppOptions } from "../src/setupApp";

export function setupApp(app: App, sdk: Featurevisor, options: SetupAppOptions = {}) {
  setup(app, sdk, { ...options, updates: options.updates || "every" });
}
