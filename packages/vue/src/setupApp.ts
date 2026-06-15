import { App } from "vue";
import { Featurevisor } from "@featurevisor/sdk";

export const PROVIDER_NAME = "featurevisor";

export function setupApp(app: App, sdk: Featurevisor) {
  app.provide(PROVIDER_NAME, sdk);
}
