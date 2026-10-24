import { defineComponent, provide, shallowRef, watch, type PropType } from "vue";
import type { Context } from "@featurevisor/types";

import { readContext, type ContextSource } from "./live.js";
import { injectScope, mergeContext, sameValue, SCOPE } from "./scope.js";

/**
 * Adds context for the composables of every component below the one that calls
 * it, not for that component's own. It is merged over the instance context and
 * any enclosing scope, and each composable's own context is merged over it. A
 * ref or getter, such as `() => ({ plan: props.plan })`, is followed, and an
 * update with the same values, nested ones included, changes nothing. Call it
 * in setup.
 */
export function provideFeaturevisorScope(context: ContextSource): void {
  const outer = injectScope();
  const merge = () => mergeContext(outer ? outer.value : {}, readContext(context));
  const provided = shallowRef(merge());

  // Only a new object changes the ref, so the composables below evaluate
  // nothing again for equal values. A computed returning the same object would
  // still make them evaluate again before Vue 3.4. Watching synchronously keeps
  // the scope current before anything below renders.
  watch(
    merge,
    (merged) => {
      if (!sameValue(provided.value, merged)) provided.value = merged;
    },
    { flush: "sync" },
  );

  provide(SCOPE, provided);
}

/**
 * Adds context for the composables of every component in its default slot,
 * like provideFeaturevisorScope. The context prop is followed as it changes.
 */
export const FeaturevisorScope = defineComponent({
  name: "FeaturevisorScope",
  props: {
    context: {
      type: Object as PropType<Context>,
      required: true,
    },
  },
  setup(props, { slots }) {
    provideFeaturevisorScope(() => props.context);

    return () => (slots.default ? slots.default() : null);
  },
});
