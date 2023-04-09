import * as React from "react";

import { Routes, Route, redirect } from "react-router-dom";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { Alert } from "./Alert";

import { ListFeatures } from "./ListFeatures";
import { ListSegments } from "./ListSegments";
import { ListAttributes } from "./ListAttributes";
import { ListHistory } from "./ListHistory";

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
  DisplayFeatureRulesTable,
  DisplayFeatureForce,
  DisplayFeatureForceTable,
  DisplayFeatureHistory,
  ShowFeature,
} from "./ShowFeature";

import { SearchIndexContext } from "../contexts/SearchIndexContext";
import { SearchIndex } from "@featurevisor/types";

export function App() {
  const [fetchedSearchIndex, setSearchIndex] = React.useState(undefined);

  React.useEffect(() => {
    fetch("/search-index.json")
      .then((response) => response.json())
      .then((data) => {
        setSearchIndex(data);
      });
  }, []);

  const environmentKeys = fetchedSearchIndex
    ? Object.keys((fetchedSearchIndex as SearchIndex).entities.features[0].environments).sort()
    : [];

  return (
    <div>
      <Header />

      <main>
        {!fetchedSearchIndex && <Alert type="warning">Loading...</Alert>}

        {fetchedSearchIndex && (
          <SearchIndexContext.Provider value={{ isLoaded: true, data: fetchedSearchIndex }}>
            <Routes>
              {/* @TODO: try redirecting to /features */}
              <Route path="/" element={<ListFeatures />} />

              <Route path="features">
                <Route index element={<ListFeatures />} />

                <Route path=":featureKey" element={<ShowFeature />}>
                  <Route index element={<DisplayFeatureOverview />} />
                  <Route path="variations" element={<DisplayFeatureVariations />} />
                  <Route path="variables" element={<DisplayFeatureVariablesSchema />} />
                  <Route path="rules" element={<DisplayFeatureRules />}>
                    <Route path=":environmentKey" element={<DisplayFeatureRulesTable />} />
                    <Route
                      path="*"
                      loader={({ params }) =>
                        /* @TODO: fix redirection */
                        redirect(`/features/${params.featureKey}/rules/${environmentKeys[0]}`)
                      }
                    />
                  </Route>
                  <Route path="force" element={<DisplayFeatureForce />}>
                    <Route path=":environmentKey" element={<DisplayFeatureForceTable />} />
                    <Route
                      path="*"
                      loader={({ params }) =>
                        /* @TODO: fix redirection */
                        redirect(`/features/${params.featureKey}/force/${environmentKeys[0]}`)
                      }
                    />
                  </Route>
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

              <Route path="history" element={<ListHistory />} />
            </Routes>
          </SearchIndexContext.Provider>
        )}
      </main>

      <Footer />
    </div>
  );
}
