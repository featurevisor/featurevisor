import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";

import { mergeContext, ScopeContext } from "./scope.js";
import { useRequiredSdk } from "./useRequiredSdk.js";

export const BOUND_METHODS = [
  "isEnabled",
  "getVariation",
  "getVariable",

  "getVariableBoolean",
  "getVariableString",
  "getVariableInteger",
  "getVariableNumber",
  "getVariableArray",
  "getVariableObject",
  "getVariableJSON",

  "setContext",
  "getContext",

  "setStickyFeatures",
  "setStickyVariables",
] as const satisfies readonly (keyof Featurevisor)[];

type FeaturevisorHookApi = Pick<Featurevisor, (typeof BOUND_METHODS)[number]>;

function pickBound<K extends keyof Featurevisor>(
  instance: Featurevisor,
  keys: readonly K[],
): Pick<Featurevisor, K> {
  const result = {} as Pick<Featurevisor, K>;

  for (const key of keys) {
    const method = instance[key];
    if (typeof method === "function") {
      result[key] = (method as (...args: never[]) => unknown).bind(instance) as Featurevisor[K];
    }
  }

  return result;
}

type Read = (...args: unknown[]) => unknown;

/**
 * Merges a scope under the context of every read. The setters still act on the
 * instance, so setContext changes what every component reads.
 */
function withScope(api: FeaturevisorHookApi, scope: Context): FeaturevisorHookApi {
  // Object.assign rather than spread, which compiles to a large helper for older targets.
  const scoped: FeaturevisorHookApi = Object.assign({}, api);
  const reads = scoped as unknown as Record<string, Read>;
  const under = (context: unknown) => mergeContext(scope, (context as Context) || {});

  for (const key of BOUND_METHODS) {
    const read = api[key] as unknown as Read;

    if (key.indexOf("getVariable") === 0) {
      // A string second argument is a feature variable's key. Otherwise it is
      // the context of a global variable.
      reads[key] = (featureKeyOrVariableKey, second, third, fourth) =>
        typeof second === "string"
          ? read(featureKeyOrVariableKey, second, under(third), fourth)
          : read(featureKeyOrVariableKey, under(second), third);
    } else if (key === "isEnabled" || key === "getVariation") {
      reads[key] = (featureKey, context, options) => read(featureKey, under(context), options);
    }
  }

  scoped.getContext = (context?: Context) => api.getContext(under(context));

  return scoped;
}

export function useFeaturevisor(): FeaturevisorHookApi {
  const f = useRequiredSdk();
  const scope = React.useContext(ScopeContext);

  return React.useMemo(() => {
    const api = pickBound(f, BOUND_METHODS);

    // Inside a scope, reads include it, so event handlers read what the component shows.
    return scope ? withScope(api, scope) : api;
  }, [f, scope]);
}
