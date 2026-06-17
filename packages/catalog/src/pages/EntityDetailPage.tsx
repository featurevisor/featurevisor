import * as React from "react";
import { Link, Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";

import { fetchEntityDetail, fetchHistoryPage } from "../api";
import { decodeRouteSegment, entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { DevEditor, EntityDetail, EntityPath, HistoryPage as HistoryPageData } from "../types";
import { useCatalog } from "../context/CatalogContext";
import {
  Badge,
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
    return <FormattedValue value={value} />;
  }

  return String(value);
}

function formatScalar(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function FormattedValue(props: { value: unknown }) {
  const value = props.value;

  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted">empty</span>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, index) => (
          <span key={index} className="rounded border border-border bg-elevated px-2 py-1 text-xs">
            <FormattedValue value={item} />
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return <span className="text-muted">empty</span>;
    }

    return (
      <dl className="space-y-2">
        {entries.map(([key, item]) => (
          <div
            key={key}
            className="grid gap-1 rounded border border-border bg-elevated p-2 sm:grid-cols-3"
          >
            <dt className="font-mono text-xs font-semibold text-muted">{key}</dt>
            <dd className="min-w-0 sm:col-span-2">
              <FormattedValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{formatScalar(value)}</span>;
}

function CaretIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="h-3 w-3">
      <path
        d="M3.25 4.5 6 7.25 8.75 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditorIcon(props: { icon: DevEditor["icon"] }) {
  if (props.icon === "cursor") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path d="M4 3l16 9-7 2-3 7L4 3Z" fill="#111827" />
        <path d="M8.2 8.6 15 12.6" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M10.2 12.9 12.6 14.3 10.5 18.8Z" fill="#ffffff" opacity=".92" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M17.2 3.2 9.4 10 5.1 6.7 3 7.8v8.4l2.1 1.1 4.3-3.3 7.8 6.8L21 19V5l-3.8-1.8Z"
        fill="#007ACC"
      />
      <path d="M17.2 8.2v7.6L12.5 12l4.7-3.8Z" fill="#ffffff" opacity=".35" />
    </svg>
  );
}

function EditLink(props: { sourcePath?: string; editLinks?: EntityDetail["editLinks"] }) {
  const { manifest } = useCatalog();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const sourceHref =
    props.sourcePath && manifest.links?.source
      ? manifest.links.source.replace("{{path}}", props.sourcePath)
      : undefined;
  const editors = (manifest.dev?.editors || []).filter((editor) => props.editLinks?.[editor.id]);
  const hasEditorLinks = editors.length > 0;

  if (!sourceHref && !hasEditorLinks) {
    return null;
  }

  const buttonClass =
    "rounded border border-border bg-elevated px-4 py-2 text-sm font-bold text-muted shadow-sm hover:bg-background";
  const splitButtonClass =
    "border border-border bg-elevated px-4 py-2 text-sm font-bold text-muted shadow-sm hover:bg-background";
  const menuButtonClass =
    "border border-border bg-elevated py-2 text-sm font-bold text-muted shadow-sm hover:bg-background";

  const dropdown = hasEditorLinks ? (
    <div
      role="menu"
      className="absolute right-0 top-full z-20 mt-px min-w-48 overflow-hidden rounded border border-border bg-surface py-1 shadow-lg"
    >
      {editors.map((editor) => (
        <a
          key={editor.id}
          role="menuitem"
          href={props.editLinks?.[editor.id]}
          className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-muted hover:bg-elevated hover:text-text"
          onClick={() => setOpen(false)}
        >
          <EditorIcon icon={editor.icon} />
          <span>Open in {editor.label}</span>
        </a>
      ))}
    </div>
  ) : null;

  if (!hasEditorLinks) {
    return sourceHref ? (
      <a href={sourceHref} target="_blank" rel="noreferrer" className={buttonClass}>
        Edit
      </a>
    ) : null;
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      {sourceHref ? (
        <a
          href={sourceHref}
          target="_blank"
          rel="noreferrer"
          className={`${splitButtonClass} rounded-l`}
        >
          Edit
        </a>
      ) : (
        <button
          type="button"
          className={`${splitButtonClass} rounded-l`}
          onClick={() => setOpen((current) => !current)}
        >
          Edit
        </button>
      )}
      <button
        type="button"
        className={`${menuButtonClass} -ml-px rounded-r px-2`}
        aria-label="Open edit options"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CaretIcon />
      </button>
      {open ? dropdown : null}
    </div>
  );
}

export function EntityDetailPage() {
  const { entityPath, entityKey, setKey } = useParams();
  const decodedEntityKey = entityKey ? decodeRouteSegment(entityKey) : undefined;
  const [detail, setDetail] = React.useState<EntityDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetail(null);
    setError(null);

    if (!isEntityPath(entityPath) || !decodedEntityKey) {
      return;
    }

    fetchEntityDetail(entityPathToType[entityPath], decodedEntityKey, setKey)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [entityPath, decodedEntityKey, setKey]);

  if (!isEntityPath(entityPath) || !decodedEntityKey) {
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
          { to: "variations", label: "Variations" },
          { to: "variables", label: "Variables" },
          { to: "rules", label: "Rules" },
          { to: "force", label: "Force" },
          { to: "tests", label: "Tests" },
        ]
      : []),
    ...(type !== "test" ? [{ to: "usage", label: "Usage" }] : []),
    { to: "history", label: "History" },
  ];

  return (
    <div>
      <PageHeader
        title={detail.key}
        description={entityLabels[type].singular}
        actions={<EditLink sourcePath={detail.sourcePath} editLinks={detail.editLinks} />}
      />
      <Tabs items={tabs} />
      <div className="px-6 py-6">
        <Outlet context={{ detail, setKey }} />
      </div>
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
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5">
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
      showConditions={false}
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
      showConditions
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
  showConditions: boolean;
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
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${environment === props.selectedEnvironment ? "border-primary bg-primary text-header-text" : "border-border bg-surface text-muted hover:text-text"}`}
            >
              {environment}
            </Link>
          ))}
        </nav>
      )}

      {typeof props.expose !== "undefined" && (
        <div className="rounded border border-border bg-warning-surface p-3 text-sm">
          <span className="font-semibold">Expose</span>
          <div className="mt-2">
            <FormattedValue value={props.expose} />
          </div>
        </div>
      )}

      {props.rows.length === 0 && <EmptyState title={`No ${props.title.toLowerCase()} found`} />}
      {props.rows.map((row, index) => (
        <div
          key={row.key || index}
          className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5"
        >
          <div className="mb-3 flex items-center gap-2">
            <Badge>{row.key || `#${index + 1}`}</Badge>
            {row.enabled === false && <Badge tone="danger">disabled</Badge>}
            {row.promotable === false && <Badge>not promotable</Badge>}
          </div>
          <div className={`grid gap-4 ${props.showConditions ? "md:grid-cols-2" : ""}`}>
            <div className="rounded border border-border bg-elevated p-3">
              <h3 className="mb-2 text-sm font-semibold">Segments</h3>
              <GroupSegmentTree segments={row.segments} />
            </div>
            {props.showConditions && (
              <div className="rounded border border-border bg-elevated p-3">
                <h3 className="mb-2 text-sm font-semibold">Conditions</h3>
                <ConditionTree conditions={row.conditions} />
              </div>
            )}
          </div>
          {typeof row.percentage === "number" && <PercentageBar value={row.percentage} />}
        </div>
      ))}
    </div>
  );
}

