import * as React from "react";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { Alert } from "./Alert";
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

      <main>
        {!fetchedSearchIndex && <Alert type="warning">Loading...</Alert>}

        {fetchedSearchIndex && (
          <SearchIndexContext.Provider value={{ isLoaded: true, data: fetchedSearchIndex }}>
            <ListFeatures />
          </SearchIndexContext.Provider>
        )}
      </main>

      <Footer />
    </div>
  );
}
