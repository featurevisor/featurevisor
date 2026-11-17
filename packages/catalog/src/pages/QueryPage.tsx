import * as React from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { DatafileContent } from "@featurevisor/types";

import { fetchDatafile, fetchEntityDetail } from "../api";
import { useCatalog } from "../context/CatalogContext";
import { decodeRouteSegment, getEntityRoute } from "../entityTypes";
import { colourExpression } from "../components/expressionTokens";
import {
  ExpandIcon,
  FullViewDialog,
  isMac,
  useFocusOnClose,
  useFullView,
} from "../components/fullView";
import { TOKEN_CLASSES } from "../components/trees";
import { Badge, EmptyState, EntityKey, PageHeader } from "../components/ui";
import { getDeadlineClock } from "../metadata";
import { useCatalogIndex } from "../useCatalogIndex";
import { useDocumentTitle } from "../useDocumentTitle";
import type { CatalogIndex } from "../types";
import type { Cell, Why } from "../query/engine";
import {
  completeFql,
  type CompletionItem,
  type CompletionKind,
  type CompletionSource,
} from "../query/complete";
import { FIRST_QUERY, examplesFor, type ExampleGroup, type ExampleSource } from "../query/examples";
import {
  CALLS,
  clauseStarts,
  lexFql,
  parseFql,
  type FqlError,
  type FqlProject,
} from "../query/fql";
import { queryHash, queryOf, searchWithoutQuery } from "../query/link";
import { evaluates, type Report } from "../query/report";
import {
  EVALUATION_LIMIT,
  datafileEnvironments,
  runReport,
  type Result,
  type ResultColumn,
  type ResultRow,
  type ResultValue,
} from "../query/run";

/** `?view=full` opens the full view */
const FULL_VIEW_PARAM = "view";

/** Scenarios CONTEXT offers as people, at most this many, read once the index loads */
const SCENARIO_PEOPLE = 40;

type ScenarioPerson = NonNullable<CompletionSource["scenarios"]>[number];

/** Test scenarios' people: each scenario's context, and its place in the rollout */
function useScenarioPeople(index: CatalogIndex | undefined, setKey: string | undefined) {
  const [people, setPeople] = React.useState<ScenarioPerson[]>([]);
  React.useEffect(() => {
    const keys = (index?.entities.test || [])
      .filter((entity) => entity.testKind === "scenario")
      .slice(0, SCENARIO_PEOPLE)
      .map((entity) => entity.key);
    if (!keys.length) return;
    let current = true;
    Promise.all(
      keys.map((key) =>
        fetchEntityDetail("test", key, setKey)
          .then((detail): ScenarioPerson | undefined => {
            const test = detail.entity as {
              assertions?: Array<{
                context?: Record<string, unknown>;
                at?: number;
                description?: string;
              }>;
            };
            const first = test.assertions?.find((assertion) => assertion.context);
            if (!first?.context) return undefined;
            return {
              key,
              description: first.description,
              context: first.context,
              at: typeof first.at === "number" ? first.at : undefined,
            };
          })
          .catch(() => undefined),
      ),
    ).then((found) => {
      if (current) setPeople(found.filter((item): item is ScenarioPerson => Boolean(item)));
    });
    return () => {
      current = false;
    };
  }, [index, setKey]);
  return people;
}

