import type { App } from "vue";
import type { Featurevisor } from "@featurevisor/sdk";

export const PROVIDER_NAME = "featurevisor";

export function setupApp(app: App, sdk: Featurevisor) {
  app.provide(PROVIDER_NAME, sdk);
}
