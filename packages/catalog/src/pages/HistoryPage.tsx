import * as React from "react";
import { useParams } from "react-router-dom";

import { fetchHistoryPage } from "../api";
import { EmptyState, PageHeader } from "../components/ui";
import type { HistoryPage as HistoryPageData } from "../types";

export function HistoryPage() {
  const { setKey } = useParams();
  const path = setKey ? `data/sets/${encodeURIComponent(setKey)}/history` : "data/project/history";
  const [page, setPage] = React.useState<HistoryPageData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPage(null);
    setError(null);
    fetchHistoryPage(path, 1)
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, [path]);

  if (error) {
    return <EmptyState title="Unable to load history" description={error} />;
  }

  if (!page) {
    return <div className="text-muted">Loading history...</div>;
  }

  return (
    <div>
      <PageHeader title="History" description={`${page.entries.length} entries`} />
      <div className="space-y-3">
        {page.entries.map((entry) => (
          <div key={entry.commit} className="rounded border border-border bg-surface p-4 shadow">
            <div className="font-mono text-sm">{entry.commit.slice(0, 10)}</div>
            <div className="mt-1 text-sm text-muted">
              {entry.author} · {new Date(entry.timestamp).toLocaleString()}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.entities.map((entity) => (
                <span
                  key={`${entity.type}:${entity.key}`}
                  className="rounded bg-elevated px-2 py-1 text-xs"
                >
                  {entity.type}: {entity.key}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