export function QueryPage() {
  const { setKey: encodedSetKey } = useParams();
  const setKey = encodedSetKey && decodeRouteSegment(encodedSetKey);
  const { manifest } = useCatalog();
  const { index, error } = useCatalogIndex(setKey);
  const location = useLocation();
  const navigate = useNavigate();
  const environments = React.useMemo(
    () => manifest.projectConfig.environments || [],
    [manifest.projectConfig.environments],
  );
  // The query lives after `#`, so a long one is never cut off on its way to a server
  const written = queryOf(location) ?? FIRST_QUERY;
  const [draft, setDraft] = React.useState(written);
  const [ran, setRan] = React.useState(written);
  useDocumentTitle("Query", setKey);

  // A link or Back changes the URL, which the editor then shows. The URL also echoes what the
  // editor ran, a moment later, and copying that back could replace what was typed since and
  // move the caret to the end, so the page skips the query it wrote itself.
  const echo = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (written === echo.current) return;
    setDraft(written);
    setRan(written);
  }, [written]);

  const where = React.useRef(location);
  where.current = location;
  const run = React.useCallback(
    (query: string) => {
      setRan(query);
      echo.current = query;
      // Keeps the rest of the URL, such as the full view, and moves an older link's `?q=`
      const { pathname, search } = where.current;
      navigate(
        { pathname, search: searchWithoutQuery(search), hash: queryHash(query) },
        { replace: true },
      );
    },
    [navigate],
  );

  // An older link's `?q=` moves after `#` as the page opens
  React.useEffect(() => {
    if (new URLSearchParams(location.search).has("q")) run(written);
  }, [location.search, run, written]);

  // `?view=full` shows the editor and results over the page, with room for wide reports
  const { expanded, open, close } = useFullView(FULL_VIEW_PARAM);
  const expandRef = React.useRef<HTMLButtonElement | null>(null);
  useFocusOnClose(expanded, () => expandRef.current?.focus());
  // Runs as you type, once you pause
  React.useEffect(() => {
    if (draft === ran) return;
    const timer = setTimeout(() => run(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, ran, run]);

  // Names the query may read, checked once the index loads
  const project = React.useMemo<FqlProject>(
    () =>
      index
        ? {
            environments,
            features: Object.fromEntries(
              (index.entities.feature || []).map((entity) => [
                entity.key,
                entity.variableKeys || [],
              ]),
            ),
            variables: (index.entities.variable || []).map((entity) => entity.key),
            attributes: (index.entities.attribute || []).map((entity) => entity.key),
          }
        : { environments },
    [index, environments],
  );
  const parsed = React.useMemo(() => parseFql(ran, project), [ran, project]);
  const scenarios = useScenarioPeople(index, setKey);
  // Names the editor completes
  const completions = React.useMemo<CompletionSource>(() => {
    const entities = index?.entities;
    const features = entities?.feature || [];
    const variables = entities?.variable || [];
    const segments = entities?.segment || [];
    const definitions = [...features, ...variables, ...segments, ...(entities?.attribute || [])];
    return {
      environments,
      features: features.map((entity) => ({
        key: entity.key,
        description: entity.description,
        variables: entity.variableKeys || [],
      })),
      variables: variables.map((entity) => ({ key: entity.key, description: entity.description })),
      segments: segments.map((entity) => entity.key),
      attributes: (entities?.attribute || []).map((entity) => ({
        key: entity.key,
        description: entity.description,
      })),
      tags: [...new Set(definitions.flatMap((entity) => entity.tags || []))].sort(),
      owners: [...new Set(definitions.flatMap((entity) => entity.owners || []))].sort(),
      scenarios,
    };
  }, [index, environments, scenarios]);
  // Examples name this project's own features, teams and attributes
  const exampleGroups = React.useMemo(() => {
    const entities = index?.entities;
    const features = entities?.feature || [];
    const definitions = [...features, ...(entities?.variable || []), ...(entities?.segment || [])];
    const owned = new Map<string, number>();
    for (const owner of definitions.flatMap((entity) => entity.owners || []))
      owned.set(owner, (owned.get(owner) || 0) + 1);
    const references = (refs: string[] | undefined, type: string) =>
      (refs || [])
        .filter((ref) => ref.startsWith(`${type}:`))
        .map((ref) => ref.slice(type.length + 1));
    const source: ExampleSource = {
      features: features.map((entity) => ({
        key: entity.key,
        variations: entity.variationValues || [],
        variables: entity.variableKeys || [],
        segments: references(entity.references, "segment"),
        requires: references(entity.references, "feature"),
      })),
      variables: (entities?.variable || []).map((entity) => entity.key),
      attributes: (entities?.attribute || [])
        .slice()
        .sort((a, b) => (b.usedByCount || 0) - (a.usedByCount || 0) || a.key.localeCompare(b.key))
        .map((entity) => entity.key),
      owners: [...owned]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([owner]) => owner),
      // What features bucket by alone, such as userId. Part of a combined bucketBy, an
      // attribute such as country still names audiences.
      bucketBy: [
        ...new Set(
          features.flatMap((entity) =>
            entity.bucketBy && !/ (?:and|or) /.test(entity.bucketBy) ? [entity.bucketBy] : [],
          ),
        ),
      ],
    };
    return examplesFor(source);
  }, [index]);
  const [lastGood, setLastGood] = React.useState<Report | undefined>(parsed.report);
  React.useEffect(() => {
    if (parsed.report) setLastGood(parsed.report);
  }, [parsed.report]);

  if (error) return <EmptyState title="Unable to load catalog index" description={error} />;
  if (!index) return null;
  const report = parsed.report || lastGood;
  // Shown in one place at a time, so a report evaluates once
  const workspace = (
    <>
      <FqlEditor
        value={draft}
        onChange={setDraft}
        onRun={() => run(draft)}
        completions={completions}
      />
      <Errors errors={parsed.errors} />
      {report && <Results report={report} index={index} setKey={setKey} />}
    </>
  );
  // An example replaces what is typed, and runs at once
  const choose = (query: string) => {
    setDraft(query);
    run(query);
  };
  const examples = <ExamplesMenu groups={exampleGroups} onChoose={choose} />;

  return (
    <div className="pb-8">
      <PageHeader
        title="Query"
        description="Ask the project a question in FQL: what is defined, who owns it, and what people get."
      />
      <div className="space-y-4 px-6">
        <div className="flex items-center justify-between gap-3">
          {examples}
          <button
            ref={expandRef}
            type="button"
            onClick={open}
            aria-label="Open the query in a full view"
            title="Full view"
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary [&>svg]:h-3 [&>svg]:w-3"
          >
            <ExpandIcon />
          </button>
        </div>
        {!expanded && workspace}
      </div>
      {expanded && (
        <FullViewDialog
          label="Query in a full view"
          title="Query"
          hint={`${isMac() ? "⌘" : "Ctrl"} Enter runs, Ctrl Space suggests`}
          onClose={close}
        >
          <div className="h-full space-y-4 overflow-auto p-4">
            {examples}
            {workspace}
          </div>
        </FullViewDialog>
      )}
    </div>
  );
}

