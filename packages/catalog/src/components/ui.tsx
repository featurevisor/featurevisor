import * as React from "react";
import ReactMarkdown from "react-markdown";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { fetchIndex } from "../api";
import type { CatalogEntityType, CatalogIndex, EntityPath } from "../types";
import {
  decodeRouteSegment,
  encodeRouteSegment,
  entityLabels,
  entityPaths,
  entityPathToType,
  getBasePath,
} from "../entityTypes";
import { useCatalog } from "../context/CatalogContext";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "primary";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-pill bg-pill text-text",
  success: "border-green-300 bg-success-surface text-text",
  warning: "border-orange-300 bg-warning-surface text-text",
  danger: "border-red-300 bg-danger-surface text-danger",
  primary: "border-pill bg-pill text-text",
};

export function Badge(props: { children: React.ReactNode; tone?: BadgeTone | "default" }) {
  const tone = props.tone === "default" ? "neutral" : props.tone || "neutral";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}
    >
      {props.children}
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

export function MarkdownContent(props: { value?: string }) {
  if (!props.value) {
    return <span className="text-muted">n/a</span>;
  }

  return (
    <ReactMarkdown className="prose prose-slate max-w-none text-sm text-text">
      {props.value}
    </ReactMarkdown>
  );
}

export function EmptyState(props: { title: string; description?: string }) {
  return (
    <div className="mx-6 rounded border-2 border-orange-300 bg-warning-surface p-4 text-center text-text">
      <p className="font-medium">{props.title}</p>
      {props.description && <p className="mt-1 text-sm text-muted">{props.description}</p>}
    </div>
  );
}

export function PageHeader(props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 border-b border-border px-6 pb-4 pt-8 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        <h1 className="min-w-0 text-3xl font-black text-text [overflow-wrap:anywhere]">
          {props.title}
        </h1>
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
    "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-bold",
    isActive ? "bg-header-active text-header-text" : "text-muted hover:bg-elevated hover:text-text",
  ].join(" ");
}

function Sidebar(props: { setKey?: string }) {
  const [index, setIndex] = React.useState<CatalogIndex | null>(null);
  const basePath = getBasePath(props.setKey);

  React.useEffect(() => {
    setIndex(null);
    fetchIndex(props.setKey)
      .then(setIndex)
      .catch(() => setIndex(null));
  }, [props.setKey]);

  return (
    <aside className="rounded-lg bg-surface p-4 shadow-md ring-1 ring-black/5 md:w-56">
      <div className="mb-3 text-xs font-black uppercase tracking-wide text-muted">
        <span className="block px-3">{props.setKey ? "Set" : "Project"}</span>
      </div>
      <nav className="space-y-1">
        {entityPaths.map((entityPath) => {
          const type = entityPathToType[entityPath];

          return (
            <NavLink key={entityPath} to={`${basePath}/${entityPath}`} className={sidebarClass}>
              <span>{entityLabels[type].plural}</span>
              <span className="rounded-full bg-pill px-2 py-0.5 text-xs font-black text-header">
                {index?.counts[type] ?? "-"}
              </span>
            </NavLink>
          );
        })}
        <NavLink
          to={`${basePath}/history`}
          className={({ isActive }) =>
            [
              "mt-4 block rounded-lg px-3 py-2 text-sm font-bold",
              isActive
                ? "bg-header-active text-header-text"
                : "text-muted hover:bg-elevated hover:text-text",
            ].join(" ")
          }
        >
          History
        </NavLink>
      </nav>
    </aside>
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

async function getSetSwitchPath(pathname: string, nextSetKey: string) {
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
    const entityKey = decodeRouteSegment(detailMatch[2]);
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
  const selectedSetKey = props.currentSetKey || manifest.setKeys[0] || "";

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
      className="relative inline-flex cursor-pointer items-center gap-2 rounded-lg bg-header-active px-3 py-1.5 text-sm font-semibold text-header-text"
      onClick={(event) => {
        if (event.target instanceof HTMLSelectElement) {
          return;
        }

        openSetPicker();
      }}
    >
      <span className="text-xs font-black uppercase tracking-wide text-pill">Set</span>
      <select
        id={setSelectId}
        ref={setSelectRef}
        value={selectedSetKey}
        onChange={async (event) => {
          navigate(await getSetSwitchPath(location.pathname, event.target.value));
        }}
        className="max-w-44 appearance-none bg-transparent pr-7 font-black text-header-text outline-none"
        aria-label="Switch catalog set"
      >
        {manifest.setKeys.map((setKey) => (
          <option key={setKey} value={setKey}>
            {setKey}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 h-4 w-4 text-pill"
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

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function RepositoryIcon(props: { provider?: string }) {
  if (props.provider === "github") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.72 5.47 7.81.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.6 1.23.85.72 1.25 1.87.9 2.33.69.07-.54.28-.9.51-1.11-1.78-.21-3.64-.92-3.64-4.07 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.19 0 0 .67-.22 2.2.85A7.43 7.43 0 0 1 8 3.94c.68 0 1.36.09 2 .28 1.52-1.07 2.19-.85 2.19-.85.44 1.14.16 1.98.08 2.19.51.58.82 1.32.82 2.22 0 3.16-1.87 3.86-3.65 4.07.29.26.54.76.54 1.54 0 1.11-.01 2.01-.01 2.28 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z" />
      </svg>
    );
  }

  if (props.provider === "gitlab") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="m22.75 9.77-.03-.08-2.17-6.69a.57.57 0 0 0-.55-.39.58.58 0 0 0-.52.35l-1.47 4.48H5.99L4.52 2.96A.58.58 0 0 0 4 2.61a.57.57 0 0 0-.55.39L1.28 9.69l-.03.08a1.54 1.54 0 0 0 .51 1.73l.01.01 10.22 7.43 10.24-7.44.01-.01a1.54 1.54 0 0 0 .51-1.72Z" />
      </svg>
    );
  }

  if (props.provider === "bitbucket") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M2.19 3.25a.77.77 0 0 0-.76.89l2.7 16.42a1.02 1.02 0 0 0 1 .86H18.9a1.02 1.02 0 0 0 1-.82l2.69-16.46a.77.77 0 0 0-.76-.89H2.19Zm13.36 10.71H9.46l-1.1-5.83h8.25l-1.06 5.83Z" />
      </svg>
    );
  }

  return null;
}

