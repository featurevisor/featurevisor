import * as React from "react";
import { Link, Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";

import { fetchEntityDetail, fetchHistoryPage } from "../api";
import { entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { EntityDetail, EntityPath, HistoryPage as HistoryPageData } from "../types";
import {
  Badge,
  CodeBlock,
  EmptyState,
  FieldGrid,
  MarkdownContent,
  PageHeader,
  Tabs,
  formatList,
} from "../components/ui";
import { ConditionTree, GroupSegmentTree } from "../components/trees";

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "groups" ||
    value === "schemas" ||
    value === "tests"
  );
}

export function useEntityDetail() {
  return useOutletContext<{ detail: EntityDetail; setKey?: string }>();
}

function valueOrNA(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return formatList(value.map(String));
  }

  if (typeof value === "object") {
    return <CodeBlock value={value} />;
  }

  return String(value);
}

export function EntityDetailPage() {
  const { entityPath, entityKey, setKey } = useParams();
  const [detail, setDetail] = React.useState<EntityDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetail(null);
    setError(null);

    if (!isEntityPath(entityPath) || !entityKey) {
      return;
    }

    fetchEntityDetail(entityPathToType[entityPath], entityKey, setKey)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [entityPath, entityKey, setKey]);

  if (!isEntityPath(entityPath) || !entityKey) {
    return <Navigate to="/features" replace />;
  }

  const type = entityPathToType[entityPath];

  if (error) {
    return <EmptyState title="Unable to load entity" description={error} />;
  }

  if (!detail) {
    return <div className="text-muted">Loading {entityLabels[type].singular.toLowerCase()}...</div>;
  }

  const tabs = [
    { to: ".", label: "Overview" },
    ...(type === "feature"
      ? [
          { to: "rules", label: "Rules" },
          { to: "force", label: "Force" },
          { to: "tests", label: "Tests" },
        ]
      : []),
    ...(type !== "test" ? [{ to: "usage", label: "Usage" }] : []),
    { to: "history", label: "History" },
    { to: "raw", label: "Raw" },
  ];

  return (
    <div>
      <PageHeader
        title={detail.key}
        description={entityLabels[type].singular}
        actions={
          <div className="flex gap-2">
            {detail.editLinks?.vscode && (
              <a
                className="rounded bg-surface px-3 py-2 text-sm shadow"
                href={detail.editLinks.vscode}
              >
                VS Code
              </a>
            )}
            {detail.editLinks?.cursor && (
              <a
                className="rounded bg-surface px-3 py-2 text-sm shadow"
                href={detail.editLinks.cursor}
              >
                Cursor
              </a>
            )}
          </div>
        }
      />
      <Tabs items={tabs} />
      <Outlet context={{ detail, setKey }} />
    </div>
  );
}

