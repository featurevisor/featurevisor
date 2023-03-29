import * as React from "react";

import { Attribute, Segment, ParsedFeature } from "@featurevisor/types";

export interface SearchIndexData {
  entities: {
    attributes: Attribute[];
    segments: Segment[];
    features: ParsedFeature[];
  };
}

export interface SearchIndexProps {
  isLoaded: boolean;
  data?: SearchIndexData;
}

export const SearchIndexContext = React.createContext<SearchIndexProps>({
  isLoaded: false,
  data: undefined,
});
