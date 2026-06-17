import { Navigate, Route, Routes } from "react-router-dom";

import { CatalogProvider } from "./context/CatalogContext";
import type { CatalogManifest } from "./types";
import { AppShell } from "./components/ui";
import { HomePage } from "./pages/HomePage";
import { ListPage } from "./pages/ListPage";
import {
  EntityDetailPage,
  FeatureForceTab,
  FeatureRulesTab,
  FeatureVariablesTab,
  FeatureVariationsTab,
  HistoryTab,
  OverviewTab,
  TestsTab,
  UsageTab,
} from "./pages/EntityDetailPage";
import { HistoryPage } from "./pages/HistoryPage";

function EntityRoutes(props: { prefix?: string } = {}) {
  const prefix = props.prefix || "";

  return (
    <Route path={`${prefix}:entityPath/:entityKey`} element={<EntityDetailPage />}>
      <Route index element={<OverviewTab />} />
      <Route path="variations" element={<FeatureVariationsTab />} />
      <Route path="variables" element={<FeatureVariablesTab />} />
      <Route path="rules" element={<FeatureRulesTab />} />
      <Route path="rules/:environmentKey" element={<FeatureRulesTab />} />
      <Route path="force" element={<FeatureForceTab />} />
      <Route path="force/:environmentKey" element={<FeatureForceTab />} />
      <Route path="tests" element={<TestsTab />} />
      <Route path="usage" element={<UsageTab />} />
      <Route path="history" element={<HistoryTab />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Route>
  );
}

export function App(props: { manifest: CatalogManifest }) {
  return (
    <CatalogProvider initialManifest={props.manifest}>
      <AppShell>
        <Routes>
          <Route index element={<HomePage />} />

          <Route path="sets/:setKey" element={<Navigate to="features" replace />} />
          <Route path="sets/:setKey/:entityPath" element={<ListPage />} />
          {EntityRoutes({ prefix: "sets/:setKey/" })}
          <Route path="sets/:setKey/history" element={<HistoryPage />} />

          <Route path="history" element={<HistoryPage />} />
          <Route path=":entityPath" element={<ListPage />} />
          {EntityRoutes()}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </CatalogProvider>
  );
}
