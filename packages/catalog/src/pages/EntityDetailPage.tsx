import * as React from "react";
import { Link, Navigate, Outlet, useLocation, useParams } from "react-router-dom";

import { CatalogNotFoundError, fetchEntityDetail, fetchIndex, peekEntityDetail } from "../api";
import {
  decodeRouteSegment,
  entityTypeToPath,
  entityLabels,
  entityPathToType,
  getEntityListRoute,
  getEntityRoute,
} from "../entityTypes";
import type { CatalogEntityType, EntityDetail, EntityPath } from "../types";
import { EmptyState, OverviewChipLink, PageHeader, PageSkeleton, Tabs } from "../components/ui";
import { DeprecatedDependencies, LifecycleBanner } from "../components/insights";
import { useEntityDependencies } from "../components/dependencies";
import { useDocumentTitle } from "../useDocumentTitle";
import { recordRecentEntity } from "../recentEntities";
import { EditLink } from "../components/editLink";
import { countItems } from "./entityDetail/shared";
import { countUsage } from "./entityDetail/UsageTab";

// Tabs live in entityDetail/. The router and tests import them from this page.
export { useEntityDetail } from "./entityDetail/shared";
export { OverviewTab } from "./entityDetail/OverviewTab";
export { FeatureRulesTab, FeatureForceTab } from "./entityDetail/RulesTab";
export { VariableOverridesTab } from "./entityDetail/OverridesTab";
export { FeatureVariationsTab } from "./entityDetail/VariationsTab";
export { getVariableSetters, FeatureVariablesTab } from "./entityDetail/VariablesTab";
export { UsageTab } from "./entityDetail/UsageTab";
export { TestsTab } from "./entityDetail/TestsTab";
export { HistoryTab } from "./entityDetail/HistoryTab";

function isEntityPath(value: string | undefined): value is EntityPath {
  return (
    value === "features" ||
    value === "segments" ||
    value === "attributes" ||
    value === "targets" ||
    value === "schemas" ||
    value === "variables" ||
    value === "tests"
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose the API but deny access in the current context.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }

  if (!copied) {
    throw new Error("Could not copy entity key");
  }
}

function CopyEntityKeyButton(props: { entityKey: string }) {
  const [status, setStatus] = React.useState<"idle" | "copied" | "error">("idle");
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }

    try {
      await copyText(props.entityKey);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    resetTimer.current = setTimeout(() => {
      setStatus("idle");
      resetTimer.current = null;
    }, 2000);
  }

  const label =
    status === "copied"
      ? `Copied ${props.entityKey}`
      : status === "error"
        ? `Could not copy ${props.entityKey}`
        : `Copy ${props.entityKey}`;

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={handleCopy}
        className={[
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-faint outline-none transition-all",
          "opacity-100 md:opacity-0 md:group-hover:opacity-100",
          "hover:border-border hover:bg-elevated hover:text-text",
          "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary",
          status === "copied"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 !opacity-100"
            : status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700 !opacity-100"
              : "border-border/70 bg-surface",
        ].join(" ")}
      >
        {status === "copied" ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            className="h-4 w-4"
          >
            <path d="m4 10 3.5 3.5L16 5" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
            className="h-4 w-4"
          >
            <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
            <path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "Entity key copied" : status === "error" ? "Copy failed" : ""}
      </span>
    </>
  );
}

function getKeySuggestions(keys: string[], wanted: string) {
  const needle = wanted.toLowerCase();

  return keys
    .map((key) => {
      const candidate = key.toLowerCase();
      let score = 0;
      if (candidate.includes(needle) || needle.includes(candidate)) score += 3;
      let prefix = 0;
      while (
        prefix < Math.min(candidate.length, needle.length) &&
        candidate[prefix] === needle[prefix]
      )
        prefix += 1;
      score += Math.min(prefix, 6) / 2;
      return { key, score };
    })
    .filter((item) => item.score >= 1.5)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, 5)
    .map((item) => item.key);
}

