import * as React from "react";
import ReactMarkdown from "react-markdown";
import { Link, NavLink } from "react-router-dom";

import type { CatalogEntityType } from "../types";
import { entityLabels, entityPaths, entityPathToType, getBasePath } from "../entityTypes";
import { useCatalog } from "../context/CatalogContext";

export function Badge(props: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    props.tone === "success"
      ? "bg-success-surface text-success"
      : props.tone === "warning"
        ? "bg-warning-surface text-warning"
        : props.tone === "danger"
          ? "bg-danger-surface text-danger"
          : "bg-pill text-text";

  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {props.children}
    </span>
  );
}

export function CodeBlock(props: { value: unknown }) {
  const value =
    typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2);

  return (
    <pre className="overflow-x-auto rounded border border-border bg-elevated p-4 text-sm">
      <code>{value}</code>
    </pre>
  );
}

export function MarkdownContent(props: { value?: string }) {
  if (!props.value) {
    return <span className="text-muted">n/a</span>;
  }

  return (
    <ReactMarkdown className="prose prose-slate max-w-none text-sm">{props.value}</ReactMarkdown>
  );
}

export function EmptyState(props: { title: string; description?: string }) {
  return (
    <div className="rounded border border-border bg-surface p-8 text-center shadow-soft">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.description && <p className="mt-2 text-sm text-muted">{props.description}</p>}
    </div>
  );
}

export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{props.title}</h1>
        {props.description && <p className="mt-1 text-sm text-muted">{props.description}</p>}
      </div>
      {props.actions}
    </div>
  );
}

export function AppShell(props: { children: React.ReactNode }) {
  const { manifest } = useCatalog();
  const firstSet = manifest.setKeys[0];
  const basePath = manifest.sets && firstSet ? getBasePath(firstSet) : "";

  return (
    <div className="min-h-screen bg-background text-text">
      <header className="bg-header text-header-text">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logo-text.png" alt="Featurevisor" className="h-8 w-auto" />
            <span className="rounded bg-header-active px-2 py-1 text-xs">Catalog</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {manifest.sets &&
              manifest.setKeys.map((setKey) => (
                <NavLink
                  key={setKey}
                  to={`${getBasePath(setKey)}/features`}
                  className={({ isActive }) =>
                    `rounded px-3 py-2 ${isActive ? "bg-header-active" : "hover:bg-header-active"}`
                  }
                >
                  {setKey}
                </NavLink>
              ))}
            {!manifest.sets &&
              entityPaths.slice(0, 4).map((path) => (
                <NavLink
                  key={path}
                  to={`/${path}`}
                  className={({ isActive }) =>
                    `rounded px-3 py-2 ${isActive ? "bg-header-active" : "hover:bg-header-active"}`
                  }
                >
                  {entityLabels[entityPathToType[path]].plural}
                </NavLink>
              ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[220px_1fr] gap-6 px-6 py-6">
        <aside className="space-y-2">
          {entityPaths.map((path) => (
            <NavLink
              key={path}
              to={`${basePath}/${path}`}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${isActive ? "bg-surface font-semibold shadow" : "text-muted hover:bg-surface"}`
              }
            >
              {entityLabels[entityPathToType[path]].plural}
            </NavLink>
          ))}
          <NavLink
            to={`${basePath}/history`}
            className={({ isActive }) =>
              `block rounded px-3 py-2 text-sm ${isActive ? "bg-surface font-semibold shadow" : "text-muted hover:bg-surface"}`
            }
          >
            History
          </NavLink>
        </aside>
        <main>{props.children}</main>
      </div>
    </div>
  );
}

export function Tabs(props: { items: { to: string; label: string }[] }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2">
      {props.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "."}
          className={({ isActive }) =>
            `rounded px-3 py-2 text-sm font-medium ${isActive ? "bg-primary text-white" : "bg-surface text-muted hover:text-text"}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function FieldGrid(props: { fields: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {props.fields.map((field) => (
        <div key={field.label} className="rounded border border-border bg-surface p-4 shadow">
          <dt className="text-xs font-semibold uppercase text-muted">{field.label}</dt>
          <dd className="mt-2 text-sm">{field.value}</dd>
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
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value}>{value}</Badge>
      ))}
    </div>
  );
}

export function getEntityTone(
  type: CatalogEntityType,
): "default" | "success" | "warning" | "danger" {
  if (type === "feature") return "success";
  if (type === "segment") return "warning";
  if (type === "test") return "danger";
  return "default";
}
