import * as Vue from "vue";
import type { Ref } from "vue";

import type { Source } from "./engine.js";

/**
 * A readonly ref holding a source's value. In a component it listens once
 * mounted, which never happens on a server, and stops when unmounted. Outside a
 * component it listens at once, and stops with the effect scope, if any.
 */
export function useSource<T>(source: Source<T>): Readonly<Ref<T>> {
  const version = Vue.shallowRef(0);
  // Writing without reading, so a refresh inside a running effect, such as a
  // watchEffect that sets the context, does not tie that effect to this ref.
  let count = 0;
  const refresh = () => {
    version.value = ++count;
  };

  const value = Vue.computed(() => {
    // Reading the version makes each reported change read again.
    void version.value;

    return source.read();
  });

  if (Vue.getCurrentInstance()) {
    let stop: (() => void) | undefined;
    Vue.onMounted(() => {
      stop = source.listen(refresh);
      // A change between setup and mounting reads again now, and renders only if it differs.
      if (!Object.is(source.read(), value.value)) refresh();
    });
    Vue.onUnmounted(() => {
      if (stop) stop();
    });
  } else {
    const stop = source.listen(refresh);
    // Effect scopes came in Vue 3.2.
    if (Vue.getCurrentScope && Vue.getCurrentScope()) Vue.onScopeDispose(stop);
  }

  return value;
}
