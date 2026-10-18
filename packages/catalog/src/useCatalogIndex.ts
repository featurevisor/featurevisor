import * as React from "react";

import { fetchIndex, peekIndex } from "./api";
import type { CatalogIndex } from "./types";

interface IndexState {
  setKey?: string;
  index: CatalogIndex | null;
  error: string | null;
}

/**
 * The Catalog index for the project or a set. Renders straight from the shared cache
 * when the index was already loaded elsewhere, so navigating never flashes a loader.
 */
export function useCatalogIndex(setKey?: string, enabled = true) {
  const [state, setState] = React.useState<IndexState>(() => ({
    setKey,
    index: peekIndex(setKey) ?? null,
    error: null,
  }));

  React.useEffect(() => {
    if (!enabled) return;

    let active = true;
    setState({ setKey, index: peekIndex(setKey) ?? null, error: null });
    fetchIndex(setKey)
      .then((index) => active && setState({ setKey, index, error: null }))
      .catch((error: Error) => active && setState({ setKey, index: null, error: error.message }));

    return () => {
      active = false;
    };
  }, [setKey, enabled]);

  // Between a set change and the effect above, never hand out the previous set's index.
  return state.setKey === setKey
    ? { index: state.index, error: state.error }
    : { index: peekIndex(setKey) ?? null, error: null };
}
