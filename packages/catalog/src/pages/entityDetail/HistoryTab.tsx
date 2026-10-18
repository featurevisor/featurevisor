import * as React from "react";
import { useSearchParams } from "react-router-dom";

import { useCatalog } from "../../context/CatalogContext";
import { encodeRouteSegment, entityLabels } from "../../entityTypes";
import type { EntityDetail, HistoryEntry } from "../../types";
import { EmptyState } from "../../components/ui";
import { useEntityDependencies } from "../../components/dependencies";
import type { EntityDependencies } from "../../dependencyIndex";
import { HistoryTimeline } from "../HistoryPage";
import { useEntityDetail } from "./shared";

const DEPENDENCIES_PARAM = "dependencies";

/** This entity and everything it depends on, as "type:key", including schemas it reads. */
function getHistoryScope(detail: EntityDetail, dependencies: EntityDependencies) {
  const scope = new Set<string>([`${detail.type}:${detail.key}`]);
  for (const entry of [...dependencies.uses, ...dependencies.usesIndirectly]) {
    scope.add(`${entry.type}:${entry.key}`);
  }
  for (const schema of detail.relationships?.schemas || []) scope.add(`schema:${schema}`);
  return scope;
}

function ScopeToggle(props: { label: string; dependencies: number; withDependencies: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const choose = (value: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(DEPENDENCIES_PARAM, "1");
    else next.delete(DEPENDENCIES_PARAM);
    setSearchParams(next, { replace: true });
  };
  const option = (active: boolean) =>
    [
      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      active ? "bg-surface text-text shadow-sm ring-1 ring-border" : "text-muted hover:text-text",
    ].join(" ");

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="History scope"
        className="inline-flex rounded-lg bg-elevated p-0.5"
      >
        <button
          type="button"
          aria-pressed={!props.withDependencies}
          onClick={() => choose(false)}
          className={option(!props.withDependencies)}
        >
          This {props.label}
        </button>
        <button
          type="button"
          aria-pressed={props.withDependencies}
          onClick={() => choose(true)}
          className={option(props.withDependencies)}
        >
          With its {props.dependencies} {props.dependencies === 1 ? "dependency" : "dependencies"}
        </button>
      </div>
      {props.withDependencies && (
        <p className="text-xs text-muted">
          Commits that changed it or anything it depends on, which can change its result too.
        </p>
      )}
    </div>
  );
}

export function HistoryTab() {
  const { detail, setKey } = useEntityDetail();
  const { manifest } = useCatalog();
  const [searchParams] = useSearchParams();
  const entityDependencies = useEntityDependencies(detail, setKey);
  const scope = React.useMemo(
    () => getHistoryScope(detail, entityDependencies),
    [detail, entityDependencies],
  );
  const dependencies = scope.size - 1;
  const withDependencies = dependencies > 0 && searchParams.get(DEPENDENCIES_PARAM) === "1";
  const matches = React.useCallback(
    (entry: HistoryEntry) =>
      entry.entities.some(
        (entity) =>
          scope.has(`${entity.type}:${entity.key}`) &&
          (!setKey || !entity.set || entity.set === setKey),
      ),
    [scope, setKey],
  );

  if (!detail.historyPath) {
    return <EmptyState title="No history found" />;
  }

  const label = entityLabels[detail.type].singular.toLowerCase();

  return (
    <>
      {dependencies > 0 && (
        <ScopeToggle
          label={label}
          dependencies={dependencies}
          withDependencies={withDependencies}
        />
      )}
      {withDependencies ? (
        // Project history lists every entity a commit touched, so it can be filtered by scope.
        <HistoryTimeline
          path={
            setKey ? `/data/sets/${encodeRouteSegment(setKey)}/history` : "/data/project/history"
          }
          setKey={setKey}
          commitUrl={manifest.links?.commit}
          matches={matches}
        />
      ) : (
        <HistoryTimeline
          path={detail.historyPath}
          setKey={setKey}
          commitUrl={manifest.links?.commit}
          showEntities={false}
        />
      )}
    </>
  );
}
