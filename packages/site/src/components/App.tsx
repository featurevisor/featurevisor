import * as React from "react";

import { Routes, Route } from "react-router-dom";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { Alert } from "./Alert";

import { ListFeatures } from "./ListFeatures";
import { ListSegments } from "./ListSegments";
import { ListAttributes } from "./ListAttributes";

import {
  DisplayAttributeOverview,
  DisplayAttributeUsage,
  DisplayAttributeHistory,
  ShowAttribute,
} from "./ShowAttribute";
import {
  DisplaySegmentOverview,
  DisplaySegmentUsage,
  DisplaySegmentHistory,
  ShowSegment,
} from "./ShowSegment";
import {
  DisplayFeatureOverview,
  DisplayFeatureVariations,
  DisplayFeatureVariablesSchema,
  DisplayFeatureRules,
  DisplayFeatureForce,
  DisplayFeatureHistory,
  ShowFeature,
} from "./ShowFeature";

import { SearchIndexContext } from "../contexts/SearchIndexContext";

export function App() {
  const [fetchedSearchIndex, setSearchIndex] = React.useState(undefined);

  React.useEffect(() => {
    fetch("/search-index.json")
      .then((response) => response.json())
      .then((data) => {
        setSearchIndex(data);
      });
  }, []);

  return (
    <div>
      <Header />

      <main>
        {!fetchedSearchIndex && <Alert type="warning">Loading...</Alert>}

        {fetchedSearchIndex && (
          <SearchIndexContext.Provider value={{ isLoaded: true, data: fetchedSearchIndex }}>
            <Routes>
              <Route path="features">
                <Route index element={<ListFeatures />} />

                <Route path=":featureKey" element={<ShowFeature />}>
                  <Route index element={<DisplayFeatureOverview />} />
                  <Route path="variations" element={<DisplayFeatureVariations />} />
                  <Route path="variables" element={<DisplayFeatureVariablesSchema />} />
                  <Route path="rules" element={<DisplayFeatureRules />} />
                  <Route path="force" element={<DisplayFeatureForce />} />
                  <Route path="history" element={<DisplayFeatureHistory />} />
                </Route>
              </Route>

              <Route path="segments">
                <Route index element={<ListSegments />} />

                <Route path=":segmentKey" element={<ShowSegment />}>
                  <Route index element={<DisplaySegmentOverview />} />
                  <Route path="usage" element={<DisplaySegmentUsage />} />
                  <Route path="history" element={<DisplaySegmentHistory />} />
                </Route>
              </Route>

              <Route path="attributes">
                <Route index element={<ListAttributes />} />

                <Route path=":attributeKey" element={<ShowAttribute />}>
                  <Route index element={<DisplayAttributeOverview />} />
                  <Route path="usage" element={<DisplayAttributeUsage />} />
                  <Route path="history" element={<DisplayAttributeHistory />} />
                </Route>
              </Route>
            </Routes>
          </SearchIndexContext.Provider>
        )}
      </main>

      <Footer />
    </div>
  );
}
