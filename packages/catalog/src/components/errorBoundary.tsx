import * as React from "react";
import { useLocation } from "react-router-dom";

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
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
 * Catches failures while rendering a page, such as a page chunk that no longer exists
 * after the Catalog was re-published. Navigating elsewhere clears the error.
 */
export function PageErrorBoundary(props: { children: React.ReactNode }) {
  const location = useLocation();

  return <Boundary key={location.pathname}>{props.children}</Boundary>;
}
