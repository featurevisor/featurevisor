import * as React from "react";

import { useCatalog } from "../context/CatalogContext";
import type { EntityDetail } from "../types";

function CaretIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="h-3 w-3">
      <path
        d="M3.25 4.5 6 7.25 8.75 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const providerNames: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

/** Only a branch read from origin's HEAD is called the default branch. */
function getProposeTitle(
  provider: string | undefined,
  branch: string | undefined,
  kind: "configured" | "default" | "checkout" | undefined,
) {
  const where =
    kind === "default"
      ? `on the default branch, ${branch}`
      : kind === "checkout"
        ? `on ${branch}, the branch checked out when this Catalog was exported`
        : branch
          ? `on ${branch}`
          : "";
  return `Opens the file in ${provider || "your Git host"}'s editor ${where}, where you can propose the change for review`
    .replace(/\s+,/, ",")
    .replace(/\s+/g, " ");
}

/** Source links in the entity header: the Git host in static exports, editors in local serve mode. */
export function EditLink(props: { sourcePath?: string; editLinks?: EntityDetail["editLinks"] }) {
  const { manifest } = useCatalog();
  const [open, setOpen] = React.useState(false);
  // Which item takes focus when the menu opens: the first, or the last after ArrowUp.
  const [initialFocus, setInitialFocus] = React.useState<"first" | "last">("first");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const toggleRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const close = React.useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[initialFocus === "last" ? items.length - 1 : 0]?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close(Boolean(containerRef.current?.contains(document.activeElement)));
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, initialFocus, close]);

  function openMenu(focus: "first" | "last") {
    setInitialFocus(focus);
    setOpen(true);
  }

  // Arrow keys move between items and wrap, Home and End jump, and Tab leaves the menu.
  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(current + 1);
    else if (event.key === "ArrowUp") move(current - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Tab") close(false);
  }

  // Encode each segment, so folders containing "#" or "?" stay part of the path.
  const encodedPath = props.sourcePath?.split("/").map(encodeURIComponent).join("/");
  const fill = (template?: string) =>
    encodedPath && template ? template.replace("{{path}}", encodedPath) : undefined;
  const viewHref = fill(manifest.links?.source);
  const proposeHref = fill(manifest.links?.edit);
  const provider = manifest.links?.provider ? providerNames[manifest.links.provider] : undefined;
  const viewLabel = provider ? `View on ${provider}` : "View source";
  const proposeTitle = getProposeTitle(
    provider,
    manifest.links?.branch,
    manifest.links?.branchKind,
  );
  const editors = (manifest.dev?.editors || []).filter((editor) => props.editLinks?.[editor.id]);

  const splitButtonClass =
    "inline-flex items-center gap-2 border border-border bg-elevated px-3 py-1.5 text-sm font-semibold text-muted shadow-sm hover:bg-background hover:text-text";
  const menuItemClass =
    "flex items-center gap-2 px-3 py-1.5 text-sm font-semibold leading-5 text-muted outline-none hover:bg-elevated hover:text-text focus:bg-elevated focus:text-text";

  // One split button: the first action is the button, the rest sit behind the caret.
  // Local serve mode leads with the editor, static exports with the Git host's view.
  const actions = [
    ...editors.map((editor) => ({
      key: editor.id,
      href: props.editLinks?.[editor.id],
      label: `Open in ${editor.label}`,
      external: false,
      title: undefined as string | undefined,
    })),
    ...(viewHref
      ? [
          {
            key: "view",
            href: viewHref,
            label: viewLabel,
            external: true,
            title: undefined,
          },
        ]
      : []),
    ...(proposeHref
      ? [
          {
            key: "propose",
            href: proposeHref,
            label: "Propose change",
            external: true,
            title: proposeTitle,
          },
        ]
      : []),
  ];
  if (actions.length === 0) return null;
  const [primary, ...menuItems] = actions;
  const externalProps = (external: boolean) =>
    external ? { target: "_blank", rel: "noreferrer" } : {};

  return (
    <div ref={containerRef} className="relative inline-flex">
      <a
        href={primary.href}
        title={primary.title}
        {...externalProps(primary.external)}
        className={`${splitButtonClass} ${menuItems.length ? "rounded-l" : "rounded"}`}
      >
        {primary.label}
      </a>
      {menuItems.length > 0 && (
        <button
          ref={toggleRef}
          type="button"
          className={`${splitButtonClass} -ml-px rounded-r px-2`}
          aria-label="More ways to open this file"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? "source-links-menu" : undefined}
          onClick={() => (open ? close(false) : openMenu("first"))}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openMenu(event.key === "ArrowUp" ? "last" : "first");
            }
          }}
        >
          <CaretIcon />
        </button>
      )}
      {open && (
        <div
          ref={menuRef}
          id="source-links-menu"
          role="menu"
          aria-label="More ways to open this file"
          onKeyDown={onMenuKeyDown}
          // Spans exactly the button and caret, so the menu reads as part of the control.
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded border border-border bg-surface py-1 shadow-lg"
        >
          {menuItems.map((item) => (
            <a
              key={item.key}
              role="menuitem"
              tabIndex={-1}
              href={item.href}
              title={item.title}
              {...externalProps(item.external)}
              className={menuItemClass}
              onClick={() => close(false)}
            >
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