function isKnownRepositoryProvider(provider?: string) {
  return provider === "github" || provider === "gitlab" || provider === "bitbucket";
}

export function AppShell(props: { children: React.ReactNode }) {
  const { manifest } = useCatalog();
  const location = useLocation();
  const setKeyMatch = location.pathname.match(/^\/sets\/([^/]+)/);
  const setKey = setKeyMatch ? decodeRouteSegment(setKeyMatch[1]) : undefined;
  const showSidebar = !manifest.sets || Boolean(setKey);

  return (
    <div className="min-h-screen bg-background text-text">
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
                src="/favicon.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 object-contain"
                decoding="async"
              />
              <img
                src="/logo-text.png"
                alt=""
                className="h-auto max-h-4 min-w-0 shrink object-contain object-left pl-2"
                decoding="async"
              />
            </NavLink>
          </div>

          <div className="flex items-center gap-3">
            <SetSwitcher currentSetKey={setKey} />
            {manifest.links?.repository && isKnownRepositoryProvider(manifest.links.provider) && (
              <a
                href={manifest.links.repository}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-3 py-2 text-header-text hover:bg-header-active"
                aria-label={`Open ${manifest.links.provider || "repository"}`}
              >
                <RepositoryIcon provider={manifest.links.provider} />
              </a>
            )}
          </div>
        </nav>
      </header>

      <main className="m-8 mx-auto max-w-5xl">
        <div className={showSidebar ? "items-start gap-6 md:flex" : ""}>
          {showSidebar && <Sidebar setKey={setKey} />}
          <div className={["min-w-0", showSidebar ? "flex-1" : "w-full"].filter(Boolean).join(" ")}>
            <section className="overflow-hidden rounded-lg bg-surface shadow">
              {props.children}
            </section>
            <footer className="mt-4 pt-3 text-center">
              <p className="pb-2 text-xs leading-5 text-faint">
                Generated at {formatGeneratedAt(manifest.generatedAt)}
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

export function Tabs(props: {
  items: { to: string; label: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div>
      <nav className="flex overflow-x-auto border-b border-border">
        {props.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "."}
            className={({ isActive }) =>
              [
                "inline-block min-w-24 shrink-0 border-b-2 px-3 pb-4 pt-2 text-center text-sm font-medium",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:border-border hover:text-text",
              ].join(" ")
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {props.children ? <div className="px-6 py-6">{props.children}</div> : null}
    </div>
  );
}

export function Card(props: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded border border-border bg-surface shadow ${props.className || ""}`}>
      {props.children}
    </section>
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

export function FieldGrid(props: {
  fields: { label: string; value: React.ReactNode; fullWidth?: boolean }[];
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-8 md:grid-cols-2">
      {props.fields.map((field) => (
        <div key={field.label} className={field.fullWidth ? "md:col-span-2" : ""}>
          <dt className="text-sm font-medium text-muted">{field.label}</dt>
          <dd className="mt-1 min-w-0 text-sm [overflow-wrap:anywhere]">{field.value || "n/a"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatList(values?: string[]) {
  if (!values || values.length === 0) {
    return <span className="text-muted">none</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Badge key={value}>{value}</Badge>
      ))}
    </div>
  );
}

export function getEntityTone(
  type: CatalogEntityType,
): "neutral" | "success" | "warning" | "danger" {
  if (type === "feature") return "success";
  if (type === "segment") return "warning";
  if (type === "test") return "danger";
  return "neutral";
}
