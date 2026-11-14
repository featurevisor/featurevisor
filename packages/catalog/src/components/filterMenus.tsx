import * as React from "react";

/** A filter a list offers, backed by one search qualifier token. */
export interface FilterChip {
  label: string;
  token: string;
  /** The kind of filter. Each kind gets a menu, and small kinds share one. */
  group: string;
  /** A heading inside the group's menu, where one group holds two kinds, as deadlines do */
  section?: string;
}

/** One menu in the filter row, and the headed sections it lists */
export interface FilterFacet {
  name: string;
  chips: FilterChip[];
  sections: Array<{ heading?: string; chips: FilterChip[] }>;
}

/** Groups too small for a menu of their own share Properties, so a list shows a few menus at most */
const SHARED_FACETS: Record<string, string> = {
  Format: "Type",
  Contains: "Properties",
  Status: "Properties",
  Usage: "Properties",
  Dependencies: "Properties",
};

/** The menus a list's filters make, in the order their first filter appears. */
export function getFilterFacets(chips: FilterChip[]): FilterFacet[] {
  const facets = new Map<string, { groups: Set<string>; sections: Map<string, FilterChip[]> }>();
  for (const chip of chips) {
    const name = SHARED_FACETS[chip.group] || chip.group;
    let facet = facets.get(name);
    if (!facet) facets.set(name, (facet = { groups: new Set(), sections: new Map() }));
    facet.groups.add(chip.group);
    const heading = chip.section || chip.group;
    const section = facet.sections.get(heading);
    if (section) section.push(chip);
    else facet.sections.set(heading, [chip]);
  }
  return [...facets].map(([name, facet]) => {
    const sections = [...facet.sections];
    return {
      // A shared menu holding one group is named after it, such as Usage on schemas
      name: facet.groups.size === 1 ? [...facet.groups][0] : name,
      chips: sections.flatMap(([, sectionChips]) => sectionChips),
      // Headings only help where a menu holds more than one kind of filter
      sections: sections.map(([heading, sectionChips]) => ({
        heading: sections.length > 1 ? heading : undefined,
        chips: sectionChips,
      })),
    };
  });
}

