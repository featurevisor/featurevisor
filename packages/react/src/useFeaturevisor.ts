import * as React from "react";
import { FeaturevisorInstance } from "@featurevisor/sdk";

import { useSdk } from "./useSdk";

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
] as const satisfies readonly (keyof FeaturevisorInstance)[];

type FeaturevisorHookApi = Pick<FeaturevisorInstance, (typeof BOUND_METHODS)[number]>;

function pickBound<K extends keyof FeaturevisorInstance>(
  instance: FeaturevisorInstance,
  keys: readonly K[],
): Pick<FeaturevisorInstance, K> {
  const result = {} as Pick<FeaturevisorInstance, K>;

  for (const key of keys) {
    const method = instance[key];
    if (typeof method === "function") {
      result[key] = (method as (...args: never[]) => unknown).bind(
        instance,
      ) as FeaturevisorInstance[K];
    }
  }

  return result;
}

export function useFeaturevisor(): FeaturevisorHookApi {
  const f = useSdk();

  return React.useMemo(() => pickBound(f, BOUND_METHODS), [f]);
}
