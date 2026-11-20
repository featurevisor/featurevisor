import * as React from "react";
import { createSignals, type Reader } from "@featurevisor/signals";

import { useRequiredSdk } from "./useRequiredSdk.js";
import type { Featurevisor } from "@featurevisor/sdk";

const readers = new WeakMap<Featurevisor, Reader>();

/**
 * The signals reader for the provided instance, one per instance. Its values
 * are sources: read one in a component with `useSource` from
 * `@featurevisor/signals/react`, which renders again only when it changes.
 * Packages build their React hooks on it.
 */
export function useSignals(): Reader {
  const sdk = useRequiredSdk();

  return React.useMemo(() => {
    let reader = readers.get(sdk);
    if (!reader) {
      reader = createSignals(sdk);
      readers.set(sdk, reader);
    }

    return reader;
  }, [sdk]);
}