/** Questions ready to run, by what they are about */
/** How tall the Examples menu grows, and how far it keeps from the window's edges */
const MENU_HEIGHT = 448;
const MENU_WIDTH = 352;
const MENU_MARGIN = 12;

/**
 * Where the Examples menu sits: below its button, or above it when there is more room there,
 * as tall as the room allows. It is placed over the page, since the page's card clips what
 * leaves it, and a short report would cut the menu off.
 */
function menuPlace(button: HTMLElement) {
  const rect = button.getBoundingClientRect();
  const gap = 6;
  const below = window.innerHeight - rect.bottom - gap - MENU_MARGIN;
  const above = rect.top - gap - MENU_MARGIN;
  const width = Math.min(MENU_WIDTH, document.documentElement.clientWidth - 2 * MENU_MARGIN);
  const left = Math.max(
    MENU_MARGIN,
    Math.min(rect.left, document.documentElement.clientWidth - width - MENU_MARGIN),
  );
  const downward = below >= Math.min(MENU_HEIGHT, 240) || below >= above;
  return downward
    ? { left, width, top: rect.bottom + gap, maxHeight: Math.min(MENU_HEIGHT, below) }
    : {
        left,
        width,
        bottom: window.innerHeight - rect.top + gap,
        maxHeight: Math.min(MENU_HEIGHT, above),
      };
}

