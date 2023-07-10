import { App } from "vue";
import { FeaturevisorInstance } from "@featurevisor/sdk";

export const PROVIDER_NAME = "featurevisor";

export function setupApp(app: App, sdk: FeaturevisorInstance) {
  app.provide(PROVIDER_NAME, sdk);
}
