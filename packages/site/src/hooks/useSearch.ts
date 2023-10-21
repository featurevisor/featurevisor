import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { useSearchIndex } from "./useSearchIndex";
import {
  parseSearchQuery,
  getFeaturesByQuery,
  getAttributesByQuery,
  getSegmentsByQuery,
} from "../utils";

const SEARCH_QUERY_KEY = "q";

export function useSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = String(searchParams.get(SEARCH_QUERY_KEY) || "");

  const { data: searchData } = useSearchIndex();
  const parsedQuery = parseSearchQuery(searchQuery);
  const features = getFeaturesByQuery(parsedQuery, searchData);
  const segments = getSegmentsByQuery(parsedQuery, searchData);
  const attributes = getAttributesByQuery(parsedQuery, searchData);

  const setSearchQuery = useCallback((value) => {
    const newSearchParams = new URLSearchParams(searchParams.toString());
    if (value) {
      newSearchParams.set(SEARCH_QUERY_KEY, String(value));
    } else {
      newSearchParams.delete(SEARCH_QUERY_KEY);
    }
    setSearchParams(newSearchParams);
  }, []);

  return {
    searchQuery,
    features,
    segments,
    attributes,
    setSearchQuery,
  } as const;
}
