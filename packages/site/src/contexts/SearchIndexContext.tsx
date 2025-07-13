import * as React from "react";

import type { SearchIndex } from "@featurevisor/types";

export interface SearchIndexProps {
  isLoaded: boolean;
  data?: SearchIndex;
}

export const SearchIndexContext = React.createContext<SearchIndexProps>({
  isLoaded: false,
  data: undefined,
});
