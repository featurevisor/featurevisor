import * as React from "react";
import { useNavigate } from "react-router-dom";

import { getBasePath } from "../entityTypes";

/** Second key after "g", and the section it opens. */
const GO_TO: Array<{ key: string; path: string; label: string }> = [
  { key: "o", path: "", label: "Overview" },
  { key: "f", path: "features", label: "Features" },
  { key: "v", path: "variables", label: "Variables" },
  { key: "a", path: "attributes", label: "Attributes" },
  { key: "s", path: "segments", label: "Segments" },
  { key: "t", path: "targets", label: "Targets" },
  { key: "c", path: "schemas", label: "Schemas" },
  { key: "e", path: "tests", label: "Tests" },
  { key: "h", path: "history", label: "History" },
];

const SEQUENCE_TIMEOUT = 1200;

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;

  return Boolean(
    element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable),
  );
}

function Key(props: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-elevated px-1 font-mono text-[11px] text-text">
      {props.children}
    </kbd>
  );
}

/** "g" then a letter jumps to a section; "?" lists every shortcut. */
export function KeyboardShortcuts(props: { setKey?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const pendingSince = React.useRef(0);
  const basePath = getBasePath(props.setKey);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;

      if (event.key === "Escape") {
        setOpen(false);
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      const pending = Date.now() - pendingSince.current < SEQUENCE_TIMEOUT;

      if (pending) {
        pendingSince.current = 0;
        const target = GO_TO.find((item) => item.key === event.key.toLowerCase());

        if (target) {
          event.preventDefault();
          setOpen(false);
          navigate(target.path ? `${basePath}/${target.path}` : basePath || "/");
        }
        return;
      }

      if (event.key.toLowerCase() === "g") pendingSince.current = Date.now();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [basePath, navigate]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-1.5 text-xs text-muted hover:text-text"
            autoFocus
          >
            Esc
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="flex gap-1">
            <Key>⌘</Key>
            <Key>K</Key>
          </dt>
          <dd className="text-muted">Search everything (or /)</dd>
          {GO_TO.map((item) => (
            <React.Fragment key={item.key}>
              <dt className="flex gap-1">
                <Key>g</Key>
                <Key>{item.key}</Key>
              </dt>
              <dd className="text-muted">Go to {item.label}</dd>
            </React.Fragment>
          ))}
          <dt className="flex gap-1">
            <Key>←</Key>
            <Key>→</Key>
          </dt>
          <dd className="text-muted">Move between focused tabs</dd>
          <dt>
            <Key>?</Key>
          </dt>
          <dd className="text-muted">Show this list</dd>
        </dl>
      </div>
    </div>
  );
}