function ExamplesMenu(props: { groups: ExampleGroup[]; onChoose: (query: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState<React.CSSProperties>();

  React.useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const follow = () => buttonRef.current && setPlace(menuPlace(buttonRef.current));
    follow();
    // It follows its button as the page or the full view scrolls, and as the window resizes
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      const inside = (target: EventTarget | null) =>
        buttonRef.current?.contains(target as Node) || menuRef.current?.contains(target as Node);
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !inside(event.target)) {
        if (event instanceof KeyboardEvent) {
          event.stopPropagation();
          buttonRef.current?.focus();
        }
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close, true);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 bg-surface px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      >
        Examples
        <span aria-hidden="true" className="text-faint">
          ▾
        </span>
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={place}
            className="fixed z-[60] overflow-auto rounded-xl border border-border bg-surface py-1.5 shadow-xl"
          >
            {props.groups.map((group) => (
              <div key={group.section} className="py-1">
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {group.section}
                </div>
                {group.examples.map((example) => (
                  <button
                    key={example.title}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      props.onChoose(example.query);
                    }}
                    className="block w-full cursor-pointer px-3 py-1.5 text-left hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
                  >
                    <span className="block text-sm font-medium text-text">{example.title}</span>
                    <span className="block text-xs text-muted">{example.about}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

const KEYWORD_CLASS = "font-bold text-text";

/** FQL coloured as the Catalog colours conditions, with clause keywords in bold */
function highlight(source: string): Array<{ text: string; className?: string }> {
  const segments: Array<{ text: string; className?: string }> = [];
  const tokens = lexFql(source);
  let expression: { start: number } | undefined;
  const flushExpression = (end: number) => {
    if (!expression) return;
    const lines = colourExpression(source.slice(expression.start, end));
    lines.forEach((line, index) => {
      if (index > 0) segments.push({ text: "\n" });
      const words = line.filter((token) => token.text.trim() !== "");
      for (const token of line) {
        // FQL's own calls, such as rollout(), and the row's key inside a read, are not segments
        const at = words.indexOf(token);
        const type =
          CALLS.includes(token.text) && words[at + 1]?.text === "("
            ? "call"
            : token.text === "key" && words[at - 1]?.text === "("
              ? "name"
              : token.type;
        segments.push({ text: token.text, className: TOKEN_CLASSES[type] || undefined });
      }
    });
    expression = undefined;
  };
  const starts = clauseStarts(tokens);
  for (const [index, token] of tokens.entries()) {
    const clause = starts.has(index);
    if (expression && !clause) continue;
    if (clause) flushExpression(token.start);
    const className =
      token.type === "keyword"
        ? KEYWORD_CLASS
        : token.type === "word" && tokens[index + 1]?.text === "("
          ? TOKEN_CLASSES.call
          : token.type === "comment"
            ? TOKEN_CLASSES.comment
            : token.type === "string"
              ? TOKEN_CLASSES.string
              : token.type === "number" || ["true", "false", "null"].includes(token.text)
                ? TOKEN_CLASSES.constant
                : token.type === "operator"
                  ? TOKEN_CLASSES.operator
                  : token.type === "punctuation"
                    ? TOKEN_CLASSES.punctuation
                    : undefined;
    segments.push({ text: token.text, className });
    // A WHERE clause is a condition expression, coloured as conditions are
    if (clause && token.text === "WHERE") expression = { start: token.start + token.text.length };
  }
  flushExpression(source.length);
  return segments;
}

const EDITOR_TEXT =
  "m-0 p-4 font-mono text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]";

/** How each kind of completion shows its label, as the editor colours the same words */
const COMPLETION_CLASSES: Record<CompletionKind, string> = {
  keyword: "font-bold text-text",
  feature: "text-text",
  variable: "text-text",
  attribute: "text-text",
  column: "text-text",
  operator: TOKEN_CLASSES.operator,
  value: TOKEN_CLASSES.string,
};

/** Characters that open completions as they are typed: names, the start of a key, or a read */
const OPENS_COMPLETIONS = /^[\w'.{*]$/;

/**
 * A plain text area over its own highlighted copy, so typing, selecting and the caret are the
 * browser's own while the text shows in colour. Completions open as names are typed, or with
 * Ctrl+Space, under where the text they complete starts.
 */
function FqlEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  completions: CompletionSource;
}) {
  const { value } = props;
  const segments = React.useMemo(() => highlight(value), [value]);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const markerRef = React.useRef<HTMLSpanElement | null>(null);
  const activeRef = React.useRef<HTMLLIElement | null>(null);
  const [caret, setCaret] = React.useState<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null);
  // Where the caret goes once a chosen completion is in the text
  const pendingCaret = React.useRef<number | null>(null);
  const listId = React.useId();

  const completion = React.useMemo(
    () => (open && caret !== null ? completeFql(value, caret, props.completions) : null),
    [open, caret, value, props.completions],
  );
  const items = completion?.items || [];
  const showing = items.length > 0 && position !== null;

  React.useLayoutEffect(() => {
    const marker = markerRef.current;
    const box = boxRef.current;
    if (!completion || !marker || !box) {
      setPosition(null);
      return;
    }
    const width = 288;
    setPosition({
      top: marker.offsetTop + marker.offsetHeight,
      left: Math.max(0, Math.min(marker.offsetLeft, box.clientWidth - width - 8)),
    });
  }, [completion, value]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current === null || !textarea) return;
    textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, showing]);

  const accept = (item: CompletionItem) => {
    if (!completion) return;
    pendingCaret.current = completion.from + (item.cursor ?? item.insert.length);
    setActive(0);
    setOpen(Boolean(item.chain));
    props.onChange(value.slice(0, completion.from) + item.insert + value.slice(completion.to));
  };

  const caretOf = (textarea: HTMLTextAreaElement) =>
    textarea.selectionStart === textarea.selectionEnd ? textarea.selectionEnd : null;

  return (
    <div
      ref={boxRef}
      className="relative rounded-xl border border-border bg-surface focus-within:border-primary"
    >
      <pre aria-hidden="true" className={`${EDITOR_TEXT} pointer-events-none text-text`}>
        {segments.map((segment, index) =>
          segment.className ? (
            <span key={index} className={segment.className}>
              {segment.text}
            </span>
          ) : (
            segment.text
          ),
        )}
        {/* keeps a last empty line as tall as the text area's */}
        {"\n"}
      </pre>
      {completion && (
        // An invisible copy of the text up to what is completed, to find where that sits
        <div
          aria-hidden="true"
          className={`${EDITOR_TEXT} pointer-events-none invisible absolute inset-0`}
        >
          {value.slice(0, completion.from)}
          <span ref={markerRef}>{"\u200b"}</span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          const input = event.nativeEvent as InputEvent;
          const typed = input.inputType === "insertText" ? input.data || "" : "";
          if (OPENS_COMPLETIONS.test(typed.slice(-1))) setOpen(true);
          else if (!input.inputType?.startsWith("delete")) setOpen(false);
          setActive(0);
          setCaret(caretOf(event.target));
          props.onChange(event.target.value);
        }}
        onSelect={(event) => setCaret(caretOf(event.currentTarget))}
        onMouseDown={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            setOpen(false);
            props.onRun();
            return;
          }
          if (event.ctrlKey && event.key === " ") {
            event.preventDefault();
            setCaret(caretOf(event.currentTarget));
            setOpen(true);
            return;
          }
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) setOpen(false);
          if (!showing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current) => (current + step + items.length) % items.length);
          } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
            event.preventDefault();
            accept(items[Math.min(active, items.length - 1)]);
          } else if (event.key === "Escape") {
            // Closes the list only, not a full view around the editor
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="FQL query"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        className={`${EDITOR_TEXT} absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-text outline-none selection:bg-sky-200/60`}
      />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Completions"
          // Keeps the caret in the text area while an item is clicked
          onMouseDown={(event) => event.preventDefault()}
          className="absolute z-30 max-h-64 w-72 overflow-auto rounded-lg border border-border bg-surface py-1 text-xs shadow-lg"
          style={{ top: position.top, left: position.left }}
        >
          {items.map((item, index) => (
            <li
              key={`${item.kind}:${item.label}`}
              id={`${listId}-${index}`}
              ref={index === active ? activeRef : undefined}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => accept(item)}
              className={`flex cursor-pointer items-baseline gap-3 px-3 py-1 ${index === active ? "bg-elevated" : ""}`}
            >
              <span className={`shrink-0 font-mono ${COMPLETION_CLASSES[item.kind]}`}>
                {item.label}
              </span>
              {item.detail && <span className="ml-auto truncate text-faint">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Errors(props: { errors: FqlError[] }) {
  if (!props.errors.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
      {props.errors.map((error, index) => (
        <li key={index}>
          <span className="font-semibold">
            Line {error.line}, column {error.column}:
          </span>{" "}
          {error.message}
        </li>
      ))}
    </ul>
  );
}

/** The datafiles a report evaluates with, one per environment it reads, or the project's own */
function useDatafiles(wanted: Array<string | null>, setKey?: string) {
  const key = JSON.stringify([setKey, wanted]);
  const [state, setState] = React.useState<{
    key: string;
    datafiles?: Map<string | null, DatafileContent>;
    error?: string;
  }>({ key: "" });

  React.useEffect(() => {
    if (!wanted.length) return;
    let active = true;
    Promise.all(wanted.map((environment) => fetchDatafile(environment, setKey)))
      .then((loaded) => {
        if (active)
          setState({
            key,
            datafiles: new Map(wanted.map((environment, index) => [environment, loaded[index]])),
          });
      })
      .catch(() => {
        if (active)
          setState({
            key,
            error:
              "This Catalog was exported without datafiles. Export it again with this version to evaluate.",
          });
      });
    return () => {
      active = false;
    };
  }, [key]);

  return state.key === key ? state : { key, datafiles: undefined, error: undefined };
}

function Results(props: { report: Report; index: CatalogIndex; setKey?: string }) {
  const { report, index, setKey } = props;
  const { manifest } = useCatalog();
  const hasEnvironments = Boolean(manifest.projectConfig.environments?.length);
  const wanted = evaluates(report) ? datafileEnvironments(report, hasEnvironments) : [];
  const { datafiles, error } = useDatafiles(wanted, setKey);
  // Deadlines read against the browser's clock, as everywhere in the Catalog
  const clock = React.useMemo(() => getDeadlineClock(), []);
  const result = React.useMemo(
    () =>
      evaluates(report) && !datafiles
        ? undefined
        : runReport({ report, index, datafiles, hasEnvironments, clock }),
    [report, index, datafiles, hasEnvironments, clock],
  );
  const [why, setWhy] = React.useState<{ title: string; cell: Cell } | null>(null);
  // A new report has new cells, so an open explanation would be about the old one
  React.useEffect(() => setWhy(null), [report]);

  if (error) return <EmptyState title="No datafiles to evaluate with" description={error} />;
  if (!result) return <p className="text-sm text-muted">Loading datafiles…</p>;
  if (result.tooMany) {
    return (
      <EmptyState
        title={`${result.tooMany.toLocaleString()} evaluations is more than the page runs at once`}
        description={`It runs up to ${EVALUATION_LIMIT.toLocaleString()}. Narrow the report with WHERE, fewer values, columns or environments.`}
      />
    );
  }
  return (
    <div className="space-y-3">
      <Summary result={result} />
      {result.rows.length === 0 ? (
        <EmptyState title="Nothing matches" />
      ) : (
        <ResultTable
          result={result}
          setKey={setKey}
          onWhy={(title, cell) => setWhy({ title, cell })}
        />
      )}
      {why && (
        <WhyPanel
          title={why.title}
          why={why.cell.why}
          cell={why.cell}
          onClose={() => setWhy(null)}
        />
      )}
    </div>
  );
}

function Summary(props: { result: Result }) {
  const { result } = props;
  const [copied, setCopied] = React.useState("");
  const copy = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    });
  const grouped = result.columns.some((column) => column.column.expr.kind === "count");
  const noun = grouped ? "group" : "row";
  const shown =
    result.rows.length < result.total
      ? `${result.rows.length} of ${result.total} ${noun}s`
      : `${result.total} ${noun}${result.total === 1 ? "" : "s"}`;
  const { lenses } = result;
  const lens = !result.evaluations
    ? undefined
    : lenses.has("audience")
      ? lenses.has("person")
        ? "Mixed: some cells describe audiences, others one person"
        : "Audience: a share of everyone matching each row, as rollouts give it"
      : lenses.has("person")
        ? "One person: the exact answer for each row's person"
        : "Exact: everyone matching each row gets the same value";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>
        {shown}
        {result.evaluations ? `, ${result.evaluations.toLocaleString()} evaluations` : ""}
        {lens && (
          <>
            {" "}
            · <span className="font-medium text-text">{lens}</span>
          </>
        )}
      </span>
      <span className="flex gap-3">
        <button
          type="button"
          className="cursor-pointer font-medium text-muted hover:text-text"
          onClick={() => copy("link", window.location.href)}
        >
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          className="cursor-pointer font-medium text-muted hover:text-text"
          onClick={() => copy("markdown", toMarkdown(result))}
        >
          {copied === "markdown" ? "Copied" : "Copy as Markdown"}
        </button>
      </span>
    </div>
  );
}

const CELL_PLACEHOLDER = <span className="text-faint">—</span>;

/** A property's value, as the lists show the same things */
function ValueView(props: {
  value: ResultValue;
  setKey?: string;
  variations: string[];
  onWhy: (cell: Cell) => void;
}) {
  const { value } = props;
  if (value.cell && value.detail) {
    // A rule, reason, override or share, opening the same explanation as the answer it is about
    return (
      <button
        type="button"
        onClick={() => props.onWhy(value.cell!)}
        className="cursor-pointer rounded text-left font-mono text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title="Why?"
      >
        {value.text || CELL_PLACEHOLDER}
      </button>
    );
  }
  if (value.cell) {
    return (
      <CellView
        cell={value.cell}
        variations={props.variations}
        onClick={() => props.onWhy(value.cell!)}
      />
    );
  }
  if (value.tone) {
    const tone = value.tone === "on" ? "success" : value.tone === "partial" ? "warning" : undefined;
    return <Badge tone={tone}>{value.text}</Badge>;
  }
  if (value.link) {
    return (
      <Link
        to={getEntityRoute(value.link.type, value.link.key, props.setKey)}
        className="font-medium text-text hover:underline"
      >
        <EntityKey value={value.link.key} className="[text-wrap:balance]" />
      </Link>
    );
  }
  if (value.list) {
    if (!value.list.length) return CELL_PLACEHOLDER;
    return (
      <span className="flex flex-wrap gap-1">
        {value.list.map((item) => (
          <Badge key={item}>{item}</Badge>
        ))}
      </span>
    );
  }
  if (value.text === "") return CELL_PLACEHOLDER;
  if (value.type === "boolean")
    return value.raw ? <Badge tone="success">Yes</Badge> : <span className="text-muted">No</span>;
  if (value.type === "date") {
    // The day is what a table compares, and the moment shows on hover
    const day = /^\d{4}-\d{2}-\d{2}/.exec(value.text)?.[0];
    return (
      <span className="whitespace-nowrap tabular-nums" title={value.text}>
        {day ?? value.text}
      </span>
    );
  }
  if (value.type === "number") return <span className="tabular-nums">{value.text}</span>;
  // One short word, such as an owner like `checkout-team`, is a name, so it never breaks at a hyphen
  const word =
    value.type === "text" && value.text.length <= 40 && !/\s/.test(value.text)
      ? " whitespace-nowrap"
      : "";
  return (
    <span
      className={`${value.type === "text" ? "text-text" : "font-mono text-xs text-text"}${word}`}
    >
      {value.text}
    </span>
  );
}

/** A heading cell. Headings that show keys keep their case, the rest are small capitals. */
const thBase = "border-b border-border px-3 py-2 text-left text-[11px] font-semibold text-faint";
const thClass = `${thBase} uppercase tracking-wider`;
const tdClass = "border-b border-border px-3 py-2 align-top text-sm";
const sticky = "sticky left-0 bg-surface";
/** Keys stay wide enough to read, and a long one breaks between its words */
const keyClass = "min-w-[12rem]";
const isKey = (column: ResultColumn) =>
  column.column.expr.kind === "property" && column.column.expr.name === "key";

function Heading(props: { column: ResultColumn; setKey?: string }) {
  const { heading } = props.column;
  if (!heading.entity || props.column.column.alias !== undefined) return <>{heading.text}</>;
  return (
    <>
      <Link
        to={getEntityRoute(heading.entity.type, heading.entity.key, props.setKey)}
        className="font-medium text-text hover:underline"
      >
        <EntityKey value={heading.entity.key} />
      </Link>
      <span className="ml-1.5 font-normal text-faint">{heading.detail}</span>
    </>
  );
}

function variationsOf(result: Result) {
  const variations = new Set<string>();
  for (const row of result.rows) {
    for (const value of row.values.flat())
      if (value.cell?.variation) variations.add(value.cell.variation);
  }
  return [...variations];
}

/**
 * The report's rows, columns in SELECT's order after whatever says what each row is about. In a
 * matrix with several environments, each read column splits into one per environment.
 */
function ResultTable(props: {
  result: Result;
  setKey?: string;
  onWhy: (title: string, cell: Cell) => void;
}) {
  const { result } = props;
  const variations = variationsOf(result);
  const split = result.matrix && result.environments.length > 1;
  const headingClass = (column: ResultColumn) =>
    column.heading.entity && column.column.alias === undefined
      ? `${thBase} whitespace-nowrap`
      : thClass;
  const cell = (
    row: ResultRow,
    column: ResultColumn,
    value: ResultValue,
    environment?: string | null,
  ) => (
    <ValueView
      value={value}
      setKey={props.setKey}
      variations={variations}
      onWhy={(evaluated) =>
        props.onWhy(
          [column.heading.text, row.title, environment].filter(Boolean).join(" · "),
          evaluated,
        )
      }
    />
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {result.columns.map((column, index) => (
              <th
                key={index}
                className={`${headingClass(column)} ${index === 0 ? sticky : ""}`}
                rowSpan={split && !column.byEnvironment ? 2 : 1}
                colSpan={split && column.byEnvironment ? result.environments.length : 1}
              >
                <Heading column={column} setKey={props.setKey} />
              </th>
            ))}
          </tr>
          {split && (
            <tr>
              {result.columns.flatMap((column, index) =>
                column.byEnvironment
                  ? result.environments.map((environment) => (
                      <th
                        key={`${index}:${environment}`}
                        className={`${thBase} whitespace-nowrap font-medium`}
                      >
                        {environment}
                      </th>
                    ))
                  : [],
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id} className="hover:bg-elevated/60">
              {result.columns.map((column, index) => {
                const value = row.values[index];
                if (Array.isArray(value)) {
                  return value.map((item, at) => (
                    <td key={`${index}:${at}`} className={tdClass}>
                      {cell(row, column, item, result.environments[at])}
                    </td>
                  ));
                }
                return (
                  <td
                    key={index}
                    className={`${tdClass} ${index === 0 ? sticky : ""} ${column.automatic ? "font-mono text-xs" : ""} ${isKey(column) ? keyClass : ""}`}
                  >
                    {cell(row, column, value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VARIATION_TONES = ["info", "accent", "success", "warning", "danger"] as const;

function CellView(props: { cell: Cell; onClick: () => void; variations: string[] }) {
  const { cell } = props;
  const body =
    cell.tone === "on" ? (
      <Badge tone="success">{cell.text}</Badge>
    ) : cell.tone === "off" ? (
      <Badge>{cell.text}</Badge>
    ) : cell.tone === "partial" ? (
      <Badge tone="warning">{cell.text}</Badge>
    ) : cell.variation ? (
      <Badge
        tone={VARIATION_TONES[props.variations.indexOf(cell.variation) % VARIATION_TONES.length]}
      >
        {cell.text}
      </Badge>
    ) : (
      <span className={`font-mono text-xs ${cell.tone === "none" ? "text-muted" : "text-text"}`}>
        {cell.text || "—"}
      </span>
    );
  // A value read at one place in a rollout says so, and Why says how to read one person's
  const varies = cell.why.depends?.length;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      title={varies ? `Varies with ${cell.why.depends!.join(", ")}. Why?` : "Why?"}
    >
      {body}
      {varies ? <span className="ml-1.5 text-[11px] font-medium text-faint">varies</span> : null}
    </button>
  );
}

/** Why a cell says what it says, as `evaluate --explain` would put it */
function WhyPanel(props: { title: string; cell: Cell; why: Why; onClose: () => void }) {
  const { why } = props;
  const facts: Array<[string, React.ReactNode]> = [
    ["Answer", props.cell.text],
    [
      "Lens",
      why.lens === "audience"
        ? why.depends?.length && !why.bucketBy
          ? "Everyone matching this row, who fall in different places of the rollouts it depends on."
          : `Everyone matching this row. Without ${why.bucketBy || "what it buckets by"}, which this feature buckets by, a rollout reads as the share it enables.`
        : why.lens === "person"
          ? why.at !== undefined
            ? `One person, placed at ${why.at}% of the rollout.`
            : `One person, bucketed by their ${why.bucketBy || "own attributes"}.`
          : "Exact. Everyone matching this row gets this value.",
    ],
    ["Reason", <code key="reason">{why.reason}</code>],
  ];
  if (why.forced) facts.push(["Decided by", "A force entry"]);
  if (why.ruleKey) facts.push(["Matched rule", <code key="rule">{why.ruleKey}</code>]);
  if (why.requires?.length) {
    facts.push([
      "Requires",
      <span key="requires" className="flex flex-col gap-0.5">
        {why.requires.map((item) => (
          <span key={`${item.feature}:${item.variation ?? ""}`}>
            <code>{item.feature}</code>
            {item.variation ? (
              <>
                {" "}
                as <code>{item.variation}</code>
              </>
            ) : null}
            , {item.percentage}% of this audience
          </span>
        ))}
      </span>,
    ]);
  }
  if (why.percentage !== undefined)
    facts.push([
      why.requires?.length ? "Share" : "Rule's rollout",
      `${why.percentage}% of this audience`,
    ]);
  if (why.split) {
    facts.push([
      "Split",
      <span key="split" className="flex flex-col gap-0.5">
        {why.split.map((share) => (
          <span key={share.variation}>
            <code>{share.variation}</code> {share.percentage}%
            {share.value !== undefined ? (
              <>
                , <code>{share.value}</code>
              </>
            ) : null}
          </span>
        ))}
      </span>,
    ]);
  }
  if (why.overrideKey)
    facts.push(["Matched override", <code key="override">{why.overrideKey}</code>]);
  if (why.depends?.length) {
    const features = why.depends;
    facts.push([
      "Varies with",
      <span key="depends">
        {features.map((feature, at) => (
          <React.Fragment key={feature}>
            {at > 0 ? ", " : null}
            <code>{feature}</code>
          </React.Fragment>
        ))}
        . This is the value at one place in{" "}
        {features.length === 1 ? "its rollout" : "their rollouts"}. Write <code>AT</code>, such as{" "}
        <code>AT 75</code>, or a person with what{" "}
        {features.length === 1 ? "it buckets" : "they bucket"} by, to read one person.
      </span>,
    ]);
  }

  return (
    <div
      role="dialog"
      aria-label={`Why: ${props.title}`}
      className="fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-xl"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Why</div>
          <div className="truncate text-sm font-semibold text-text">{props.title}</div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          className="cursor-pointer rounded px-1.5 text-muted hover:text-text"
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-faint">{label}</dt>
            <dd className="text-text">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

/** The rows as a Markdown table, a matrix's environments each a column of their own */
function toMarkdown(result: Result) {
  const escape = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const headings = result.columns.flatMap((column) =>
    column.byEnvironment && result.matrix
      ? result.environments.map((environment) => `${column.heading.text} (${environment})`)
      : [column.heading.text],
  );
  const line = (cells: string[]) => `| ${cells.map(escape).join(" | ")} |`;
  return [
    line(headings),
    line(headings.map(() => "---")),
    ...result.rows.map((row) =>
      line(
        row.values.flatMap((value) =>
          (Array.isArray(value) ? value : [value]).map((item) => item.text),
        ),
      ),
    ),
  ].join("\n");
}
