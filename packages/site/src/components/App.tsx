import * as React from "react";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { ListFeatures } from "./ListFeatures";

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

      {!fetchedSearchIndex && <p>Loading...</p>}

      {fetchedSearchIndex && (
        <SearchIndexContext.Provider value={{ isLoaded: true, data: fetchedSearchIndex }}>
          <ListFeatures />
        </SearchIndexContext.Provider>
      )}

      <Footer />
    </div>
  );
}
