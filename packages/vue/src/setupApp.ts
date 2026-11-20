import type { App } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";

import { UPDATES, type FeaturevisorUpdates } from "./updates.js";

export type { FeaturevisorUpdates } from "./updates.js";

export const PROVIDER_NAME = "featurevisor";

export interface SetupAppOptions {
  /** `"every"` keeps the earlier behaviour, for an application whose modules read state outside the context. */
  updates?: FeaturevisorUpdates;
}

export function setupApp(app: App, sdk: Featurevisor, options: SetupAppOptions = {}) {
  app.provide(PROVIDER_NAME, sdk);
  app.provide(UPDATES, options.updates);
}
