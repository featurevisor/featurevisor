import * as React from "react";
import { createPortal } from "react-dom";
import {
  NavLink,
  Link,
  useLocation,
  useMatch,
  useNavigate,
  useResolvedPath,
} from "react-router-dom";

import { fetchIndex } from "../api";
import { getCatalogBasePath } from "../basePath";
import type { CatalogIndex, EntityPath } from "../types";
import {
  decodeRouteSegment,
  encodeRouteSegment,
  entityLabels,
  entityPaths,
  entityPathToType,
  getBasePath,
  sortSetKeys,
} from "../entityTypes";
import { useCatalog } from "../context/CatalogContext";
import { GlobalSearch } from "./search";
import { KeyboardShortcuts } from "./shortcuts";
import { ScrollRestoration } from "./scrollRestoration";
import { getThemePreference, setThemePreference, type ThemePreference } from "../theme";
import { useCatalogIndex } from "../useCatalogIndex";
import { recallListSearch } from "../listMemory";
import { formatDate, formatFullTimestamp, formatTime, formatTimeWithSeconds } from "../dates";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

/**
 * One palette for every pill in the Catalog: a pale tint of the hue, text in the
 * same hue at 800 and an inset ring at 200, so each tone stays readable (AA) and
 * tones stay distinguishable from each other without relying on the background.
 */
export const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
  accent: "bg-violet-50 text-violet-800 ring-violet-200",
};

type BadgeTone = Tone | "primary" | "default";

function resolveTone(tone?: BadgeTone): Tone {
  if (!tone || tone === "default") return "neutral";
  if (tone === "primary") return "info";

  return tone;
}

export function Badge(props: { children: React.ReactNode; tone?: BadgeTone; title?: string }) {
  return (
    <span
      title={props.title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4 ring-1 ring-inset ${toneClasses[resolveTone(props.tone)]}`}
    >
      {props.children}
    </span>
  );
}

/** Small uppercase label naming what kind of thing follows it, such as "segment". */
export function TypeLabel(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 tracking-wide text-slate-600">
      {props.children}
    </span>
  );
}

/** A linked reference to another entity: rounded rectangle, so it never reads as a status pill. */
export function EntityChip(props: {
  to: string;
  label?: React.ReactNode;
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <Link
      to={props.to}
      title={props.title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text transition-colors hover:border-slate-400 hover:bg-elevated"
    >
      {props.label && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {props.label}
        </span>
      )}
      <span
        className={[
          "min-w-0 font-medium [overflow-wrap:anywhere]",
          props.mono ? "font-mono text-[11px]" : "",
        ].join(" ")}
      >
        {props.children}
      </span>
    </Link>
  );
}

/** Instant hover and focus tooltip, rendered in a portal so overflow never clips it. */
export function HoverTooltip(props: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);

  function showTooltip() {
    const rect = ref.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setTooltipPosition({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }

  function hideTooltip() {
    setTooltipPosition(null);
  }

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${props.className || ""}`}
      aria-label={props.label}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {props.children}
      {tooltipPosition &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-header px-2 py-1 text-xs font-semibold text-header-text shadow-lg"
            style={{
              left: tooltipPosition.left,
              top: tooltipPosition.top - 8,
            }}
          >
            {props.label}
          </span>,
          document.body,
        )}
    </span>
  );
}

