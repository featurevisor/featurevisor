import * as React from "react";
import { Link, Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";

import { fetchEntityDetail, fetchHistoryPage } from "../api";
import { decodeRouteSegment, entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type {
  CatalogEntityType,
  DevEditor,
  EntityDetail,
  EntityPath,
  HistoryPage as HistoryPageData,
} from "../types";
import { useCatalog } from "../context/CatalogContext";
import {
  Badge,
  EmptyState,
  EntityKey,
  DescriptionField,
  OverviewChip,
  OverviewChipLink,
  OverviewMetaPanel,
  OverviewMetaRow,
  OverviewSection,
  MarkdownContent,
  PageHeader,
  Tabs,
} from "../components/ui";
import { ConditionTree, GroupSegmentTree } from "../components/trees";
import { FeatureVariablesList } from "../components/variables";
import { FeatureVariationsList } from "../components/variations";

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "groups" ||
    value === "schemas"
  );
}

function slugifyFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function RulePermalink(props: { targetId: string }) {
  return (
    <a
      href={`#${props.targetId}`}
      aria-label="Link to this rule"
      className="inline-flex rounded p-1 text-muted opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20" />
      </svg>
    </a>
  );
}

function useScrollToHash(dependencies: React.DependencyList) {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const targetId = decodeURIComponent(window.location.hash.slice(1));

    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const targetElement = document.getElementById(targetId);

      if (!targetElement) {
        return;
      }

      targetElement.scrollIntoView({ block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, dependencies);
}

export function useEntityDetail() {
  return useOutletContext<{ detail: EntityDetail; setKey?: string }>();
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
  const { detail, setKey } = useEntityDetail();
  const entity = detail.entity as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <EntityOverviewMeta detail={detail} entity={entity} setKey={setKey} />

      {detail.type === "segment" && (
        <OverviewSection title="Conditions">
          <ConditionTree conditions={entity.conditions as any} />
        </OverviewSection>
      )}

      <DescriptionField value={entity.description} />
    </div>
  );
}

function EntityStatusBadges(props: { entity: Record<string, unknown> }) {
  const hasBadges =
    props.entity.archived === true ||
    props.entity.deprecated === true ||
    props.entity.promotable === false;

  if (!hasBadges) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {props.entity.archived === true && <Badge tone="danger">archived</Badge>}
      {props.entity.deprecated === true && <Badge tone="warning">deprecated</Badge>}
      {props.entity.promotable === false && <Badge>not promotable</Badge>}
    </div>
  );
}

function LinkedEntityChips(props: {
  type: CatalogEntityType;
  values?: string[];
  setKey?: string;
}) {
  if (!props.values?.length) {
    return null;
  }

  return (
    <>
      {props.values.map((value) => (
        <OverviewChipLink key={value} to={getEntityRoute(props.type, value, props.setKey)}>
          {value}
        </OverviewChipLink>
      ))}
    </>
  );
}

function hasBucketBy(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function getAttributeEntityKey(attributePath: string) {
  return attributePath.split(".")[0];
}

function BucketByDisplay(props: { value: unknown; setKey?: string }) {
  const value = props.value;

  if (!hasBucketBy(value)) {
    return null;
  }

  if (typeof value === "string") {
    return (
      <OverviewChipLink
        to={getEntityRoute("attribute", getAttributeEntityKey(value), props.setKey)}
      >
        <EntityKey value={value} className="font-mono" />
      </OverviewChipLink>
    );
  }

  if (Array.isArray(value)) {
    return (
      <>
        {value.map((item, index) => (
          <BucketByDisplay key={index} setKey={props.setKey} value={item} />
        ))}
      </>
    );
  }

  if (typeof value === "object" && value !== null && "or" in value) {
    const orValue = (value as { or: unknown }).or;
    const orItems = Array.isArray(orValue) ? orValue : [orValue];

    return (
      <>
        {orItems.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-xs text-faint">or</span>}
            <BucketByDisplay setKey={props.setKey} value={item} />
          </React.Fragment>
        ))}
      </>
    );
  }

  return (
    <OverviewChip>
      <span className="font-mono text-xs">
        <FormattedValue value={value} />
      </span>
    </OverviewChip>
  );
}

function asStringArray(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    return [value];
  }

  return undefined;
}

