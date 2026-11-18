import * as React from "react";
import { useLocation } from "react-router-dom";

import { parseEntityPathname } from "../entityTypes";

class Boundary extends React.Component<
  { pathname: string; children: React.ReactNode },
  { error: Error | null; pathname: string }
> {
  state = { error: null as Error | null, pathname: this.props.pathname };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  // Navigating elsewhere clears the error, also between pages that stay mounted
  static getDerivedStateFromProps(props: { pathname: string }, state: { pathname: string }) {
    return props.pathname === state.pathname ? null : { error: null, pathname: props.pathname };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="px-6 py-12 text-center">
        <p className="text-sm font-semibold text-text">This page could not be loaded</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          The Catalog may have been updated since this tab was opened. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md border border-border bg-elevated px-3 py-1.5 text-sm font-medium text-text hover:bg-background"
        >
          Reload
        </button>
      </div>
    );
  }
}

/**
 * Which page a pathname shows. Each page starts afresh, except that every entity's page on one
 * tab counts as one, so what sits beside the entity's own view, such as the dependency map's
 * full view, stays open while the reader moves from entity to entity. The entity's view starts
 * afresh for each entity itself.
 */
export function getPageKey(pathname: string) {
  const entity = parseEntityPathname(pathname);
  return entity ? ["", ...entity.set, ":entity", ...entity.tab].join("/") : pathname;
}

/**
 * Catches failures while rendering a page, such as a page chunk that no longer exists
 * after the Catalog was re-published. Navigating elsewhere clears the error.
 */
export function PageErrorBoundary(props: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <Boundary key={getPageKey(location.pathname)} pathname={location.pathname}>
      {props.children}
    </Boundary>
  );
}
