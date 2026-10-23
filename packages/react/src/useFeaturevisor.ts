import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";

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

export function useFeaturevisor(): FeaturevisorHookApi {
  const f = useRequiredSdk();

  return React.useMemo(() => pickBound(f, BOUND_METHODS), [f]);
}
