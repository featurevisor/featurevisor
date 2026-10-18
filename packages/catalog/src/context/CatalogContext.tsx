import * as React from "react";

import type { CatalogManifest } from "../types";

interface CatalogContextValue {
  manifest: CatalogManifest;
  /** Watch mode, where the Catalog is exported again on every project change. */
  live: boolean;
}

const CatalogContext = React.createContext<CatalogContextValue | null>(null);

export function CatalogProvider(props: {
  children: React.ReactNode;
  initialManifest: CatalogManifest;
  live?: boolean;
}) {
  const live = Boolean(props.live || props.initialManifest.dev);
  const value = React.useMemo(
    () => ({ manifest: props.initialManifest, live }),
    [props.initialManifest, live],
  );

  return <CatalogContext.Provider value={value}>{props.children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = React.useContext(CatalogContext);

  if (!context) {
    throw new Error("useCatalog must be used inside CatalogProvider.");
  }

  return context;
}