function EntityOverviewMeta(props: {
  detail: EntityDetail;
  entity: Record<string, unknown>;
  setKey?: string;
}) {
  const { detail, entity, setKey } = props;
  const tags = asStringArray(entity.tags);
  const targets = detail.relationships?.targets;
  const required = asStringArray(entity.required);
  const hasStatus =
    entity.archived === true || entity.deprecated === true || entity.promotable === false;

  if (detail.type === "feature") {
    const showBucketBy = hasBucketBy(entity.bucketBy);
    const hasFacts = showBucketBy || Boolean(required?.length);
    const hasRelations = Boolean(tags?.length) || Boolean(targets?.length);

    if (!hasStatus && !hasFacts && !hasRelations) {
      return null;
    }

    return (
      <OverviewMetaPanel>
        {hasStatus && (
          <OverviewMetaRow label="Status">
            <EntityStatusBadges entity={entity} />
          </OverviewMetaRow>
        )}
        {showBucketBy && (
          <OverviewMetaRow label="Bucket by">
            <BucketByDisplay value={entity.bucketBy} setKey={setKey} />
          </OverviewMetaRow>
        )}
        {required?.length ? (
          <OverviewMetaRow label="Required">
            {required.map((key) => (
              <OverviewChipLink key={key} to={getEntityRoute("feature", key, setKey)}>
                {key}
              </OverviewChipLink>
            ))}
          </OverviewMetaRow>
        ) : null}
        {tags?.length ? (
          <OverviewMetaRow label="Tags">
            {tags.map((tag) => (
              <OverviewChip key={tag}>{tag}</OverviewChip>
            ))}
          </OverviewMetaRow>
        ) : null}
        {targets?.length ? (
          <OverviewMetaRow label="Targets">
            <LinkedEntityChips type="target" values={targets} setKey={setKey} />
          </OverviewMetaRow>
        ) : null}
      </OverviewMetaPanel>
    );
  }

  if (detail.type === "attribute" && entity.type) {
    return (
      <OverviewMetaPanel>
        {hasStatus && (
          <OverviewMetaRow label="Status">
            <EntityStatusBadges entity={entity} />
          </OverviewMetaRow>
        )}
        <OverviewMetaRow label="Type">
          <OverviewChip>{String(entity.type)}</OverviewChip>
        </OverviewMetaRow>
      </OverviewMetaPanel>
    );
  }

  if (!hasStatus) {
    return null;
  }

  return (
    <OverviewMetaPanel>
      <OverviewMetaRow label="Status">
        <EntityStatusBadges entity={entity} />
      </OverviewMetaRow>
    </OverviewMetaPanel>
  );
}

function getEnvironmentItems(detail: EntityDetail, tab: "rules" | "force") {
  const entity = detail.entity as Record<string, any>;
  const value = entity[tab];

  if (!value || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).sort(sortEnvironmentKeys);
}

function getEnvironmentSortGroup(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.startsWith("dev")) {
    return 0;
  }

  if (normalized.startsWith("prod")) {
    return 2;
  }

  return 1;
}

function sortEnvironmentKeys(left: string, right: string) {
  const leftGroup = getEnvironmentSortGroup(left);
  const rightGroup = getEnvironmentSortGroup(right);

  if (leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }

  return left.localeCompare(right);
}

export function FeatureRulesTab() {
  const { detail, setKey } = useEntityDetail();
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
      setKey={setKey}
    />
  );
}

export function FeatureForceTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "force");
  const selectedEnvironment = environmentKey || environments[0];
  const rows = environments.length > 0 ? entity.force?.[selectedEnvironment] : entity.force;

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  return (
    <FeatureRows
      title="Force"
      emptyTitle="No forced rules found"
      base="force"
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={rows || []}
      showConditions
      setKey={setKey}
    />
  );
}

