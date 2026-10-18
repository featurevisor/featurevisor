import * as React from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { useCatalog } from "../context/CatalogContext";
import {
  decodeRouteSegment,
  encodeRouteSegment,
  entityLabels,
  getBasePath,
  getEntityRoute,
} from "../entityTypes";
import {
  Badge,
  EmptyState,
  EntityChip,
  EntityKey,
  OverviewSection,
  PageHeader,
  PageSkeleton,
  type Tone,
} from "../components/ui";
import type { CatalogEntityType, EntitySummary } from "../types";
import { HistoryTimeline } from "./HistoryPage";
import { TestReportSummary } from "../components/testReport";
import { useCatalogIndex } from "../useCatalogIndex";
import { useDocumentTitle } from "../useDocumentTitle";

function AttentionRow(props: {
  label: string;
  count: number;
  to: string;
  tone?: Tone;
  items?: Array<{ type: CatalogEntityType; entity: EntitySummary }>;
  showType?: boolean;
  setKey?: string;
}) {
  if (props.count === 0) return null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <Link to={props.to} className="text-sm font-medium text-text hover:underline">
          {props.label}
        </Link>
        <Badge tone={props.tone || "neutral"}>{props.count}</Badge>
      </div>
      {props.items && props.items.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {props.items.slice(0, 6).map(({ type, entity }) => (
            <EntityChip
              key={`${type}:${entity.key}`}
              to={getEntityRoute(type, entity.key, props.setKey)}
              label={props.showType ? entityLabels[type].singular : undefined}
            >
              <EntityKey value={entity.key} />
            </EntityChip>
          ))}
          {props.items.length > 6 && (
            <Link to={props.to} className="text-xs font-semibold text-primary hover:underline">
              +{props.items.length - 6} more
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

/** Landing page for the project or one set: counts, gaps worth attention and recent changes. */
export function OverviewPage() {
  const { manifest } = useCatalog();
  const { setKey: encodedSetKey } = useParams();
  const setKey = encodedSetKey ? decodeRouteSegment(encodedSetKey) : undefined;
  const basePath = getBasePath(setKey);
  const { index, error } = useCatalogIndex(setKey);
  useDocumentTitle("Overview", setKey);

  if (error) return <EmptyState title="Unable to load catalog index" description={error} />;
  if (!index) return <PageSkeleton label="Loading overview" variant="overview" />;

  const features = index.entities.feature || [];
  const variables = index.entities.variable || [];
  const untestedFeatures = features.filter(
    (entity) => entity.hasTests === false && !entity.archived,
  );
  const untestedVariables = variables.filter(
    (entity) => entity.hasTests === false && !entity.archived,
  );
  const deprecated = [
    ...features.map((entity) => ({ type: "feature" as const, entity })),
    ...variables.map((entity) => ({ type: "variable" as const, entity })),
  ].filter((item) => item.entity.deprecated);
  const archived = features.filter((entity) => entity.archived);
  const onDeprecated = [
    ...features.map((entity) => ({ type: "feature" as const, entity })),
    ...variables.map((entity) => ({ type: "variable" as const, entity })),
    ...(index.entities.segment || []).map((entity) => ({ type: "segment" as const, entity })),
  ].filter((item) => item.entity.dependsOnDeprecated && !item.entity.archived);
  const unused = (type: "segment" | "attribute" | "schema") =>
    (index.entities[type] || []).filter((entity) => entity.usedByCount === 0);
  const unusedSegments = unused("segment");
  const unusedAttributes = unused("attribute");
  const unusedSchemas = unused("schema");
  const failingSpecs = (index.entities.test || []).filter((entity) => entity.testPassed === false);
  const environments = manifest.projectConfig.environments || [];
  const historyPath = setKey
    ? `/data/sets/${encodeRouteSegment(setKey)}/history`
    : "/data/project/history";
  const hasAttention =
    failingSpecs.length +
      untestedFeatures.length +
      untestedVariables.length +
      deprecated.length +
      onDeprecated.length +
      archived.length +
      unusedSegments.length +
      unusedAttributes.length +
      unusedSchemas.length >
    0;

  return (
    <div>
      <PageHeader
        title={setKey ? `Set ${setKey}` : "Overview"}
        description={setKey ? "Status of this set at a glance." : "Project status at a glance."}
      />
      <div className="space-y-8 px-6 pb-6">
        {manifest.testReport && (
          <OverviewSection title="Test report">
            <TestReportSummary
              report={manifest.testReport}
              action={
                <Link
                  to={`${basePath}/tests`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View tests
                </Link>
              }
            />
          </OverviewSection>
        )}

        {environments.length > 0 && (
          <OverviewSection title="Environments">
            <div className="flex flex-wrap gap-1.5">
              {environments.map((environment) => (
                <Link
                  key={environment}
                  to={`${basePath}/features?q=${encodeURIComponent(`in:${environment}`)}`}
                  className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50 hover:ring-slate-400"
                >
                  {environment}
                </Link>
              ))}
            </div>
          </OverviewSection>
        )}

        {hasAttention && (
          <OverviewSection title="Needs attention">
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              <AttentionRow
                label="Failing test specs"
                count={failingSpecs.length}
                to={`${basePath}/tests?q=${encodeURIComponent("status:failed")}`}
                items={failingSpecs.map((entity) => ({ type: "test" as const, entity }))}
                tone="danger"
                setKey={setKey}
              />
              <AttentionRow
                label="Features without tests"
                count={untestedFeatures.length}
                to={`${basePath}/features?q=${encodeURIComponent("without:tests")}`}
                items={untestedFeatures.map((entity) => ({ type: "feature" as const, entity }))}
                setKey={setKey}
              />
              <AttentionRow
                label="Variables without tests"
                count={untestedVariables.length}
                to={`${basePath}/variables?q=${encodeURIComponent("without:tests")}`}
                items={untestedVariables.map((entity) => ({ type: "variable" as const, entity }))}
                setKey={setKey}
              />
              <AttentionRow
                label="Deprecated features and variables"
                count={deprecated.length}
                to={`${basePath}/features?q=${encodeURIComponent("deprecated:true")}`}
                items={deprecated}
                showType
                tone="warning"
                setKey={setKey}
              />
              <AttentionRow
                label="Depend on deprecated features"
                count={onDeprecated.length}
                to={`${basePath}/features?q=${encodeURIComponent("with:deprecated-dependency")}`}
                items={onDeprecated}
                showType
                tone="warning"
                setKey={setKey}
              />
              <AttentionRow
                label="Archived features"
                count={archived.length}
                to={`${basePath}/features?q=${encodeURIComponent("archived:true")}`}
                items={archived.map((entity) => ({ type: "feature" as const, entity }))}
                tone="danger"
                setKey={setKey}
              />
              {(
                [
                  ["segment", "segments", unusedSegments],
                  ["attribute", "attributes", unusedAttributes],
                  ["schema", "schemas", unusedSchemas],
                ] as const
              ).map(([type, path, items]) => (
                <AttentionRow
                  key={type}
                  label={`Unused ${path}`}
                  count={items.length}
                  to={`${basePath}/${path}?q=${encodeURIComponent("without:usage")}`}
                  items={items.map((entity) => ({ type, entity }))}
                  setKey={setKey}
                />
              ))}
            </ul>
          </OverviewSection>
        )}

        <OverviewSection title="Recent changes">
          <HistoryTimeline
            path={historyPath}
            setKey={setKey}
            commitUrl={manifest.links?.commit}
            limit={5}
            footer={
              <Link
                to={`${basePath}/history`}
                className="text-sm font-medium text-primary hover:underline"
              >
                View all history
              </Link>
            }
          />
        </OverviewSection>
      </div>
    </div>
  );
}

export function HomePage() {
  const { manifest } = useCatalog();

  if (!manifest.sets) {
    return <OverviewPage />;
  }

  const firstSetKey = manifest.setKeys[0];

  return (
    <Navigate to={firstSetKey ? `/sets/${encodeRouteSegment(firstSetKey)}` : "/history"} replace />
  );
}