function PercentageBar(props: { value: number }) {
  const value = Math.max(0, Math.min(100, props.value));

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
        <span>Rollout</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pill">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function FeatureVariationsTab() {
  const { detail } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variations = entity.variations || [];

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (variations.length === 0) {
    return <EmptyState title="No variations found" />;
  }

  return (
    <div className="space-y-3">
      {variations.map((variation: Record<string, unknown>, index: number) => (
        <section
          key={String(variation.value ?? index)}
          className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5"
        >
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem] md:items-start">
            <div>
              <h2 className="text-sm font-semibold text-muted">Value</h2>
              <div className="mt-1 text-lg font-black text-text">
                <FormattedValue value={variation.value} />
              </div>
            </div>
            {typeof variation.weight === "number" && <PercentageBar value={variation.weight} />}
          </div>
          {variation.variableOverrides && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Variable overrides</h3>
              <FormattedValue value={variation.variableOverrides} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function FeatureVariablesTab() {
  const { detail } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variablesSchema = entity.variablesSchema || {};
  const entries = Object.entries(variablesSchema);

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (entries.length === 0) {
    return <EmptyState title="No variables found" />;
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, schema]) => (
        <section
          key={key}
          className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5"
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge>{key}</Badge>
            {typeof schema === "object" && schema && "type" in schema && (
              <Badge tone="primary">{String((schema as Record<string, unknown>).type)}</Badge>
            )}
          </div>
          <FormattedValue value={schema} />
        </section>
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
          className="block rounded-lg border border-border bg-surface p-3 text-sm font-semibold text-primary shadow-sm ring-1 ring-black/5 hover:bg-elevated"
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
  const entries =
    detail.type === "feature"
      ? [
          ["targets", relationships.targets || []],
          ["features", relationships.requiredBy || []],
        ]
      : Object.entries(relationships);
  const visibleEntries = entries.filter(([, values]) => values.length > 0);

  return (
    <div className="space-y-4">
      {visibleEntries.length === 0 && <EmptyState title="No usage found" />}
      {visibleEntries.map(([label, values]) => (
        <section
          key={label}
          className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5"
        >
          <h2 className="mb-3 font-semibold">
            {detail.type === "feature" && label === "features" ? "Required by features" : label}
          </h2>
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
  const { manifest } = useCatalog();
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
      {page.entries.map((entry) => {
        const commitHref = manifest.links?.commit?.replace("{{hash}}", entry.commit);
        const content = (
          <>
            <div className="font-mono text-sm">{entry.commit.slice(0, 10)}</div>
            <div className="text-sm text-muted">
              {entry.author} · {new Date(entry.timestamp).toLocaleString()}
            </div>
          </>
        );

        return commitHref ? (
          <a
            key={entry.commit}
            href={commitHref}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5 hover:bg-elevated"
          >
            {content}
          </a>
        ) : (
          <div
            key={entry.commit}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
