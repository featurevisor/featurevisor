import type { Ref } from "vue";
import type { FeatureKey, VariableKey, VariableValue } from "@featurevisor/types";

import { onFeatures, onVariable, useLive, type ContextSource } from "./live.js";
import { injectEveryUpdate, usePrecise } from "./precise.js";
import { injectScope, readScopedContext } from "./scope.js";
import { useSdk } from "./useSdk.js";

/**
 * Returns a readonly ref holding the evaluated variable. A feature variable
 * updates like useFlag. A global variable updates when a datafile changes it or
 * something it depends on, when the context or sticky values change, and when a
 * ref or prop the context reads changes. The optional type parameter only
 * describes the expected compile time result. TValue stays unconstrained so
 * interfaces without index signatures are accepted.
 */
export function useVariable<TValue = VariableValue>(
  featureKey: FeatureKey,
  variableKey: VariableKey,
  context?: ContextSource,
): Readonly<Ref<TValue | null>>;
export function useVariable<TValue = VariableValue>(
  variableKey: VariableKey,
  context?: ContextSource,
): Readonly<Ref<TValue | null>>;
export function useVariable<TValue = VariableValue>(
  featureKeyOrVariableKey: FeatureKey | VariableKey,
  variableKeyOrContext?: VariableKey | ContextSource,
  context?: ContextSource,
): Readonly<Ref<TValue | null>> {
  const sdk = useSdk();
  const scope = injectScope();
  const every = injectEveryUpdate();

  // Keys are plain strings, so a second argument that is not one is the context.
  if (typeof variableKeyOrContext === "string") {
    const variableKey = variableKeyOrContext;
    const read = () => readScopedContext(scope, context);

    if (every) {
      return useLive(sdk, onFeatures(sdk, [featureKeyOrVariableKey]), () =>
        sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKey, read()),
      );
    }

    return usePrecise(
      sdk,
      (merged) => sdk.getVariable<TValue>(featureKeyOrVariableKey, variableKey, merged),
      read,
      { follows: { features: [featureKeyOrVariableKey] } },
    );
  }

  const read = () => readScopedContext(scope, variableKeyOrContext);

  if (every) {
    return useLive(sdk, onVariable(sdk, featureKeyOrVariableKey), () =>
      sdk.getVariable<TValue>(featureKeyOrVariableKey, read()),
    );
  }

  return usePrecise(
    sdk,
    (merged) => sdk.getVariable<TValue>(featureKeyOrVariableKey, merged),
    read,
    { follows: { variables: [featureKeyOrVariableKey] } },
  );
}
