import { computed, defineComponent, provide, type PropType } from "vue";
import type { Context } from "@featurevisor/types";

import { readContext, type ContextSource } from "./live.js";
import { injectScope, mergeContext, SCOPE } from "./scope.js";

/**
 * Adds context for the composables of every component below the one that calls
 * it, not for that component's own. It is merged over the instance context and
 * any enclosing scope, and each composable's own context is merged over it. A
 * ref or getter, such as `() => ({ plan: props.plan })`, is followed. Call it
 * in setup.
 */
export function provideFeaturevisorScope(context: ContextSource): void {
  const outer = injectScope();

  provide(
    SCOPE,
    computed(() => mergeContext(outer ? outer.value : {}, readContext(context))),
  );
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
