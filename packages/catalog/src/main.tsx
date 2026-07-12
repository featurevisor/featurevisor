import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { fetchManifest, setCatalogRouterMode } from "./api";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

fetchManifest()
  .then((manifest) => {
    setCatalogRouterMode(manifest.router);
    const Router = manifest.router === "hash" ? HashRouter : BrowserRouter;

    root.render(
      <React.StrictMode>
        <Router>
          <App manifest={manifest} />
        </Router>
      </React.StrictMode>,
    );
  })
  .catch((error: Error) => {
    root.render(<div className="p-8 text-danger">{error.message}</div>);
  });
