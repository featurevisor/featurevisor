import * as React from "react";

import { Attribute, Segment, ParsedFeature } from "@featurevisor/types";

interface SearchIndexData {
  entities: {
    attributes: Attribute[];
    segments: Segment[];
    featuures: ParsedFeature[];
  };
}

interface SearchIndexProps {
  isLoaded: boolean;
  data?: SearchIndexData;
}

export const SearchIndexContext = React.createContext<SearchIndexProps>({
  isLoaded: false,
  data: undefined,
});
