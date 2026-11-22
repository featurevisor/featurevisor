import { inject, type InjectionKey, type Ref } from "vue";
import type { Context } from "@featurevisor/types";
import { mergeContext } from "@featurevisor/signals";

import { readContext, type ContextSource } from "./context.js";

/** The merged context of the enclosing scopes, provided by FeaturevisorScope. */
export const SCOPE: InjectionKey<Readonly<Ref<Context>>> = Symbol("featurevisor scope");

/** The enclosing scope, read in setup. Undefined outside any scope. */
export function injectScope(): Readonly<Ref<Context>> | undefined {
  return inject(SCOPE, undefined);
}

/**
 * The context a composable evaluates with: its own context merged over the
 * enclosing scopes. Outside any scope it is exactly what readContext gives, so
 * the SDK receives what it did before scopes existed. Inside a computed, the
 * scope is tracked too.
 */
export function readScopedContext(
  scope: Readonly<Ref<Context>> | undefined,
  context: ContextSource | undefined,
): Context {
  const own = readContext(context);

  return scope ? mergeContext(scope.value, own) : own;
}
