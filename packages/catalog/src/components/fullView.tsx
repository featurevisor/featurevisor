import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * A full view: something on a page shown over it, filling the window less a margin. The dependency
 * map opens one with `?map=full`, the Query page with `?view=full`.
 */
export const FULL_VIEW_VALUE = "full";

/**
 * Whether the full view `?<param>=full` is open, and how to open and close it. It lives in the
 * URL, so a link to it opens it for whoever follows the link.
 */
export function useFullView(param: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const expanded = searchParams.get(param) === FULL_VIEW_VALUE;
  const openedHere =
    (location.state as { openedFullView?: string } | null)?.openedFullView === param;

  // Opening adds a history entry, so Back closes it, as it would any page
  const open = React.useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set(param, FULL_VIEW_VALUE);
    setSearchParams(next, { state: { openedFullView: param } });
  }, [param, searchParams, setSearchParams]);

  // Closing returns to the entry it was opened from. Arriving through a link, or once the entry
  // was replaced since, there is none to return to, so it takes the full view out of the URL.
  const close = React.useCallback(() => {
    if (openedHere) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(param);
    setSearchParams(next, { replace: true });
  }, [openedHere, navigate, param, searchParams, setSearchParams]);

  return { expanded, open, close };
}

/** Focus goes back to what opened the full view once it closes, however that happened */
export function useFocusOnClose(expanded: boolean, onClosed: () => void): void {
  const wasExpanded = React.useRef(expanded);
  const latest = React.useRef(onClosed);
  latest.current = onClosed;
  React.useEffect(() => {
    if (wasExpanded.current && !expanded) latest.current();
    wasExpanded.current = expanded;
  }, [expanded]);
}

/**
 * The full view's frame: a panel over the page with a title bar and a close button. Escape, the
 * close button or a press outside the panel closes it, the page stays still behind it, and Tab
 * stays inside it.
 */
export function FullViewDialog(props: {
  label: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Quiet help beside the close button, such as how to move around */
  hint?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { onClose } = props;
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  // The latest close, so the effect below runs once for each time the view opens
  const closeLatest = React.useRef(onClose);
  closeLatest.current = onClose;

  React.useEffect(() => {
    closeRef.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeLatest.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button, textarea, input, select",
      ) || []),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  // Server rendering, as tests do, has no document to show it over
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-background/80 p-3 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => {
        // A press on the backdrop, outside the panel, closes it
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        onKeyDown={keepFocusInside}
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text">{props.title}</h2>
            {props.subtitle && <p className="truncate text-xs text-muted">{props.subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {props.hint && (
              <span className="hidden text-[11px] text-faint sm:inline">{props.hint}</span>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close the full view"
              title="Close (Esc)"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path
        d="M9.75 2.25h4v4M6.25 13.75h-4v-4M13.75 2.25L9.5 6.5M2.25 13.75L6.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
