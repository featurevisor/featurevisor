import * as React from "react";
import { Link, useParams } from "react-router-dom";

import { fetchHistoryPage } from "../api";
import { encodeRouteSegment, entityLabels, getEntityRoute } from "../entityTypes";
import { Button, EmptyState, EntityKey, PageHeader } from "../components/ui";
import { useCatalog } from "../context/CatalogContext";
import type { HistoryEntry } from "../types";

const HISTORY_VISIBLE_ENTITY_LIMIT = 10;

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function HistoryEntryCard(props: { entry: HistoryEntry; setKey?: string; commitUrl?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const entities = props.entry.entities.filter((entity) => entity.type !== "test");
  const hasMore = entities.length > HISTORY_VISIBLE_ENTITY_LIMIT;
  const visibleEntities = expanded ? entities : entities.slice(0, HISTORY_VISIBLE_ENTITY_LIMIT);

  return (
    <li className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/5">
      <div className="text-sm">
        <span className="font-semibold">{props.entry.author}</span>{" "}
        <a
          className="text-primary hover:underline"
          href={
            props.commitUrl?.replace("{{hash}}", props.entry.commit) || `#${props.entry.commit}`
          }
          target="_blank"
          rel="noreferrer"
        >
          {formatTimestamp(props.entry.timestamp)}
        </a>
      </div>
      <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted">
        {visibleEntities.map((entity) => (
          <li key={`${entity.type}-${entity.key}`} className="[overflow-wrap:anywhere]">
            {entityLabels[entity.type].singular}{" "}
            <Link
              className="font-medium text-primary hover:underline"
              to={getEntityRoute(entity.type, entity.key, entity.set || props.setKey)}
            >
              <EntityKey value={entity.key} className="font-medium" />
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-3 text-sm font-semibold text-primary hover:underline"
        >
          {expanded
            ? "See less"
            : `See more (${props.entry.entities.length - HISTORY_VISIBLE_ENTITY_LIMIT} more)`}
        </button>
      )}
    </li>
  );
}

function HistoryTimeline(props: { path: string; setKey?: string; commitUrl?: string }) {
  const [entries, setEntries] = React.useState<HistoryEntry[]>([]);
  const [page, setPage] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);

  async function loadPage(nextPage: number) {
    try {
      const response = await fetchHistoryPage(props.path, nextPage);
      setEntries((current) => [...current, ...response.entries]);
      setPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  React.useEffect(() => {
    setEntries([]);
    setPage(0);
    setTotalPages(1);
    setError(null);
    loadPage(1);
  }, [props.path]);

  if (error) {
    return <EmptyState title="History unavailable" description={error} />;
  }

  if (entries.length === 0 && page > 0) {
    return <EmptyState title="No history found" />;
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {entries.map((entry) => (
          <HistoryEntryCard
            key={`${entry.commit}-${entry.timestamp}`}
            entry={entry}
            setKey={props.setKey}
            commitUrl={props.commitUrl}
          />
        ))}
      </ol>

      {page < totalPages && (
        <Button onClick={() => loadPage(page + 1)} className="w-full">
          Load more
        </Button>
      )}
    </div>
  );
}

export function HistoryPage() {
  const { manifest } = useCatalog();
  const { setKey } = useParams();
  const path = setKey
    ? `/data/sets/${encodeRouteSegment(setKey)}/history`
    : "/data/project/history";

  return (
    <div>
      <PageHeader
        title={setKey ? `History for ${setKey}` : "Project History"}
        description="Recent Git changes for authored definitions."
      />
      <div className="px-6 pb-6">
        <HistoryTimeline path={path} setKey={setKey} commitUrl={manifest.links?.commit} />
      </div>
    </div>
  );
}
