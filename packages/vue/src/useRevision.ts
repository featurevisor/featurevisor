import { useSdk } from "./useSdk.js";

/**
 * Returns the revision of the instance's datafile, as a plain value taken when
 * it is called, like the other composables.
 */
export function useRevision(): string {
  const sdk = useSdk();

  return sdk.getRevision();
}
