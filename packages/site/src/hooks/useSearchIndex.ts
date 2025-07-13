import { useContext } from "react";
import type { SearchIndex } from "@featurevisor/types";

import { SearchIndexContext } from "../contexts/SearchIndexContext";

export function useSearchIndex() {
  const { data } = useContext(SearchIndexContext);

  return {
    data: data as SearchIndex,
  };
}
