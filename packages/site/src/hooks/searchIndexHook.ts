import { useContext } from "react";

import { SearchIndexContext } from "../contexts/SearchIndexContext";

export function useSearchIndex() {
  const value = useContext(SearchIndexContext);

  return value;
}
