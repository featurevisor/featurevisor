import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { decodeRouteSegment, entityLabels, getEntityRoute } from "../entityTypes";
import type { CatalogEntityType, CatalogIndex } from "../types";
import { useCatalogIndex } from "../useCatalogIndex";
import {
  getSearchMatchLabel,
  prepareCatalogSearch,
  searchCatalog,
  type SearchResult,
} from "../searchModel";
import { readRecentEntities } from "../recentEntities";

function findDescription(index: CatalogIndex | undefined, type: CatalogEntityType, key: string) {
  return index?.entities[type]?.find((entity) => entity.key === key)?.description;
}

function useCurrentSetKey() {
  const location = useLocation();
  const match = location.pathname.match(/^\/sets\/([^/]+)/);

  return match ? decodeRouteSegment(match[1]) : undefined;
}

/** Search every entity type from anywhere, opened with ⌘K, Ctrl+K or "/". */
export function GlobalSearch() {
  const setKey = useCurrentSetKey();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  // Focus returns where it was when the dialog closes without opening a result.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  // The document listener is registered once, so it reaches the latest handlers through refs.
  const openRef = React.useRef(openSearch);
  const toggleRef = React.useRef(() => (open ? close() : openSearch()));
  openRef.current = openSearch;
  toggleRef.current = () => (open ? close() : openSearch());

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleRef.current();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        openRef.current();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { index } = useCatalogIndex(setKey, open);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open, setKey]);

  // Tokenizing every summary takes a moment on large projects. Do it while the reader
  // is still reaching for the keyboard, not on the first keystroke.
  React.useEffect(() => {
    if (!open || !index) return;
    const idle =
      window.requestIdleCallback || ((callback: () => void) => window.setTimeout(callback, 1));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(() => prepareCatalogSearch(index));
    return () => cancel(handle);
  }, [open, index]);

  // Remember focus before the input takes it, so closing can hand it back.
  function openSearch() {
    if (open) return;
    const focused = document.activeElement;
    returnFocusRef.current =
      focused instanceof HTMLElement && focused !== document.body ? focused : null;
    setOpen(true);
  }

  function close() {
    setOpen(false);
    returnFocusRef.current?.focus();
  }

  // The input follows every keystroke, and results catch up at a lower priority.
  const searchQuery = React.useDeferredValue(query);
  const searching = searchQuery.trim().length > 0;
  const recent = React.useMemo<SearchResult[]>(
    () =>
      open && !searching
        ? readRecentEntities()
            .filter((item) => (item.set || undefined) === setKey)
            .filter((item) => !index || index.entities[item.type]?.some((e) => e.key === item.key))
            .map((item) => ({
              type: item.type,
              key: item.key,
              description: findDescription(index, item.type, item.key),
              score: 0,
            }))
        : [],
    [open, searching, index, setKey],
  );
  const results = React.useMemo(
    () => (searching ? (index ? searchCatalog(index, searchQuery) : []) : recent),
    [searching, index, searchQuery, recent],
  );

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function choose(result: SearchResult | undefined) {
    if (!result) return;
    setOpen(false);
    navigate(getEntityRoute(result.type, result.key, setKey));
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      close();
    } else if (event.key === "Tab") {
      // The input is the only control in this modal dialog.
      event.preventDefault();
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={openSearch}
      className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      aria-label="Search the catalog"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-white/20 px-1 font-sans text-[10px] sm:inline">
        ⌘K
      </kbd>
    </button>
  );

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search the catalog"
              className="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-black/10"
            >
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search features, variables, segments, tests..."
                className="w-full border-b border-border bg-surface px-4 py-3 text-base text-text outline-none placeholder:text-faint"
                role="combobox"
                aria-label="Search the catalog"
                aria-autocomplete="list"
                aria-expanded={results.length > 0}
                aria-controls="catalog-search-results"
                aria-activedescendant={
                  results[active] ? `catalog-search-option-${active}` : undefined
                }
              />
              <p role="status" className="sr-only">
                {searching
                  ? results.length
                    ? `${results.length} result${results.length === 1 ? "" : "s"}`
                    : "No matches"
                  : results.length
                    ? `${results.length} recently viewed`
                    : ""}
              </p>
              {!searching && results.length > 0 && (
                <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  Recently viewed
                </p>
              )}
              {searching && results.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted">No matches</p>
              )}
              {results.length > 0 && (
                <ul
                  id="catalog-search-results"
                  ref={listRef}
                  role="listbox"
                  aria-label={searching ? "Search results" : "Recently viewed"}
                  className="max-h-[60vh] overflow-y-auto py-1"
                >
                  {results.map((result, resultIndex) => (
                    <li
                      key={`${result.type}:${result.key}`}
                      id={`catalog-search-option-${resultIndex}`}
                      data-index={resultIndex}
                      role="option"
                      aria-selected={resultIndex === active}
                      onMouseEnter={() => setActive(resultIndex)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(result);
                      }}
                      className={[
                        "flex cursor-pointer items-baseline gap-3 px-4 py-2",
                        resultIndex === active ? "bg-elevated" : "",
                      ].join(" ")}
                    >
                      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-faint">
                        {entityLabels[result.type].singular}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-primary">
                          {result.key}
                        </span>
                        {result.match ? (
                          <span className="block truncate text-xs text-muted">
                            <span className="text-faint">
                              {getSearchMatchLabel(result.match.kind)}:
                            </span>{" "}
                            {result.match.value}
                          </span>
                        ) : (
                          result.description && (
                            <span className="block truncate text-xs text-muted">
                              {result.description}
                            </span>
                          )
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-4 border-t border-border bg-elevated px-4 py-2 text-[11px] text-faint">
                <span>↑↓ to move</span>
                <span>Enter to open</span>
                <span>Esc to close</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
