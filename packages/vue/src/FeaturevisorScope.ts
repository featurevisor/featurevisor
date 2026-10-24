import { computed, defineComponent, provide, type PropType } from "vue";
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
  let provided: Context | undefined;

  provide(
    SCOPE,
    computed(() => {
      const merged = mergeContext(outer ? outer.value : {}, readContext(context));

      // Equal values keep the object already provided, so the composables below
      // evaluate nothing again when a parent renders a new inline object.
      if (!provided || !sameValue(provided, merged)) provided = merged;

      return provided;
    }),
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
