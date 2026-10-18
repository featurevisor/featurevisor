import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { fetchManifest, setCatalogCacheTtl, setCatalogRouterMode, setCatalogStorage } from "./api";
import { App } from "./App";
import { getCatalogBasePath } from "./basePath";
import { applyTheme, watchSystemTheme } from "./theme";
import "./styles.css";

applyTheme();
watchSystemTheme();

const root = createRoot(document.getElementById("root") as HTMLElement);

fetchManifest()
  .then((manifest) => {
    setCatalogRouterMode(manifest.router);
    setCatalogStorage(manifest.storage);
    // Dev mode re-exports data on project changes, so only dedupe close requests there.
    if (import.meta.env.DEV || manifest.dev) setCatalogCacheTtl(2000);
    const Router = manifest.router === "hash" ? HashRouter : BrowserRouter;

    root.render(
      <React.StrictMode>
        <Router basename={manifest.router === "hash" ? undefined : getCatalogBasePath()}>
          <App manifest={manifest} live={import.meta.env.DEV} />
        </Router>
      </React.StrictMode>,
    );
  })
  .catch((error: Error) => {
    root.render(<div className="p-8 text-danger">{error.message}</div>);
  });