const ENTITY_TABS = new Set([
  "variations",
  "variables",
  "rules",
  "force",
  "overrides",
  "tests",
  "usage",
  "contents",
  "history",
]);

/**
 * Path segments after the entity key that are not a tab. A key pasted with its namespace
 * written as slashes, such as /tests/scenarios/checkout, arrives this way.
 */
export function getExtraKeySegments(pathname: string, entityPath: string, entityKey: string) {
  const segments = pathname.split("/").filter(Boolean);
  const keyIndex = segments.findIndex(
    (segment, index) =>
      segments[index - 1] === entityPath && decodeRouteSegment(segment) === entityKey,
  );
  if (keyIndex === -1) return [];
  const rest = segments.slice(keyIndex + 1).map(decodeRouteSegment);
  return rest.length && !ENTITY_TABS.has(rest[0]) ? rest : [];
}

/** Join extra segments with a slash or a dot, the two namespace characters in use. */
export function findNamespacedKey(keys: string[], entityKey: string, extra: string[]) {
  if (!extra.length) return undefined;
  const candidates = [[entityKey, ...extra].join("/"), [entityKey, ...extra].join(".")];
  return candidates.find((key) => keys.includes(key));
}

function EntityNotFound(props: { type: CatalogEntityType; entityKey: string; setKey?: string }) {
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [redirect, setRedirect] = React.useState<string>();
  const label = entityLabels[props.type];
  const location = useLocation();
  const extra = getExtraKeySegments(
    location.pathname,
    entityTypeToPath[props.type],
    props.entityKey,
  );
  const fullKey = [props.entityKey, ...extra].join("/");

  React.useEffect(() => {
    let active = true;
    fetchIndex(props.setKey)
      .then((index) => {
        const keys = (index.entities[props.type] || []).map((entity) => entity.key);
        const match = findNamespacedKey(keys, props.entityKey, extra);
        if (!active) return;
        if (match) setRedirect(getEntityRoute(props.type, match, props.setKey));
        else setSuggestions(getKeySuggestions(keys, fullKey));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.type, props.entityKey, props.setKey, fullKey, extra.length]);

  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Not found</p>
      <h1 className="mt-2 text-xl font-semibold text-text">
        {label.singular} <span className="font-mono">{fullKey}</span> does not exist
      </h1>
      <p className="mt-2 text-sm text-muted">
        It may have been renamed or removed, or it may belong to another set.
      </p>
      {suggestions.length > 0 && (
        <div className="mt-6">
          <p className="text-sm text-muted">Did you mean:</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {suggestions.map((key) => (
              <OverviewChipLink key={key} to={getEntityRoute(props.type, key, props.setKey)}>
                {key}
              </OverviewChipLink>
            ))}
          </div>
        </div>
      )}
      <Link
        to={getEntityListRoute(props.type, props.setKey)}
        className="mt-6 inline-flex text-sm font-medium text-primary hover:underline"
      >
        Browse all {label.plural.toLowerCase()}
      </Link>
    </div>
  );
}

/**
 * Remount per entity so tabs never render with the previous entity's detail. Otherwise a
 * link from a segment straight to a feature's rules would briefly see a segment, and the
 * feature only tabs would redirect to the overview before the new detail loads.
 */
export function EntityDetailPage() {
  const { entityPath, entityKey, setKey } = useParams();

  return (
    <EntityDetailView key={[setKey || "", entityPath || "", entityKey || ""].join("\u0000")} />
  );
}

function EntityDetailView() {
  const { entityPath, entityKey, setKey: encodedSetKey } = useParams();
  const setKey = encodedSetKey ? decodeRouteSegment(encodedSetKey) : undefined;
  const decodedEntityKey = entityKey ? decodeRouteSegment(entityKey) : undefined;
  // This view remounts per entity, so the cached detail (if any) is always the right one.
  const [detail, setDetail] = React.useState<EntityDetail | null>(() =>
    isEntityPath(entityPath) && decodedEntityKey
      ? (peekEntityDetail(entityPathToType[entityPath], decodedEntityKey, setKey) ?? null)
      : null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const dependencies = useEntityDependencies(detail, setKey);
  useDocumentTitle(
    notFound ? "Not found" : decodedEntityKey,
    isEntityPath(entityPath) && entityLabels[entityPathToType[entityPath]].plural,
    setKey,
  );
  React.useEffect(() => {
    if (detail) recordRecentEntity({ type: detail.type, key: detail.key, set: setKey });
  }, [detail, setKey]);

  React.useEffect(() => {
    if (!isEntityPath(entityPath) || !decodedEntityKey) {
      return;
    }

    let active = true;
    fetchEntityDetail(entityPathToType[entityPath], decodedEntityKey, setKey)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((err: Error) => {
        if (!active) return;
        if (err instanceof CatalogNotFoundError) setNotFound(true);
        else setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [entityPath, decodedEntityKey, setKey]);

  if (!isEntityPath(entityPath) || !decodedEntityKey) {
    return <Navigate to="/features" replace />;
  }

  const type = entityPathToType[entityPath];

  if (notFound) {
    return <EntityNotFound type={type} entityKey={decodedEntityKey} setKey={setKey} />;
  }

  if (error) {
    return <EmptyState title="Unable to load entity" description={error} />;
  }

  if (!detail) {
    return (
      <PageSkeleton
        label={`Loading ${entityLabels[type].singular.toLowerCase()}`}
        variant="detail"
      />
    );
  }

  // Tabs with nothing to show are disabled and marked "(0)". History is left enabled,
  // since its entries are only known once they load.
  const entity = detail.entity as Record<string, unknown>;
  const tabs = [
    { to: ".", label: "Overview" },
    ...(type === "feature"
      ? [
          { to: "variations", label: "Variations", count: countItems(entity.variations) },
          {
            to: "variables",
            label: "Variables",
            count: Object.keys((entity.variablesSchema as object) || {}).length,
          },
          { to: "rules", label: "Rules", count: countItems(entity.rules) },
          { to: "force", label: "Force", count: countItems(entity.force) },
        ]
      : []),
    ...(type === "variable"
      ? [{ to: "overrides", label: "Overrides", count: countItems(entity.overrides) }]
      : []),
    ...(type === "feature" || type === "segment" || type === "variable"
      ? [
          {
            to: "tests",
            label: "Tests",
            count: (detail.tests?.length || 0) + (detail.relatedScenarios?.length || 0),
          },
        ]
      : []),
    ...(type === "target"
      ? [{ to: "contents", label: "Contents", count: countUsage(detail, dependencies) }]
      : type !== "test"
        ? [{ to: "usage", label: "Usage", count: countUsage(detail, dependencies) }]
        : []),
    { to: "history", label: "History" },
  ];

  return (
    <div>
      <PageHeader
        title={detail.key}
        titleAction={<CopyEntityKeyButton entityKey={detail.key} />}
        description={
          type === "test" && "scenario" in detail.entity ? "Scenario" : entityLabels[type].singular
        }
        actions={<EditLink sourcePath={detail.sourcePath} editLinks={detail.editLinks} />}
      />
      <LifecycleBanner
        type={type}
        entity={detail.entity as Record<string, unknown>}
        usage={{
          direct: detail.usedBy?.length || 0,
          indirect: dependencies.usedIndirectlyBy.length,
        }}
      />
      <DeprecatedDependencies detail={detail} setKey={setKey} />
      <Tabs items={tabs} />
      <div className="px-6 py-6">
        {/* Tabs load on demand; keep the header and tab bar in place while one loads. */}
        <React.Suspense fallback={<PageSkeleton label="Loading tab" variant="timeline" />}>
          <Outlet context={{ detail, setKey }} />
        </React.Suspense>
      </div>
    </div>
  );
}
