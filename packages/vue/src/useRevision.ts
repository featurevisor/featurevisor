import type { Ref } from "vue";
import type { Context } from "@featurevisor/types";

import { usePrecise } from "./precise.js";
import { useSdk } from "./useSdk.js";

const EMPTY_CONTEXT: Context = {};
const noContext = () => EMPTY_CONTEXT;

/**
 * Returns a readonly ref holding the revision of the instance's datafile. It
 * updates when a datafile with a different revision is set. Context and sticky
 * changes do not affect it.
 */
export function useRevision(): Readonly<Ref<string>> {
  const sdk = useSdk();

  // The revision reads no attribute, so the value asks again on every change,
  // which is cheap, and its ref changes only when the revision does.
  return usePrecise(sdk, () => sdk.getRevision(), noContext, { equals: Object.is });
}
