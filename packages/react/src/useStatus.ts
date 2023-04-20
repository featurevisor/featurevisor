import * as React from "react";

import { useSdk } from "./useSdk";

export interface Status {
  isReady: boolean;
}

export function useStatus(): Status {
  const sdk = useSdk();
  const initialStatus = sdk.isReady();

  const [isReady, setIsReady] = React.useState(initialStatus);

  if (isReady) {
    return { isReady };
  }

  React.useEffect(function () {
    function handleReady() {
      setIsReady(true);
    }

    sdk.on("ready", handleReady);

    return function () {
      sdk.off("ready", handleReady);
    };
  }, []);

  return { isReady };
}
