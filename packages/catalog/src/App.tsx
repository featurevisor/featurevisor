import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CatalogProvider } from "./context/CatalogContext";
import type { CatalogManifest } from "./types";
import { AppShell, PageSkeleton } from "./components/ui";
import { PageErrorBoundary } from "./components/errorBoundary";

// Pages load on demand, so the first visit only downloads the shell and the page in view.
function lazyPage<K extends string>(
  load: () => Promise<Record<K, unknown>>,
  name: K,
): React.ComponentType {
  const Component = React.lazy(() =>
    load().then((module) => ({ default: module[name] as React.ComponentType })),
  );

  return function LazyPage() {
    return <Component />;
  };
}

const loadHome = () => import("./pages/HomePage");
const loadList = () => import("./pages/ListPage");
const loadDetail = () => import("./pages/EntityDetailPage");
const loadHistory = () => import("./pages/HistoryPage");

const HomePage = lazyPage(loadHome, "HomePage");
const OverviewPage = lazyPage(loadHome, "OverviewPage");
const ListPage = lazyPage(loadList, "ListPage");
const HistoryPage = lazyPage(loadHistory, "HistoryPage");
const EntityDetailPage = lazyPage(loadDetail, "EntityDetailPage");
const OverviewTab = lazyPage(loadDetail, "OverviewTab");
const FeatureVariationsTab = lazyPage(loadDetail, "FeatureVariationsTab");
const FeatureVariablesTab = lazyPage(loadDetail, "FeatureVariablesTab");
const FeatureRulesTab = lazyPage(loadDetail, "FeatureRulesTab");
const FeatureForceTab = lazyPage(loadDetail, "FeatureForceTab");
const VariableOverridesTab = lazyPage(loadDetail, "VariableOverridesTab");
const TestsTab = lazyPage(loadDetail, "TestsTab");
const UsageTab = lazyPage(loadDetail, "UsageTab");
const HistoryTab = lazyPage(loadDetail, "HistoryTab");

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
      <Route path="overrides" element={<VariableOverridesTab />} />
      <Route path="overrides/:environmentKey" element={<VariableOverridesTab />} />
      <Route path="tests" element={<TestsTab />} />
      <Route path="usage" element={<UsageTab />} />
      <Route path="contents" element={<UsageTab />} />
      <Route path="history" element={<HistoryTab />} />
      {/* Unknown tabs go to the entity overview. React Router resolves relative paths in
          a splat route from the full URL, so ".." (not ".") leaves the unknown segment. */}
      <Route path="*" element={<Navigate to=".." replace />} />
    </Route>
  );
}

export function App(props: { manifest: CatalogManifest; live?: boolean }) {
  return (
    <CatalogProvider initialManifest={props.manifest} live={props.live}>
      <AppShell>
        <PageErrorBoundary>
          <React.Suspense fallback={<PageSkeleton label="Loading page" variant="list" />}>
            <Routes>
              <Route index element={<HomePage />} />

              <Route path="sets/:setKey" element={<OverviewPage />} />
              <Route path="sets/:setKey/:entityPath" element={<ListPage />} />
              {EntityRoutes({ prefix: "sets/:setKey/" })}
              <Route path="sets/:setKey/history" element={<HistoryPage />} />

              <Route path="history" element={<HistoryPage />} />
              <Route path=":entityPath" element={<ListPage />} />
              {EntityRoutes()}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </React.Suspense>
        </PageErrorBoundary>
      </AppShell>
    </CatalogProvider>
  );
}
