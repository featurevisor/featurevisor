import * as React from "react";

import type { CatalogManifest } from "../types";

interface CatalogContextValue {
  manifest: CatalogManifest;
}

const CatalogContext = React.createContext<CatalogContextValue | null>(null);

export function CatalogProvider(props: {
  children: React.ReactNode;
  initialManifest: CatalogManifest;
}) {
  return (
    <CatalogContext.Provider value={{ manifest: props.initialManifest }}>
      {props.children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = React.useContext(CatalogContext);

  if (!context) {
    throw new Error("useCatalog must be used inside CatalogProvider.");
  }

  return context;
}
