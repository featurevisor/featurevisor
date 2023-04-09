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
import { ShowSegment } from "./ShowSegment";
import { ShowFeature } from "./ShowFeature";

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
              <Route path="features/:featureKey" element={<ShowFeature />} />
              <Route path="segments/:segmentKey" element={<ShowSegment />} />

              <Route path="features" element={<ListFeatures />} />
              <Route path="segments" element={<ListSegments />} />

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