function getQueryTokens(query: string) {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** Adds the token to the query, or takes it out when the query has it, in any case. */
export function toggleToken(query: string, token: string) {
  const tokens = getQueryTokens(query);
  const existingIndex = tokens.findIndex((item) => item.toLowerCase() === token.toLowerCase());

  return existingIndex >= 0
    ? tokens.filter((_, index) => index !== existingIndex).join(" ")
    : [...tokens, token].join(" ");
}

/** The query without any of these tokens, keeping everything else typed. */
export function removeTokens(query: string, tokens: string[]) {
  const removed = new Set(tokens.map((token) => token.toLowerCase()));
  return getQueryTokens(query)
    .filter((token) => !removed.has(token.toLowerCase()))
    .join(" ");
}

/** Options past this many get a search field in their menu, as tags and owners can */
const SEARCHABLE_OPTIONS = 8;

/**
 * The filter row under a list's search: a dashed button per menu, each listing its filters with
 * checkboxes and how many definitions each would find, and Reset once any is on.
 */
export function FilterMenus(props: {
  query: string;
  chips: FilterChip[];
  className?: string;
  onChange: (query: string) => void;
  /** How many definitions a query finds. Worked out only while a menu is open. */
  countMatches?: (query: string) => number;
}) {
  const facets = React.useMemo(() => getFilterFacets(props.chips), [props.chips]);
  const [openFacet, setOpenFacet] = React.useState<string | null>(null);
  const tokens = React.useMemo(
    () => new Set(getQueryTokens(props.query.toLowerCase())),
    [props.query],
  );

  if (facets.length === 0) {
    return null;
  }

  const anyActive = props.chips.some((chip) => tokens.has(chip.token.toLowerCase()));

  return (
    <div
      role="group"
      aria-label="Filters"
      className={`flex flex-wrap items-center gap-2 ${props.className || ""}`}
    >
      {facets.map((facet) => (
        <FilterMenu
          key={facet.name}
          facet={facet}
          query={props.query}
          tokens={tokens}
          open={openFacet === facet.name}
          onOpenChange={(open) => setOpenFacet(open ? facet.name : null)}
          onChange={props.onChange}
          countMatches={props.countMatches}
        />
      ))}
      {anyActive && (
        <button
          type="button"
          onClick={() =>
            props.onChange(
              removeTokens(
                props.query,
                props.chips.map((chip) => chip.token),
              ),
            )
          }
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-xs font-medium text-muted outline-none transition-colors hover:bg-slate-100 hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
        >
          Reset
          <CrossIcon />
        </button>
      )}
    </div>
  );
}

function FilterMenu(props: {
  facet: FilterFacet;
  query: string;
  tokens: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (query: string) => void;
  countMatches?: (query: string) => number;
}) {
  const { facet, open, onOpenChange } = props;
  const id = React.useId();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = React.useState("");
  const [alignEnd, setAlignEnd] = React.useState(false);
  const searchable = facet.chips.length > SEARCHABLE_OPTIONS;
  const isOn = (chip: FilterChip) => props.tokens.has(chip.token.toLowerCase());
  const selected = facet.chips.filter(isOn);

  const close = React.useCallback(
    (restoreFocus: boolean) => {
      onOpenChange(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // Opens below its button, and against the right edge when the left would run off screen
  React.useLayoutEffect(() => {
    if (!open) {
      setSearch("");
      setAlignEnd(false);
      return;
    }
    const panel = panelRef.current;
    if (panel && panel.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      setAlignEnd(true);
    }
    panel?.querySelector<HTMLElement>("input, [role=checkbox]")?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close(false);
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
  }, [open, close]);

  const { countMatches, query, tokens } = props;
  // What each filter would find beside the rest of the search, counted only while open
  const counts = React.useMemo(() => {
    if (!open || !countMatches) return undefined;
    return new Map(
      facet.chips.map((chip) => [
        chip.token,
        countMatches(tokens.has(chip.token.toLowerCase()) ? query : `${query} ${chip.token}`),
      ]),
    );
  }, [open, countMatches, query, tokens, facet]);

  const needle = search.trim().toLowerCase();
  const sections = facet.sections
    .map((section) => ({
      ...section,
      chips: needle
        ? section.chips.filter((chip) => chip.label.toLowerCase().includes(needle))
        : section.chips,
    }))
    .filter((section) => section.chips.length > 0);

  // Arrow keys move between the search field and the options, Home and End jump
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("input, [role=checkbox]") || []),
    ];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(current + 1);
    else if (event.key === "ArrowUp") move(current - 1);
    else if (event.key === "Home" && current > 0) move(0);
    else if (event.key === "End" && current > 0) move(items.length - 1);
  }

  return (
    <div
      ref={containerRef}
      className="relative max-w-full"
      // Tabbing out of the menu closes it, as clicking elsewhere does. Focus can also leave for
      // nothing, as Safari does when a click lands on a button, so only a focused outside counts.
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !containerRef.current?.contains(next)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
        className={[
          "inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary",
          selected.length > 0
            ? "border-slate-400 text-text"
            : "border-dashed border-slate-300 text-slate-700",
          open ? "border-slate-400 bg-slate-50" : "bg-surface",
        ].join(" ")}
      >
        <PlusCircleIcon />
        <span className="shrink-0">{facet.name}</span>
        {selected.length > 0 && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-slate-300" />
            {selected.length > 2 ? (
              <SelectedBadge>{selected.length} selected</SelectedBadge>
            ) : (
              selected.map((chip) => <SelectedBadge key={chip.token}>{chip.label}</SelectedBadge>)
            )}
          </>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={`${facet.name} filters`}
          onKeyDown={onPanelKeyDown}
          className={`absolute top-full z-30 mt-1.5 w-max min-w-56 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg ${alignEnd ? "right-0" : "left-0"}`}
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border px-3 text-faint">
              <SearchIcon />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // Enter takes the first option the search leaves
                  const first = sections[0]?.chips[0];
                  if (event.key === "Enter" && first) {
                    event.preventDefault();
                    props.onChange(toggleToken(props.query, first.token));
                  }
                }}
                placeholder={facet.name}
                aria-label={`Search ${facet.name.toLowerCase()}`}
                className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-faint"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {sections.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted">No results found.</p>
            )}
            {sections.map((section) => (
              <div key={section.heading || "options"} role="group" aria-label={section.heading}>
                {section.heading && (
                  <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {section.heading}
                  </div>
                )}
                {section.chips.map((chip) => {
                  const checked = isOn(chip);
                  const count = counts?.get(chip.token);
                  return (
                    <button
                      key={chip.token}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      data-option={chip.token}
                      onClick={() => props.onChange(toggleToken(props.query, chip.token))}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text outline-none hover:bg-slate-100 focus:bg-slate-100"
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                          checked
                            ? "border-header-active bg-header-active text-header-text"
                            : "border-slate-400",
                        ].join(" ")}
                      >
                        {checked && <CheckIcon />}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${count === 0 && !checked ? "text-faint" : ""}`}
                      >
                        {chip.label}
                      </span>
                      {count !== undefined && (
                        <span className="pl-3 font-mono text-xs tabular-nums text-faint">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() =>
                  props.onChange(
                    removeTokens(
                      props.query,
                      facet.chips.map((chip) => chip.token),
                    ),
                  )
                }
                className="w-full cursor-pointer rounded-md px-2 py-1.5 text-center text-sm text-muted outline-none hover:bg-slate-100 hover:text-text focus:bg-slate-100 focus:text-text"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectedBadge(props: { children: React.ReactNode }) {
  return (
    <span className="max-w-[9rem] truncate rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-800">
      {props.children}
    </span>
  );
}

function PlusCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="h-3.5 w-3.5 shrink-0 text-faint"
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 5.25v5.5M5.25 8h5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.25 10.25L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
