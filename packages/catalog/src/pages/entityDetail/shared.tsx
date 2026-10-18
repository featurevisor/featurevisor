import * as React from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";

import { decodeRouteSegment } from "../../entityTypes";
import type { EntityDetail } from "../../types";

export function slugifyFragment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function RulePermalink(props: { targetId: string; label?: string }) {
  const location = useLocation();
  return (
    <Link
      to={{ pathname: location.pathname, search: location.search, hash: `#${props.targetId}` }}
      aria-label={props.label || "Link to this rule"}
      className="inline-flex rounded p-1 text-muted opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20" />
      </svg>
    </Link>
  );
}

export function useScrollToHash(dependencies: React.DependencyList) {
  const { hash } = useLocation();
  React.useEffect(() => {
    if (typeof window === "undefined" || !hash) {
      return;
    }

    const targetId = decodeRouteSegment(hash.slice(1));

    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const targetElement = document.getElementById(targetId);

      if (!targetElement) {
        return;
      }

      targetElement.scrollIntoView({ block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [hash, ...dependencies]);
}

export function useEntityDetail() {
  return useOutletContext<{ detail: EntityDetail; setKey?: string }>();
}

function formatScalar(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

export function FormattedValue(props: { value: unknown }) {
  const value = props.value;

  if (value === undefined || value === null || value === "") {
    return <span className="text-muted">n/a</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted">empty</span>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, index) => (
          <span key={index} className="rounded border border-border bg-elevated px-2 py-1 text-xs">
            <FormattedValue value={item} />
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return <span className="text-muted">empty</span>;
    }

    return (
      <dl className="space-y-2">
        {entries.map(([key, item]) => (
          <div
            key={key}
            className="grid gap-1 rounded border border-border bg-elevated p-2 sm:grid-cols-3"
          >
            <dt className="font-mono text-xs font-semibold text-muted">{key}</dt>
            <dd className="min-w-0 sm:col-span-2">
              <FormattedValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{formatScalar(value)}</span>;
}

export function getEnvironmentMap(value: unknown): Array<[string | undefined, unknown]> {
  if (Array.isArray(value)) return [[undefined, value]];
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

export function asStringArray(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    return [value];
  }

  return undefined;
}

export function isEveryoneSelector(conditions: unknown) {
  return conditions === "*";
}

/** Entries in a list, or across every environment's list when the value is keyed by environment. */
export function countItems(value: unknown) {
  return getEnvironmentMap(value).reduce(
    (total, [, items]) => total + (Array.isArray(items) ? items.length : 0),
    0,
  );
}