export function OverviewTab() {
  const { detail } = useEntityDetail();
  const entity = detail.entity as Record<string, unknown>;

  if (detail.type === "segment") {
    return (
      <div className="space-y-6">
        <FieldGrid
          fields={[
            { label: "Key", value: detail.key },
            { label: "Archived", value: valueOrNA(entity.archived) },
            { label: "Promotable", value: entity.promotable === false ? "No" : "Yes" },
            { label: "Source", value: detail.sourcePath || "n/a" },
          ]}
        />
        <section className="rounded border border-border bg-surface p-4 shadow">
          <h2 className="mb-3 font-semibold">Conditions</h2>
          <ConditionTree conditions={entity.conditions as any} />
        </section>
        <MarkdownContent value={entity.description as string | undefined} />
      </div>
    );
  }

  if (detail.type === "feature") {
    return (
      <div className="space-y-6">
        <FieldGrid
          fields={[
            { label: "Key", value: detail.key },
            { label: "Archived", value: valueOrNA(entity.archived) },
            { label: "Deprecated", value: valueOrNA(entity.deprecated) },
            { label: "Promotable", value: entity.promotable === false ? "No" : "Yes" },
            { label: "Tags", value: formatList(entity.tags as string[] | undefined) },
            { label: "Bucket by", value: valueOrNA(entity.bucketBy) },
            { label: "Required", value: valueOrNA(entity.required) },
            { label: "Targets", value: formatList(detail.relationships?.targets) },
          ]}
        />
        <MarkdownContent value={entity.description as string | undefined} />
        {entity.variations && (
          <section className="rounded border border-border bg-surface p-4 shadow">
            <h2 className="mb-3 font-semibold">Variations</h2>
            <CodeBlock value={entity.variations} />
          </section>
        )}
        {entity.variablesSchema && (
          <section className="rounded border border-border bg-surface p-4 shadow">
            <h2 className="mb-3 font-semibold">Variables</h2>
            <CodeBlock value={entity.variablesSchema} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FieldGrid
        fields={[
          { label: "Key", value: detail.key },
          { label: "Description", value: valueOrNA(entity.description) },
          { label: "Archived", value: valueOrNA(entity.archived) },
          { label: "Deprecated", value: valueOrNA(entity.deprecated) },
          { label: "Promotable", value: entity.promotable === false ? "No" : "Yes" },
          { label: "Source", value: detail.sourcePath || "n/a" },
        ]}
      />
      <CodeBlock value={detail.entity} />
    </div>
  );
}

function getEnvironmentItems(detail: EntityDetail, tab: "rules" | "force") {
  const entity = detail.entity as Record<string, any>;
  const value = entity[tab];

  if (!value || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

export function FeatureRulesTab() {
  const { detail } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "rules");
  const selectedEnvironment = environmentKey || environments[0];
  const rules = environments.length > 0 ? entity.rules?.[selectedEnvironment] : entity.rules;
  const expose = environments.length > 0 ? entity.expose?.[selectedEnvironment] : entity.expose;

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  return (
    <FeatureRows
      title="Rules"
      base="rules"
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={rules || []}
      expose={expose}
    />
  );
}

export function FeatureForceTab() {
  const { detail } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "force");
  const selectedEnvironment = environmentKey || environments[0];
  const rows = environments.length > 0 ? entity.force?.[selectedEnvironment] : entity.force;

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  return (
    <FeatureRows
      title="Force"
      base="force"
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={rows || []}
    />
  );
}

function FeatureRows(props: {
  title: string;
  base: string;
  environments: string[];
  selectedEnvironment?: string;
  rows: any[];
  expose?: unknown;
}) {
  if (props.environments.length > 0 && props.selectedEnvironment) {
    const isKnown = props.environments.includes(props.selectedEnvironment);
    if (!isKnown) {
      return <Navigate to={`../${props.base}/${props.environments[0]}`} replace />;
    }
  }

  return (
    <div className="space-y-4">
      {props.environments.length > 0 && (
        <nav className="flex flex-wrap gap-2">
          {props.environments.map((environment) => (
            <Link
              key={environment}
              to={`../${props.base}/${environment}`}
              className={`rounded px-3 py-2 text-sm ${environment === props.selectedEnvironment ? "bg-primary text-white" : "bg-surface text-muted"}`}
            >
              {environment}
            </Link>
          ))}
        </nav>
      )}

      {typeof props.expose !== "undefined" && (
        <div className="rounded border border-border bg-warning-surface p-3 text-sm">
          Expose: {JSON.stringify(props.expose)}
        </div>
      )}

      {props.rows.length === 0 && <EmptyState title={`No ${props.title.toLowerCase()} found`} />}
      {props.rows.map((row, index) => (
        <div key={row.key || index} className="rounded border border-border bg-surface p-4 shadow">
          <div className="mb-3 flex items-center gap-2">
            <Badge>{row.key || `#${index + 1}`}</Badge>
            {row.enabled === false && <Badge tone="danger">disabled</Badge>}
            {row.promotable === false && <Badge>not promotable</Badge>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Segments</h3>
              <GroupSegmentTree segments={row.segments} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Conditions</h3>
              <ConditionTree conditions={row.conditions} />
            </div>
          </div>
          <div className="mt-4">
            <CodeBlock value={row} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TestsTab() {
  const { detail, setKey } = useEntityDetail();
  const tests = detail.relationships?.tests || [];

  return (
    <div className="space-y-2">
      {tests.length === 0 && <EmptyState title="No tests reference this feature" />}
      {tests.map((testKey) => (
        <Link
          key={testKey}
          to={getEntityRoute("test", testKey, setKey)}
          className="block rounded border border-border bg-surface p-3 hover:bg-elevated"
        >
          {testKey}
        </Link>
      ))}
    </div>
  );
}

export function UsageTab() {
  const { detail, setKey } = useEntityDetail();
  const relationships = detail.relationships || {};
  const entries = Object.entries(relationships).filter(([, values]) => values.length > 0);

  return (
    <div className="space-y-4">
      {entries.length === 0 && <EmptyState title="No usage found" />}
      {entries.map(([label, values]) => (
        <section key={label} className="rounded border border-border bg-surface p-4 shadow">
          <h2 className="mb-3 font-semibold">{label}</h2>
          <div className="flex flex-wrap gap-2">
            {values.map((value) => (
              <Link
                key={value}
                to={getEntityRoute(
                  label.includes("segment")
                    ? "segment"
                    : label.includes("target")
                      ? "target"
                      : label.includes("test")
                        ? "test"
                        : "feature",
                  value,
                  setKey,
                )}
              >
                <Badge>{value}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function HistoryTab() {
  const { detail } = useEntityDetail();
  const [page, setPage] = React.useState<HistoryPageData | null>(null);

  React.useEffect(() => {
    if (!detail.historyPath) {
      setPage({ page: 1, pageSize: 50, totalPages: 1, entries: [] });
      return;
    }

    fetchHistoryPage(detail.historyPath, 1).then(setPage);
  }, [detail.historyPath]);

  if (!page) {
    return <div className="text-muted">Loading history...</div>;
  }

  return (
    <div className="space-y-3">
      {page.entries.length === 0 && <EmptyState title="No history found" />}
      {page.entries.map((entry) => (
        <div key={entry.commit} className="rounded border border-border bg-surface p-4 shadow">
          <div className="font-mono text-sm">{entry.commit.slice(0, 10)}</div>
          <div className="text-sm text-muted">
            {entry.author} · {new Date(entry.timestamp).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RawTab() {
  const { detail } = useEntityDetail();

  return <CodeBlock value={detail.entity} />;
}