function FeatureRows(props: {
  title: string;
  emptyTitle?: string;
  base: string;
  environments: string[];
  selectedEnvironment?: string;
  rows: any[];
  expose?: unknown;
  showConditions: boolean;
  setKey?: string;
}) {
  useScrollToHash([props.base, props.selectedEnvironment, props.rows.length]);

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
              className={[
                "inline-flex rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                environment === props.selectedEnvironment
                  ? "border-primary bg-header-active !text-header-text"
                  : "border-pill bg-transparent text-text hover:bg-elevated",
              ].join(" ")}
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

      {props.rows.length === 0 && (
        <EmptyState
          title={props.emptyTitle || `No ${props.title.toLowerCase()} found`}
        />
      )}
      <div className="space-y-8">
        {props.rows.map((row, index) => {
          const ruleKey = String(row.key || `#${index + 1}`);
          const ruleId = slugifyFragment(
            [props.base, props.selectedEnvironment, ruleKey].filter(Boolean).join("-"),
          );

          return (
            <section key={row.key || index} className="space-y-4">
              <div className="space-y-3">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="group flex min-w-0 flex-wrap items-center gap-2">
                    <h2 id={ruleId} className="font-semibold [overflow-wrap:anywhere]">
                      <EntityKey value={ruleKey} className="font-semibold" />
                    </h2>
                    <RulePermalink targetId={ruleId} />
                    {row.enabled === false && <Badge tone="danger">disabled</Badge>}
                    {row.promotable === false && <Badge>not promotable</Badge>}
                  </div>
                  {typeof row.percentage === "number" && <RuleProgress value={row.percentage} />}
                </div>
                {row.summary && <p className="text-sm text-muted">{row.summary}</p>}
                {row.description && <MarkdownContent value={row.description} />}
              </div>

              <div className={`grid gap-4 ${props.showConditions ? "md:grid-cols-2" : ""}`}>
                <div className="space-y-2 rounded-xl border border-border bg-elevated p-4">
                  <h3 className="text-sm font-semibold text-muted">Segments</h3>
                  <GroupSegmentTree segments={row.segments} setKey={props.setKey} />
                </div>
                {props.showConditions && (
                  <div className="space-y-2 rounded-xl border border-border bg-elevated p-4">
                    <h3 className="text-sm font-semibold text-muted">Conditions</h3>
                    <ConditionTree conditions={row.conditions} setKey={props.setKey} />
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RuleProgress(props: { value: number }) {
  const value = Math.max(0, Math.min(100, props.value));

  return (
    <div className="flex w-2/5 min-w-0 max-w-sm shrink-0 items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs font-semibold text-muted">{value}%</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function FeatureVariationsTab() {
  const { detail, setKey } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variations = entity.variations || [];

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (variations.length === 0) {
    return <EmptyState title="No variations found" />;
  }

  return <FeatureVariationsList variations={variations} setKey={setKey} />;
}

export function FeatureVariablesTab() {
  const { detail, setKey } = useEntityDetail();
  const entity = detail.entity as Record<string, any>;
  const variablesSchema = entity.variablesSchema || {};

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  if (Object.keys(variablesSchema).length === 0) {
    return <EmptyState title="No variables found" />;
  }

  return <FeatureVariablesList variablesSchema={variablesSchema} setKey={setKey} />;
}

function getUsageEntityType(label: string): CatalogEntityType {
  if (label.includes("segment")) {
    return "segment";
  }

  if (label.includes("target")) {
    return "target";
  }

  if (label.includes("attribute")) {
    return "attribute";
  }

  if (label.includes("schema")) {
    return "schema";
  }

  if (label.includes("group")) {
    return "group";
  }

  if (label.includes("test")) {
    return "test";
  }

  return "feature";
}

function getUsageTitle(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function UsageSection(props: {
  title: string;
  type: CatalogEntityType;
  values: string[];
  setKey?: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text">{props.title}</h2>
      <ul className="list-inside list-disc space-y-1 text-sm">
        {props.values.map((value) => (
          <li key={value} className="[overflow-wrap:anywhere]">
            <Link
              className="text-primary hover:underline"
              to={getEntityRoute(props.type, value, props.setKey)}
            >
              <EntityKey value={value} className="font-medium" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
      : Object.entries(relationships).filter(([label]) => label !== "tests");
  const visibleEntries = entries.filter(([, values]) => values.length > 0);

  if (visibleEntries.length === 0) {
    return <EmptyState title="No usage found" />;
  }

  return (
    <div className="space-y-6">
      {visibleEntries.map(([label, values]) => (
        <UsageSection
          key={label}
          title={getUsageTitle(label)}
          type={getUsageEntityType(label)}
          values={values}
          setKey={setKey}
        />
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
