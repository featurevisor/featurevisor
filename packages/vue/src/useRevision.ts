import type { Ref } from "vue";

import { onRevision, useLive } from "./live.js";
import { useSdk } from "./useSdk.js";

/**
 * Returns a readonly ref holding the revision of the instance's datafile. It
 * updates when a datafile with a different revision is set. Context and sticky
 * changes do not affect it.
 */
export function useRevision(): Readonly<Ref<string>> {
  const sdk = useSdk();

  return useLive(sdk, onRevision(sdk), () => sdk.getRevision());
}
