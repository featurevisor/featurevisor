import { Ref, readonly, ref } from "vue";

import { useSdk } from "./useSdk";

export interface Status {
  isReady: boolean;
}

export function useStatus(): Ref<Status> {
  const sdk = useSdk();
  const initialStatus = sdk.isReady();

  const result = ref({
    isReady: initialStatus,
  });

  if (initialStatus) {
    return result;
  }

  sdk.on("ready", () => {
    result.value.isReady = true;
  });

  return readonly(result);
}
