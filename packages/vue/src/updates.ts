import type { InjectionKey } from "vue";

/**
 * How composables update. Not set, a composable's ref changes only when its own
 * value does, and the SDK evaluates only when something its last answer read
 * has changed. `"every"` keeps the behaviour from before: every context and
 * sticky change asks every composable again.
 */
export type FeaturevisorUpdates = "every";

export const UPDATES: InjectionKey<FeaturevisorUpdates | undefined> =
  Symbol("featurevisor updates");