function SkeletonBar(props: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200/70 motion-reduce:animate-none ${props.className || ""}`}
    />
  );
}

/** Placeholder shaped like the page that is loading, so nothing jumps when it arrives. */
export function PageSkeleton(props: {
  label: string;
  variant: "detail" | "list" | "overview" | "timeline";
}) {
  const rows = props.variant === "timeline" ? 4 : props.variant === "list" ? 7 : 3;

  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{props.label}</span>
      {props.variant !== "timeline" && (
        <div className="border-b border-border px-6 pb-4 pt-8">
          <SkeletonBar className="h-8 w-56" />
          <SkeletonBar className="mt-3 h-3 w-20" />
        </div>
      )}
      {props.variant === "detail" && (
        <div className="flex gap-6 border-b border-border px-6 py-4">
          {["w-16", "w-20", "w-16", "w-12"].map((width, index) => (
            <SkeletonBar key={index} className={`h-3 ${width}`} />
          ))}
        </div>
      )}
      <div className={props.variant === "timeline" ? "space-y-6" : "space-y-5 px-6 py-6"}>
        {props.variant === "overview" && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <SkeletonBar key={index} className="h-16 rounded-lg" />
            ))}
          </div>
        )}
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-start gap-3">
            {props.variant === "timeline" && <SkeletonBar className="h-6 w-6 rounded-full" />}
            <div className="flex-1 space-y-2">
              <SkeletonBar className={index % 2 ? "h-3.5 w-1/2" : "h-3.5 w-2/3"} />
              <SkeletonBar className="h-3 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2))
    .toUpperCase()
    .slice(0, 2);
}

/** A person's initials in a circle, with their full name on hover. */
export function AuthorAvatar(props: { name: string; size?: "sm" | "md"; className?: string }) {
  const size = props.size === "sm" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";

  return (
    // An empty title stops a surrounding element's hover text from covering the name.
    <span title="" className="inline-flex">
      <HoverTooltip label={props.name} className="rounded-full">
        <span
          className={`flex ${size} cursor-default items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-600 ${props.className || ""}`}
        >
          {getInitials(props.name)}
        </span>
      </HoverTooltip>
    </span>
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;

  return (
    <button
      className={`rounded border border-border bg-elevated px-4 py-2 text-sm font-bold text-muted shadow-sm hover:bg-background ${className}`}
      {...rest}
    />
  );
}

export function CodeBlock(props: { value: unknown }) {
  const value =
    typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2);

  return (
    <pre className="max-w-full whitespace-pre-wrap rounded border border-border bg-elevated p-4 text-xs text-text [overflow-wrap:anywhere]">
      <code>{value}</code>
    </pre>
  );
}

// The Markdown renderer is the largest dependency; load it only when a page has Markdown.
const ReactMarkdown = React.lazy(() => import("react-markdown"));

function toMarkdownString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const lines = value
      .map((item) => toMarkdownString(item))
      .filter((item): item is string => Boolean(item?.trim()));

    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  return undefined;
}

/** Authored Markdown. The quiet variant suits one line notes under a heading or row. */
export function MarkdownContent(props: { value?: unknown; quiet?: boolean }) {
  const markdown = toMarkdownString(props.value);

  if (!markdown?.trim()) {
    return <span className="text-muted">n/a</span>;
  }

  return (
    <div
      className={
        props.quiet
          ? "prose prose-sm prose-slate max-w-none text-xs dark:prose-invert prose-p:my-0 prose-p:text-xs prose-p:leading-5 prose-p:text-muted"
          : "prose prose-sm prose-slate max-w-none text-text dark:prose-invert"
      }
    >
      <React.Suspense fallback={<p className="whitespace-pre-wrap">{markdown}</p>}>
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </React.Suspense>
    </div>
  );
}

export function DescriptionField(props: { value?: unknown; showTopDivider?: boolean }) {
  const showTopDivider = props.showTopDivider !== false;

  return (
    <div className={showTopDivider ? "border-t border-border pt-6" : undefined}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        Description
      </div>
      <div className="mt-2 min-w-0 text-sm [overflow-wrap:anywhere]">
        <MarkdownContent value={props.value} />
      </div>
    </div>
  );
}

export function LabelValueBadge(props: {
  label: React.ReactNode;
  value: React.ReactNode;
  to?: string;
  compact?: boolean;
}) {
  const valueContent = props.to ? (
    <Link to={props.to} className="font-medium text-primary hover:underline">
      {props.value}
    </Link>
  ) : (
    <span className="font-medium text-text">{props.value}</span>
  );

  if (props.compact) {
    return (
      <span className="inline-flex h-5 shrink-0 overflow-hidden rounded-md border border-border/70 text-[10px] leading-none">
        <span className="flex items-center bg-elevated px-1.5 text-muted">{props.label}</span>
        <span className="flex items-center bg-surface px-1.5 text-text">{valueContent}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs shadow-sm">
      <span className="bg-primary/10 px-2 py-1 font-medium text-primary">{props.label}</span>
      <span className="bg-surface px-2 py-1">{valueContent}</span>
    </span>
  );
}

export function OverviewChip(props: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200",
        props.className || "",
      ].join(" ")}
    >
      {props.children}
    </span>
  );
}

export function OverviewChipLink(props: { to: string; title?: string; children: React.ReactNode }) {
  return (
    <Link
      to={props.to}
      title={props.title}
      className="inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-slate-800 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50 hover:ring-slate-400"
    >
      {props.children}
    </Link>
  );
}

export function OverviewMetaPanel(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-elevated px-5 py-4">
      <dl className="space-y-3.5">{props.children}</dl>
    </div>
  );
}

export function OverviewMetaRow(props: { label: string; children?: React.ReactNode }) {
  if (!props.children) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-5">
      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-faint sm:w-32">
        {props.label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        {props.children}
      </dd>
    </div>
  );
}

export function OverviewSection(props: { title: string; children?: React.ReactNode }) {
  if (!props.children) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export function EmptyState(props: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-6 py-10 text-center">
      <p className="text-sm text-muted">{props.title}</p>
      {props.description && (
        <p className="mt-2 max-w-md text-sm text-faint [overflow-wrap:anywhere]">
          {props.description}
        </p>
      )}
    </div>
  );
}

export function PageHeader(props: {
  title: React.ReactNode;
  titleAction?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 border-b border-border px-6 pb-4 pt-8 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        <div className="group flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 text-3xl font-black text-text [overflow-wrap:anywhere]">
            {props.title}
          </h1>
          {props.titleAction ? <div className="shrink-0">{props.titleAction}</div> : null}
        </div>
        {props.description && (
          <div className="mt-2 min-w-0 text-sm text-muted [overflow-wrap:anywhere]">
            {props.description}
          </div>
        )}
      </div>
      {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
    </div>
  );
}

function sidebarClass({ isActive }: { isActive: boolean }) {
  return [
    "group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold",
    isActive
      ? "bg-header-active !text-header-text"
      : "text-muted hover:bg-elevated hover:text-text",
  ].join(" ");
}

function mobileNavClass({ isActive }: { isActive: boolean }) {
  return [
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold [&[aria-current=page]>span:last-child]:bg-white/15",
    isActive
      ? "border-header-active bg-header-active !text-header-text"
      : "border-border bg-surface text-muted",
  ].join(" ");
}

/** Sections with nothing in them stay reachable but recede. */
function withEmptyState(className: string, state: { isActive: boolean }, count?: number) {
  return count === 0 && !state.isActive ? `${className} opacity-50 hover:opacity-100` : className;
}

function Sidebar(props: { setKey?: string }) {
  const { index } = useCatalogIndex(props.setKey);
  const basePath = getBasePath(props.setKey);
  const mobileNavRef = React.useRef<HTMLElement | null>(null);
  const mobileFade = useScrollFade(mobileNavRef);
  const location = useLocation();

  React.useEffect(() => {
    const active = mobileNavRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [location.pathname, index]);

  const items: Array<{
    to: string;
    label: string;
    end: boolean;
    counted?: boolean;
    count?: number;
  }> = [
    { to: basePath || "/", label: "Overview", end: true },
    ...entityPaths.map((entityPath) => {
      const type = entityPathToType[entityPath];

      return {
        // Return to the list with the search and filters it was last left with.
        to: `${basePath}/${entityPath}${recallListSearch(props.setKey, entityPath)}`,
        label: entityLabels[type].plural,
        count: index?.counts[type],
        counted: true,
        end: false,
      };
    }),
    { to: `${basePath}/history`, label: "History", end: false },
  ];

  return (
    <>
      {/* Phones get a horizontal strip so content starts at the top of the screen. */}
      <nav
        ref={mobileNavRef}
        aria-label="Catalog sections"
        style={mobileFade}
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={(state) => withEmptyState(mobileNavClass(state), state, item.count)}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span className="rounded-full bg-black/5 px-1.5 text-xs font-semibold tabular-nums">
                {item.count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sticky on desktop so long pages keep their navigation in reach. */}
      <aside className="hidden rounded-lg bg-surface p-4 shadow-md ring-1 ring-black/5 md:sticky md:top-4 md:block md:max-h-[calc(100vh-2rem)] md:w-56 md:shrink-0 md:overflow-y-auto">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span className="block px-3">{props.setKey ? "Set" : "Project"}</span>
        </div>
        <nav className="space-y-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={(state) => withEmptyState(sidebarClass(state), state, item.count)}
            >
              <span>{item.label}</span>
              {item.counted && (
                <span className="min-w-7 rounded-full bg-slate-100 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-slate-600 group-aria-[current=page]:bg-white/15 group-aria-[current=page]:text-white">
                  {typeof item.count === "number" ? item.count : "-"}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

function isEntityPath(value: string): value is EntityPath {
  return entityPaths.indexOf(value as EntityPath) !== -1;
}

function hasEntity(index: CatalogIndex, entityPath: EntityPath, entityKey: string) {
  const type = entityPathToType[entityPath];
  const entities = index.entities[type] || [];

  return entities.some((entity) => entity.key === entityKey);
}

export async function getSetSwitchPath(pathname: string, nextSetKey: string) {
  const encodedSetKey = encodeRouteSegment(nextSetKey);
  const listMatch = pathname.match(/^\/sets\/[^/]+\/([^/]+)$/);

  if (listMatch && isEntityPath(listMatch[1])) {
    return `/sets/${encodedSetKey}/${listMatch[1]}`;
  }

  if (pathname.match(/^\/sets\/[^/]+\/history$/)) {
    return `/sets/${encodedSetKey}/history`;
  }

  const detailMatch = pathname.match(/^\/sets\/[^/]+\/([^/]+)\/([^/]+)(\/.*)?$/);

  if (detailMatch && isEntityPath(detailMatch[1])) {
    const entityPath = detailMatch[1];
    // useLocation keeps the URL encoding, unlike useParams which also restores encoded slashes.
    const entityKey = decodeRouteSegment(detailMatch[2]).replace(/%2F/g, "/");
    const suffix = detailMatch[3] || "";

    try {
      const index = await fetchIndex(nextSetKey);

      if (hasEntity(index, entityPath, entityKey)) {
        return `/sets/${encodedSetKey}/${entityPath}/${encodeRouteSegment(entityKey)}${suffix}`;
      }

      return `/sets/${encodedSetKey}/${entityPath}`;
    } catch {
      return `/sets/${encodedSetKey}/${entityPath}`;
    }
  }

  return `/sets/${encodedSetKey}/features`;
}

function SetSwitcher(props: { currentSetKey?: string }) {
  const { manifest } = useCatalog();
  const location = useLocation();
  const navigate = useNavigate();
  const setSelectId = React.useId();
  const setSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const setKeys = sortSetKeys(manifest.setKeys);
  const selectedSetKey = props.currentSetKey || setKeys[0] || "";

  if (!manifest.sets || manifest.setKeys.length === 0) {
    return null;
  }

  function openSetPicker() {
    const select = setSelectRef.current;

    if (!select) {
      return;
    }

    select.focus();

    if (
      typeof (select as HTMLSelectElement & { showPicker?: () => void }).showPicker === "function"
    ) {
      (select as HTMLSelectElement & { showPicker: () => void }).showPicker();
    }
  }

  return (
    <label
      htmlFor={setSelectId}
      className="relative inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white transition-colors hover:bg-white/10 focus-within:ring-2 focus-within:ring-white/40"
      onClick={(event) => {
        if (event.target instanceof HTMLSelectElement) {
          return;
        }

        openSetPicker();
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Set</span>
      <select
        id={setSelectId}
        ref={setSelectRef}
        value={selectedSetKey}
        onChange={async (event) => {
          navigate(await getSetSwitchPath(location.pathname, event.target.value));
        }}
        className="max-w-44 cursor-pointer appearance-none bg-transparent pr-6 font-semibold text-white outline-none [&>option]:bg-surface [&>option]:text-text"
        aria-label="Switch catalog set"
      >
        {setKeys.map((setKey) => (
          <option key={setKey} value={setKey}>
            {setKey}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-2 h-4 w-4 text-white/60"
      >
        <path
          d="M6 8l4 4 4-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </label>
  );
}

function RepositoryIcon(props: { provider?: string; className?: string }) {
  const iconClassName = [
    "h-5 w-5 shrink-0 transition-colors",
    props.className || "fill-white/80",
  ].join(" ");

  if (props.provider === "github") {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 16 16">
        <path d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.72 5.47 7.81.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.6 1.23.85.72 1.25 1.87.9 2.33.69.07-.54.28-.9.51-1.11-1.78-.21-3.64-.92-3.64-4.07 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.19 0 0 .67-.22 2.2.85A7.43 7.43 0 0 1 8 3.94c.68 0 1.36.09 2 .28 1.52-1.07 2.19-.85 2.19-.85.44 1.14.16 1.98.08 2.19.51.58.82 1.32.82 2.22 0 3.16-1.87 3.86-3.65 4.07.29.26.54.76.54 1.54 0 1.11-.01 2.01-.01 2.28 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z" />
      </svg>
    );
  }

  if (props.provider === "gitlab") {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
        <path d="m22.75 9.77-.03-.08-2.17-6.69a.57.57 0 0 0-.55-.39.58.58 0 0 0-.52.35l-1.47 4.48H5.99L4.52 2.96A.58.58 0 0 0 4 2.61a.57.57 0 0 0-.55.39L1.28 9.69l-.03.08a1.54 1.54 0 0 0 .51 1.73l.01.01 10.22 7.43 10.24-7.44.01-.01a1.54 1.54 0 0 0 .51-1.72Z" />
      </svg>
    );
  }

  if (props.provider === "bitbucket") {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
        <path d="M2.19 3.25a.77.77 0 0 0-.76.89l2.7 16.42a1.02 1.02 0 0 0 1 .86H18.9a1.02 1.02 0 0 0 1-.82l2.69-16.46a.77.77 0 0 0-.76-.89H2.19Zm13.36 10.71H9.46l-1.1-5.83h8.25l-1.06 5.83Z" />
      </svg>
    );
  }

  return null;
}

function isKnownRepositoryProvider(provider?: string) {
  return provider === "github" || provider === "gitlab" || provider === "bitbucket";
}

const THEME_ORDER: ThemePreference[] = ["system", "light", "dark"];

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

function ThemeIcon(props: { preference: ThemePreference }) {
  const common = {
    "aria-hidden": true,
    viewBox: "0 0 24 24",
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (props.preference === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    );
  }

  if (props.preference === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** Cycles system, light and dark; the choice is remembered in this browser only. */
function ThemeToggle() {
  const [preference, setPreference] = React.useState<ThemePreference>(() => getThemePreference());
  const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length];

  return (
    <button
      type="button"
      onClick={() => {
        setThemePreference(next);
        setPreference(next);
      }}
      title={`${THEME_LABELS[preference]} (switch to ${next})`}
      aria-label={`${THEME_LABELS[preference]}. Switch to ${next}.`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/80 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-header-text"
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}

export function AppShell(props: { children: React.ReactNode }) {
  const { manifest, live } = useCatalog();
  // Watch mode re-exports on every change, so name the refresh to the second.
  const exportedTime = (live ? formatTimeWithSeconds : formatTime)(manifest.generatedAt);
  const location = useLocation();
  const setKeyMatch = location.pathname.match(/^\/sets\/([^/]+)/);
  const setKey = setKeyMatch ? decodeRouteSegment(setKeyMatch[1]) : undefined;
  const showSidebar = !manifest.sets || Boolean(setKey);

  return (
    <div className="min-h-screen bg-background text-text">
      <a
        href="#main-content"
        onClick={(event) => {
          // Move focus directly: in hash router mode the fragment is the route itself.
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-lg"
      >
        Skip to content
      </a>
      <KeyboardShortcuts setKey={setKey} />
      <ScrollRestoration />
      <header className="bg-header">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center">
            <NavLink
              to="/"
              className={[
                "flex min-w-0 max-w-full items-center gap-2.5 rounded-lg py-1 pr-2 outline-none",
                "ring-offset-2 ring-offset-header focus-visible:ring-2 focus-visible:ring-header-text",
              ].join(" ")}
              aria-label="Featurevisor Catalog home"
            >
              <img
                src={`${getCatalogBasePath()}favicon.png`}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 object-contain"
                decoding="async"
              />
              <img
                src={`${getCatalogBasePath()}logo-text.png`}
                alt=""
                className="h-auto max-h-4 min-w-0 shrink object-contain object-left pl-2"
                decoding="async"
              />
            </NavLink>
          </div>

          <div className="flex items-center gap-3">
            <GlobalSearch />
            <SetSwitcher currentSetKey={setKey} />
            <ThemeToggle />
            {manifest.links?.repository && isKnownRepositoryProvider(manifest.links.provider) && (
              <a
                href={manifest.links.repository}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex shrink-0"
                aria-label={`Open ${manifest.links.provider || "repository"}`}
              >
                <RepositoryIcon
                  provider={manifest.links.provider}
                  className="fill-white/80 group-hover:fill-white"
                />
              </a>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto my-4 max-w-5xl px-4 md:my-8 lg:px-0">
        <div className={showSidebar ? "items-start gap-6 md:flex" : ""}>
          {showSidebar && <Sidebar setKey={setKey} />}
          <div className={["min-w-0", showSidebar ? "flex-1" : "w-full"].filter(Boolean).join(" ")}>
            <section
              id="main-content"
              tabIndex={-1}
              // Clip rather than hide overflow, so the tab bar can stick to the viewport.
              className="overflow-clip rounded-lg bg-surface shadow outline-none"
            >
              {props.children}
            </section>
            <footer className="mt-4 pt-3 text-center">
              <p className="pb-2 text-xs leading-5 text-faint">
                <time
                  dateTime={manifest.generatedAt}
                  title={formatFullTimestamp(manifest.generatedAt)}
                >
                  {live ? "Refreshed" : "Generated"} on {formatDate(manifest.generatedAt)}
                  {exportedTime && ` at ${exportedTime}`}
                </time>
              </p>
              <p className="pb-5 text-xs font-medium leading-5 text-muted">
                Built using{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="https://featurevisor.com"
                  className="font-semibold hover:underline"
                >
                  Featurevisor
                </a>
              </p>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Arrow keys, Home and End move focus between the links of a horizontal section bar. */
function moveFocusBetweenLinks(event: React.KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];

  if (!keys.includes(event.key)) return;

  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);

  if (current === -1) return;

  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? links.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + links.length) % links.length;
  links[next].focus();
  links[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

const TAB_CLASS =
  "inline-block shrink-0 whitespace-nowrap border-b-2 px-3.5 pb-3.5 pt-2 text-center text-sm font-medium outline-none focus-visible:bg-elevated focus-visible:text-text";

function TabItem(props: { to: string; label: string; count?: number }) {
  const resolved = useResolvedPath(props.to);
  const isActive = Boolean(useMatch({ path: resolved.pathname, end: props.to === "." }));
  const empty = props.count === 0;
  const label = (
    <>
      {props.label}
      {empty && <span className="ml-1 tabular-nums">(0)</span>}
    </>
  );

  // Empty tabs are not links, unless already open through a direct URL.
  if (empty && !isActive) {
    return (
      <span
        aria-disabled="true"
        title="Nothing to show"
        className={`${TAB_CLASS} cursor-not-allowed border-transparent text-faint opacity-70`}
      >
        {label}
      </span>
    );
  }

  return (
    <NavLink
      to={props.to}
      end={props.to === "."}
      className={[
        TAB_CLASS,
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted hover:border-border hover:text-text",
      ].join(" ")}
    >
      {label}
    </NavLink>
  );
}

/**
 * Fade the edge of a sideways scroller that hides more content, so a clipped item reads as
 * "more this way" rather than as the end of the list.
 */
function useScrollFade(ref: React.RefObject<HTMLElement | null>) {
  const [overflow, setOverflow] = React.useState({ before: false, after: false });

  React.useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const measure = () =>
      setOverflow({
        before: scroller.scrollLeft > 1,
        after: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
      });
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref]);

  if (!overflow.before && !overflow.after) return undefined;
  const edge = (hidden: boolean) => (hidden ? "transparent" : "black");
  const mask = `linear-gradient(to right, ${edge(overflow.before)}, black 24px, black calc(100% - 24px), ${edge(overflow.after)})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

export function Tabs(props: {
  /** A count of 0 disables the tab and marks it "(0)", as there is nothing to show. */
  items: { to: string; label: string; count?: number }[];
  children?: React.ReactNode;
}) {
  // Without children the wrapper is skipped, so the tab bar can stick within the page below it.
  const Wrapper = props.children ? "div" : React.Fragment;
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  // On narrow screens tabs scroll sideways. Keep the active tab in view after navigating.
  const fade = useScrollFade(scrollerRef);

  React.useEffect(() => {
    scrollerRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [location.pathname]);

  return (
    <Wrapper>
      <nav
        aria-label="Sections"
        onKeyDown={moveFocusBetweenLinks}
        className="sticky top-0 z-20 border-b border-border bg-surface"
      >
        <div
          ref={scrollerRef}
          className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={fade}
        >
          {props.items.map((item) => (
            <TabItem key={item.to} {...item} />
          ))}
        </div>
      </nav>
      {props.children ? <div className="px-6 py-6">{props.children}</div> : null}
    </Wrapper>
  );
}

export function EntityKey(props: { value: string; className?: string }) {
  return (
    <span
      className={["inline leading-snug [overflow-wrap:anywhere]", props.className || ""].join(" ")}
    >
      {props.value.split(".").flatMap((part, index, parts) => {
        const nodes: React.ReactNode[] = [part];
        if (index < parts.length - 1) {
          nodes.push(
            <React.Fragment key={`dot-${index}`}>
              .<wbr />
            </React.Fragment>,
          );
        }
        return nodes;
      })}
    </span>
  );
}
