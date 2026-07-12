import * as React from "react";
import { Featurevisor } from "@featurevisor/sdk";

import { useSdk } from "./useSdk.js";

export const BOUND_METHODS = [
  "isEnabled",
  "getVariation",
  "getVariable",

  "getVariableBoolean",
  "getVariableString",
  "getVariableInteger",
  "getVariableDouble",
  "getVariableArray",
  "getVariableObject",
  "getVariableJSON",

  "setContext",
  "getContext",

  "setSticky",
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
  const f = useSdk();

  return React.useMemo(() => pickBound(f, BOUND_METHODS), [f]);
}
