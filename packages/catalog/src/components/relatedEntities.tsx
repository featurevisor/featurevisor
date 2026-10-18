import * as React from "react";
import { Link } from "react-router-dom";

import { entityLabels, getEntityRoute } from "../entityTypes";
import type { CatalogEntityType, EntitySummary } from "../types";
import { Badge, EntityKey } from "./ui";
import { useCatalogIndex } from "../useCatalogIndex";

/** Lists longer than this start collapsed and gain a filter. */
const INITIAL_LIMIT = 12;

const STATUS_DOTS: Record<NonNullable<EntitySummary["environmentStatus"]>, [string, string]> = {
  production: ["bg-emerald-500", "Enabled in production"],
  enabled: ["bg-emerald-500", "Enabled"],
  other: ["bg-amber-500", "Enabled outside production only"],
  disabled: ["bg-slate-300", "Disabled everywhere"],
};

function useEntitySummaries(type: CatalogEntityType, setKey?: string) {
  const { index } = useCatalogIndex(setKey);

  return React.useMemo(
    () =>
      index
        ? new Map((index.entities[type] || []).map((entity) => [entity.key, entity]))
        : undefined,
    [index, type],
  );
}

function RelatedEntityRow(props: {
  type: CatalogEntityType;
  entityKey: string;
  summary?: EntitySummary;
  note?: string;
  badge?: string;
  setKey?: string;
}) {
  const { summary } = props;
  const status = props.type === "feature" ? summary?.environmentStatus : undefined;

  return (
    <li>
      <Link
        to={getEntityRoute(props.type, props.entityKey, props.setKey)}
        className="group flex h-full min-w-0 items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-elevated"
      >
        {status && (
          <span
            title={STATUS_DOTS[status][1]}
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[status][0]}`}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <EntityKey
              value={props.entityKey}
              className="text-sm font-medium text-text group-hover:underline"
            />
            {props.type === "variable" && summary?.variableType && (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-600">
                {summary.variableType}
              </code>
            )}
            {props.badge && <Badge tone="info">{props.badge}</Badge>}
            {summary?.deprecated && <Badge tone="warning">deprecated</Badge>}
            {summary?.archived && <Badge tone="danger">archived</Badge>}
          </span>
          {summary?.description && (
            <span className="mt-0.5 block truncate text-xs text-muted">{summary.description}</span>
          )}
          {props.note && <span className="mt-0.5 block text-xs text-faint">{props.note}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Linked entities with their descriptions, in two columns, filterable when the list is long. */
export function RelatedEntities(props: {
  title: string;
  type: CatalogEntityType;
  values?: string[];
  /** Short context shown under an entry, keyed by entity key. */
  notes?: Record<string, string>;
  /** A short badge beside an entry's key, keyed by entity key. */
  badges?: Record<string, string>;
  setKey?: string;
}) {
  const summaries = useEntitySummaries(props.type, props.setKey);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const values = React.useMemo(
    () => (props.values || []).slice().sort((left, right) => left.localeCompare(right)),
    [props.values],
  );

  if (values.length === 0) return null;

  const long = values.length > INITIAL_LIMIT;
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? values.filter((key) =>
        [key, summaries?.get(key)?.description || ""].some((text) =>
          text.toLowerCase().includes(normalized),
        ),
      )
    : values;
  const visible = expanded || normalized ? matches : matches.slice(0, INITIAL_LIMIT);
  const plural = entityLabels[props.type].plural.toLowerCase();

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          {props.title}
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold tabular-nums tracking-normal text-slate-600">
            {values.length}
          </span>
        </h2>
        {long && (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${plural}...`}
            aria-label={`Filter ${plural}`}
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text outline-none placeholder:text-faint focus:border-slate-400 sm:w-52"
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface p-1">
        {visible.length > 0 ? (
          <ul className="grid gap-x-1 sm:grid-cols-2">
            {visible.map((key) => (
              <RelatedEntityRow
                key={key}
                type={props.type}
                entityKey={key}
                summary={summaries?.get(key)}
                note={props.notes?.[key]}
                badge={props.badges?.[key]}
                setKey={props.setKey}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-sm text-muted">
            No {plural} match “{query}”.
          </p>
        )}

        {long && !normalized && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-1 w-full rounded-md border-t border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            {expanded ? "Show fewer" : `Show all ${values.length} ${plural}`}
          </button>
        )}
      </div>
    </section>
  );
}
