import { useSdk } from "./useSdk";

export interface Status {
  isReady: boolean;
}

export function useStatus(): Status {
  const sdk = useSdk();
  const initialStatus = sdk.isReady();

  // @TODO: handle reactivity

  return { isReady: initialStatus };
}
