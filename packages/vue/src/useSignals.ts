import type { Featurevisor } from "@featurevisor/sdk";
import { createSignals, type Reader } from "@featurevisor/signals";

import { useSdk } from "./useSdk.js";

const readers = new WeakMap<Featurevisor, Reader>();

/**
 * The signals reader for the provided instance, one per instance. Call it in
 * `setup`, like the other composables. Its values are sources: read one in a
 * component with `useSource` from `@featurevisor/signals/vue`, which returns a
 * readonly ref that changes only when the value does.
 */
export function useSignals(): Reader {
  const sdk = useSdk();

  let reader = readers.get(sdk);
  if (!reader) {
    reader = createSignals(sdk);
    readers.set(sdk, reader);
  }

  return reader;
}
