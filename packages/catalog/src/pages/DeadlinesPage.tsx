import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { decodeRouteSegment, getBasePath } from "../entityTypes";
import {
  getDeadlineClock,
  getDeadlineLabel,
  getProjectDeadlines,
  matchesDeadlineStatus,
  type DeadlineStatus,
  type ProjectDeadline,
} from "../metadata";
import { useCatalogIndex } from "../useCatalogIndex";
import { useDocumentTitle } from "../useDocumentTitle";
import { ProjectDeadlineList } from "../components/metadata";
import { EmptyState, OverviewSection, PageHeader, PageSkeleton } from "../components/ui";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Due in 30 days" },
  { value: "later", label: "Later" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

const GROUPS: Array<{ status: DeadlineStatus; title: string }> = [
  { status: "overdue", title: "Overdue" },
  { status: "today", title: "Due today" },
  { status: "upcoming", title: "Due in the next 30 days" },
  { status: "later", title: "Later" },
  { status: "done", title: "Done" },
];

function Pill(props: { active: boolean; to: string; children: React.ReactNode; count?: number }) {
  return (
    <Link
      to={props.to}
      replace
      aria-current={props.active ? "true" : undefined}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        props.active
          ? "border-header-active bg-header-active text-header-text"
          : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400 hover:bg-slate-50",
      ].join(" ")}
    >
      {props.children}
      {typeof props.count === "number" && (
        <span className={props.active ? "opacity-80" : "text-faint"}>{props.count}</span>
      )}
    </Link>
  );
}

/** Every deadline in the project or a Set, grouped by how it stands */
export function DeadlinesPage() {
  const { setKey: encodedSetKey } = useParams();
  const setKey = encodedSetKey ? decodeRouteSegment(encodedSetKey) : undefined;
  const { index, error } = useCatalogIndex(setKey);
  const [searchParams] = useSearchParams();
  const clock = React.useMemo(() => getDeadlineClock(), []);
  useDocumentTitle("Deadlines", setKey);

  if (error) return <EmptyState title="Unable to load catalog index" description={error} />;
  if (!index) return <PageSkeleton label="Loading deadlines" variant="list" />;

  const all = getProjectDeadlines(index, clock);
  const requested = searchParams.get("status") as Filter | null;
  const filter: Filter = FILTERS.some((item) => item.value === requested) ? requested! : "open";
  const type = searchParams.get("type") || undefined;
  const ofType = type ? all.filter((item) => item.deadline.type === type) : all;
  const matches = (item: ProjectDeadline, value: Filter) =>
    value === "all" || matchesDeadlineStatus(item.status, value);
  const shown = ofType.filter((item) => matches(item, filter));
  const types = [...new Set(all.map((item) => item.deadline.type))].sort();
  const link = (next: { status?: string; type?: string }) => {
    const params = new URLSearchParams();
    const status = "status" in next ? next.status : filter;
    const nextType = "type" in next ? next.type : type;
    if (status && status !== "open") params.set("status", status);
    if (nextType) params.set("type", nextType);
    const query = params.toString();
    return `${getBasePath(setKey)}/deadlines${query ? `?${query}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Deadlines"
        description="What definitions' metadata plans, from the earliest date. Nothing happens when one passes."
      />
      <div className="space-y-6 px-6 pb-6">
        {all.length === 0 ? (
          <EmptyState
            title="No deadlines"
            description="Definitions plan work with metadata deadlines, such as a review or a removal by a date."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
                {FILTERS.map((item) => (
                  <Pill
                    key={item.value}
                    active={filter === item.value}
                    to={link({ status: item.value })}
                    count={ofType.filter((deadline) => matches(deadline, item.value)).length}
                  >
                    {item.label}
                  </Pill>
                ))}
              </div>
              {types.length > 1 && (
                <div role="group" aria-label="Type" className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    Type
                  </span>
                  {types.map((name) => (
                    <Pill
                      key={name}
                      active={type === name}
                      to={link({ type: type === name ? undefined : name })}
                    >
                      {getDeadlineLabel(name)}
                    </Pill>
                  ))}
                </div>
              )}
            </div>

            {shown.length === 0 ? (
              <EmptyState title="No deadlines match these filters" />
            ) : (
              GROUPS.map(({ status, title }) => {
                const items = shown.filter((item) => item.status === status);
                if (items.length === 0) return null;
                return (
                  <OverviewSection key={status} title={`${title} · ${items.length}`}>
                    <ProjectDeadlineList items={items} clock={clock} setKey={setKey} />
                  </OverviewSection>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
