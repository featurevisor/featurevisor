import * as React from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { fetchIndex } from "../api";
import { entityLabels, entityPathToType, getEntityRoute } from "../entityTypes";
import type { CatalogIndex, EntityPath } from "../types";
import { Badge, EmptyState, PageHeader, getEntityTone, formatList } from "../components/ui";

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

export function ListPage() {
  const { entityPath, setKey } = useParams();
  const [index, setIndex] = React.useState<CatalogIndex | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    setIndex(null);
    setError(null);
    fetchIndex(setKey)
      .then(setIndex)
      .catch((err: Error) => setError(err.message));
  }, [setKey]);

  if (!isEntityPath(entityPath)) {
    return <Navigate to="features" replace />;
  }

  const type = entityPathToType[entityPath];
  const entities =
    index?.entities[type].filter((entity) => {
      const haystack =
        `${entity.key} ${entity.description || ""} ${(entity.tags || []).join(" ")}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    }) || [];

  if (error) {
    return <EmptyState title="Unable to load catalog index" description={error} />;
  }

  if (!index) {
    return <div className="text-muted">Loading {entityLabels[type].plural.toLowerCase()}...</div>;
  }

  return (
    <div>
      <PageHeader
        title={entityLabels[type].plural}
        description={`${entities.length} of ${index.counts[type]} shown`}
        actions={
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="rounded border border-border bg-surface px-3 py-2 text-sm outline-none"
          />
        }
      />

      <div className="overflow-hidden rounded border border-border bg-surface shadow-soft">
        {entities.length === 0 && <div className="p-6 text-sm text-muted">No entries found.</div>}
        {entities.map((entity) => (
          <Link
            key={entity.key}
            to={getEntityRoute(type, entity.key, setKey)}
            className="block border-b border-border p-4 last:border-b-0 hover:bg-elevated"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={getEntityTone(type)}>{entityLabels[type].singular}</Badge>
                  <span className="font-mono text-sm font-semibold">{entity.key}</span>
                  {entity.archived && <Badge tone="warning">archived</Badge>}
                  {entity.deprecated && <Badge tone="danger">deprecated</Badge>}
                  {entity.promotable === false && <Badge>not promotable</Badge>}
                </div>
                <p className="mt-2 text-sm text-muted">{entity.description || "No description"}</p>
              </div>
              <div className="max-w-xs text-right">
                {formatList(entity.tags || entity.targets || entity.environments)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
