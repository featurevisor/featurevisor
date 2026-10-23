import { useEffect, useReducer } from "react";

import { useRequiredSdk } from "./useRequiredSdk.js";

/**
 * Returns the revision of the instance's datafile, and renders the component
 * again when a datafile with a different revision is set. Context and sticky
 * changes do not affect it.
 */
export function useRevision(): string {
  const sdk = useRequiredSdk();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const revision = sdk.getRevision();

  useEffect(() => {
    const unsubscribe = sdk.on("datafile_set", (details) => {
      if (details.revisionChanged) {
        refresh();
      }
    });

    // Subscribe before checking so a datafile set since rendering is not lost,
    // and read again only if it brought another revision.
    if (sdk.getRevision() !== revision) refresh();

    return unsubscribe;
  }, [sdk]);

  return revision;
}
