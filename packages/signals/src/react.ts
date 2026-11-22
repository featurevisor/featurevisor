import * as React from "react";

import type { Source } from "./engine.js";

const { useSyncExternalStore } = React as Partial<typeof React>;

/**
 * React 16.8 and 17 have no useSyncExternalStore, so a source is read while
 * rendering and listened to in an effect, which renders again if the value
 * changed in between. This is the one pass rendering the hooks always had there.
 */
function useSourceInOnePass<T>(source: Source<T>): T {
  const [, refresh] = React.useReducer((count: number) => count + 1, 0);
  const value = source.read();

  React.useEffect(() => {
    const stop = source.listen(refresh);
    if (!Object.is(source.read(), value)) refresh();

    return stop;
  }, [source]);

  return value;
}

/**
 * Reads a source in a component, which renders again only when the value
 * changes. Keep the source the same between renders, with useMemo.
 */
export const useSource: <T>(source: Source<T>) => T = useSyncExternalStore
  ? <T>(source: Source<T>): T => useSyncExternalStore(source.listen, source.read, source.read)
  : useSourceInOnePass;
