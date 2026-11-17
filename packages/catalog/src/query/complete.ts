import { clauseStarts, lexFql, type FqlToken } from "./fql";
import { DETAILS, PROPERTIES, SUBJECTS, type PropertyType, type Subject } from "./report";

/**
 * What FQL could say next at the caret: clause keywords, what each clause takes, the rows'
 * properties, reads and their details, and the project's own names, such as feature keys inside
 * `feature('`, a feature's variables after `feature('foo').`, and keys or tags inside a WHERE
 * comparison's quotes.
 */

/** The names a project offers for completing */
export interface CompletionSource {
  environments: string[];
  features: Array<{ key: string; description?: string; variables: string[] }>;
  variables: Array<{ key: string; description?: string }>;
  segments: string[];
  attributes: Array<{ key: string; description?: string }>;
  tags: string[];
  owners: string[];
  /** Test scenarios, each a person to read for, as their spec writes it */
  scenarios?: Array<{
    key: string;
    description?: string;
    context: Record<string, unknown>;
    at?: number;
  }>;
}

export type CompletionKind =
  | "keyword"
  | "feature"
  | "variable"
  | "attribute"
  | "column"
  | "operator"
  | "value";

export interface CompletionItem {
  label: string;
  /** Text that replaces what is typed */
  insert: string;
  /** Where the caret lands within `insert`, when not at its end */
  cursor?: number;
  detail?: string;
  kind: CompletionKind;
  /** More completions follow, such as keys after `feature('` */
  chain?: boolean;
}

export interface Completion {
  /** The range the chosen item replaces */
  from: number;
  to: number;
  items: CompletionItem[];
}

const MAX_ITEMS = 100;

const CLAUSE_ITEMS: Array<{ clause: string; item: CompletionItem }> = [
  {
    clause: "FROM",
    item: { label: "FROM", insert: "FROM ", detail: "what each row is", kind: "keyword" },
  },
  {
    clause: "WHERE",
    item: { label: "WHERE", insert: "WHERE ", detail: "filter rows", kind: "keyword" },
  },
  {
    clause: "CONTEXT",
    item: {
      label: "CONTEXT",
      insert: "CONTEXT ",
      detail: "the person's attributes",
      kind: "keyword",
    },
  },
  {
    clause: "AT",
    item: { label: "AT", insert: "AT ", detail: "a place in every rollout", kind: "keyword" },
  },
  {
    clause: "VARY",
    item: { label: "VARY", insert: "VARY ", detail: "a row per value", kind: "keyword" },
  },
  {
    clause: "ENVIRONMENT",
    item: {
      label: "ENVIRONMENT",
      insert: "ENVIRONMENT ",
      detail: "which environments",
      kind: "keyword",
    },
  },
  {
    clause: "SELECT",
    item: { label: "SELECT", insert: "SELECT ", detail: "the columns", kind: "keyword" },
  },
  {
    clause: "GROUP",
    item: {
      label: "GROUP BY",
      insert: "GROUP BY ",
      detail: "count rows by a column",
      kind: "keyword",
    },
  },
  {
    clause: "ORDER",
    item: { label: "ORDER BY", insert: "ORDER BY ", detail: "order rows", kind: "keyword" },
  },
  {
    clause: "LIMIT",
    item: { label: "LIMIT", insert: "LIMIT ", detail: "the first rows only", kind: "keyword" },
  },
  {
    clause: "AS",
    item: { label: "AS TABLE", insert: "AS TABLE", detail: "layout", kind: "keyword" },
  },
  {
    clause: "AS",
    item: {
      label: "AS MATRIX",
      insert: "AS MATRIX",
      detail: "environments across the top",
      kind: "keyword",
    },
  },
];

/** WHERE's operators for each type of property, each with what it asks */
export const OPERATORS: Record<PropertyType, Array<[string, string]>> = {
  text: [
    ["==", "equals"],
    ["!=", "does not equal"],
    ["in", "one of a list"],
    ["notIn", "none of a list"],
    ["contains", "has the text"],
    ["startsWith", "starts with"],
    ["endsWith", "ends with"],
    ["matches", "matches a pattern"],
    ["exists", "has a value"],
    ["notExists", "has no value"],
  ],
  list: [
    ["includes", "has the item"],
    ["notIncludes", "lacks the item"],
    ["includesAny", "has any of a list"],
    ["empty", "has no items"],
    ["notEmpty", "has items"],
  ],
  boolean: [
    ["== true", "is true"],
    ["== false", "is false"],
  ],
  number: [
    ["==", "equals"],
    ["!=", "does not equal"],
    [">", "more than"],
    [">=", "at least"],
    ["<", "less than"],
    ["<=", "at most"],
  ],
  date: [
    ["before", "earlier than a date"],
    ["after", "later than a date"],
    ["exists", "has a date"],
    ["notExists", "has none"],
  ],
};

/** Words some properties hold, offered inside a WHERE comparison's quotes */
const PROPERTY_WORDS: Record<string, string[]> = {
  kind: ["feature", "variable", "segment", "attribute"],
  status: ["production", "other", "disabled", "enabled"],
  deadlineStatus: ["overdue", "today", "upcoming", "later", "done"],
  type: ["boolean", "string", "integer", "double", "array", "object", "json", "semver", "date"],
};

/** A value as FQL writes it: text in single quotes, keys bare where they can be */
export function fqlValue(value: unknown): string {
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(fqlValue).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    );
    if (!entries.length) return "{}";
    return `{ ${entries
      .map(
        ([key, item]) =>
          `${/^[A-Za-z_][\w-]*$/.test(key) ? key : fqlValue(key)}: ${fqlValue(item)}`,
      )
      .join(", ")} }`;
  }
  if (value === undefined) return "null";
  return String(value);
}

const significant = (token: FqlToken) => !["space", "newline", "comment"].includes(token.type);

/** A string token still open at the caret, so completing goes inside it */
function isOpenString(text: string) {
  return text.length === 1 || !text.endsWith("'") || /(^|[^\\])(\\\\)*\\'$/.test(text);
}

function rank(prefix: string, label: string) {
  if (!prefix) return 0;
  const lower = label.toLowerCase();
  const wanted = prefix.toLowerCase();
  if (lower.startsWith(wanted)) return 0;
  // Within a name too, once there is more than a letter to go on
  if (wanted.length > 1 && lower.includes(wanted)) return 1;
  return -1;
}

/** The items that match what is typed, closest first, leaving out an item typed in full */
function filter(items: CompletionItem[], prefix: string) {
  return items
    .map((item, index) => ({ item, index, score: rank(prefix, item.label) }))
    .filter(({ item, score }) => score >= 0 && item.label !== prefix)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, MAX_ITEMS)
    .map(({ item }) => item);
}

/** The read a `)` closes, as in `feature('foo')` or `feature(key, 'staging')`: its call and key */
function readEndingAt(tokens: FqlToken[], close: number) {
  if (tokens[close]?.text !== ")") return undefined;
  let depth = 0;
  for (let index = close; index >= 0; index--) {
    if (tokens[index].text === ")") depth++;
    else if (tokens[index].text === "(" && --depth === 0) {
      const call = tokens[index - 1]?.text;
      const key = tokens[index + 1];
      if (!call) return undefined;
      return {
        call,
        key:
          key?.type === "string"
            ? key.text.slice(1, -1).replace(/\\(.)/g, "$1")
            : key?.text === "key"
              ? null
              : undefined,
      };
    }
  }
  return undefined;
}

/** The column a WHERE comparison is about, for the value being typed after its operator */
function comparedColumn(tokens: FqlToken[]) {
  let index = tokens.length - 1;
  // Inside a list, as in `key in ['a', '`, step back to its opening bracket
  if (tokens[index]?.text === "[" || tokens[index]?.text === ",") {
    while (index >= 0 && tokens[index].text !== "[") index--;
    index--;
  }
  const operator = tokens[index];
  const column = tokens[index - 1];
  if (!operator || !column || column.type !== "word") return undefined;
  if (operator.type !== "operator" && operator.type !== "word") return undefined;
  return column.text;
}

export function completeFql(
  source: string,
  caret: number,
  project: CompletionSource,
): Completion | null {
  const typed = lexFql(source.slice(0, caret));
  const last = typed[typed.length - 1];
  const atCaret = last && last.start + last.text.length === caret ? last : undefined;
  const inString = atCaret?.type === "string" && isOpenString(atCaret.text);
  const inWord = atCaret?.type === "word" || atCaret?.type === "keyword";
  const prefix = inString ? atCaret!.text.slice(1) : inWord ? atCaret!.text : "";
  const from = inString ? atCaret!.start + 1 : inWord ? atCaret!.start : caret;
  const rest = source.slice(caret);
  const before = inString || inWord ? typed.slice(0, -1) : typed;
  const sig = before.filter(significant);
  const previous = sig[sig.length - 1];

  // Where the caret sits: inside which brackets, each with the call it opens, and in which clause
  const brackets: Array<{ text: string; call?: string }> = [];
  sig.forEach((token, index) => {
    if (token.type !== "punctuation") return;
    if ("([{".includes(token.text))
      brackets.push({
        text: token.text,
        call:
          token.text === "(" && sig[index - 1]?.type === "word" ? sig[index - 1].text : undefined,
      });
    else if (")]}".includes(token.text)) brackets.pop();
  });
  const innermost = brackets[brackets.length - 1];
  const starts = clauseStarts(before);
  const clauseIndex = Math.max(-1, ...[...starts]);
  const clause = clauseIndex >= 0 ? before[clauseIndex].text : undefined;

  // What the whole query says, for choices that depend on clauses elsewhere
  const all = lexFql(source);
  const allStarts = [...clauseStarts(all)];
  const used = new Set(allStarts.map((index) => all[index].text));
  const fromIndex = allStarts.find((index) => all[index].text === "FROM");
  const subjects: Subject[] = [];
  if (fromIndex !== undefined) {
    for (const token of all.slice(fromIndex + 1)) {
      if (token.type === "keyword") break;
      if (token.type === "word" && SUBJECTS[token.text]) subjects.push(SUBJECTS[token.text]);
    }
  }
  const people = fromIndex === undefined;
  const grouped = used.has("GROUP");

  const result = (
    items: CompletionItem[],
    to = caret + (rest.match(/^[\w.-]*/)?.[0].length ?? 0),
  ) => {
    const matched = filter(items, prefix);
    return matched.length ? { from, to, items: matched } : null;
  };

  const featureKeys = () => project.features.map((item) => item.key);
  const variableKeys = () => project.variables.map((item) => item.key);
  const allFeatureVariables = () => [
    ...new Set(project.features.flatMap((item) => item.variables)),
  ];

  // A string: keys and environments inside a read, values in WHERE comparisons
  if (inString) {
    const inside = rest.match(/^(?:[^'\\\n]|\\.)*/)![0].length;
    let to = caret + inside;
    const call =
      innermost?.text === "(" && ["feature", "variable"].includes(innermost.call || "")
        ? innermost.call
        : undefined;
    const close = call ? "')" : "'";
    if (source[to] === "'") to++;
    if (call && source[to - 1] === "'" && source[to] === ")") to++;
    const strings = (
      values: string[],
      kind: CompletionKind,
      details?: Map<string, string | undefined>,
    ) =>
      values.map((value) => ({
        label: value,
        insert: `${value.replace(/'/g, "\\'")}${close}`,
        detail: details?.get(value),
        kind,
      }));
    if (call && previous?.text === ",") return result(strings(project.environments, "value"), to);
    if (call === "feature")
      return result(
        strings(
          featureKeys(),
          "feature",
          new Map(project.features.map((item) => [item.key, item.description])),
        ),
        to,
      );
    if (call === "variable")
      return result(
        strings(
          variableKeys(),
          "variable",
          new Map(project.variables.map((item) => [item.key, item.description])),
        ),
        to,
      );
    if (clause === "WHERE") {
      const column = comparedColumn(sig);
      const keys = (subjects.length ? subjects : (["feature"] as Subject[])).flatMap((subject) =>
        subject === "feature"
          ? featureKeys()
          : subject === "variable"
            ? variableKeys()
            : subject === "segment"
              ? project.segments
              : project.attributes.map((item) => item.key),
      );
      const values: Record<string, string[]> = {
        key: keys,
        tags: project.tags,
        owner: project.owners,
        owners: project.owners,
        environments: project.environments,
        environment: project.environments,
        segments: project.segments,
        attributes: project.attributes.map((item) => item.key),
        bucketBy: project.attributes.map((item) => item.key),
        requires: featureKeys(),
        variables: allFeatureVariables(),
        ...PROPERTY_WORDS,
      };
      return result(strings(column ? values[column] || [] : [], "value"), to);
    }
    return null;
  }

  // After a read's `)` and a dot: a feature's variation or one of its variables
  if (previous?.text === ".") {
    const read = readEndingAt(sig, sig.length - 2);
    if (read?.call !== "feature") return null;
    const variables =
      read.key === null
        ? allFeatureVariables()
        : project.features.find((item) => item.key === read.key)?.variables || [];
    return result([
      { label: "variation", insert: "variation", detail: "its variation", kind: "column" },
      ...variables.map((variable) => ({
        label: variable,
        insert: variable,
        detail: "variable",
        kind: "variable" as const,
      })),
    ]);
  }

  // Reads, as each clause can write them
  const reads = (wrap = "") => {
    const close = wrap ? ")" : "";
    const items: CompletionItem[] = [];
    if (subjects.includes("feature"))
      items.push(
        {
          label: `${wrap}feature(key)${close}`,
          insert: `${wrap}feature(key)${close}`,
          detail: "whether the row's feature is on",
          kind: "feature",
        },
        {
          label: `${wrap}feature(key).variation${close}`,
          insert: `${wrap}feature(key).variation${close}`,
          detail: "its variation",
          kind: "feature",
        },
      );
    if (subjects.includes("variable"))
      items.push({
        label: `${wrap}variable(key)${close}`,
        insert: `${wrap}variable(key)${close}`,
        detail: "the row's global variable",
        kind: "variable",
      });
    items.push(
      {
        label: `${wrap}feature('…')`,
        insert: `${wrap}feature('`,
        detail: "a feature: on, .variation or a variable",
        kind: "feature",
        chain: true,
      },
      {
        label: `${wrap}variable('…')`,
        insert: `${wrap}variable('`,
        detail: "a global variable",
        kind: "variable",
        chain: true,
      },
    );
    return items;
  };
  const details = () =>
    (Object.keys(DETAILS) as Array<keyof typeof DETAILS>).map((detail) => ({
      label: `${detail}(…)`,
      insert: `${detail}(`,
      detail: DETAILS[detail],
      kind: "column" as const,
      chain: true,
    }));
  const properties = () =>
    people
      ? project.attributes.map((attribute) => ({
          label: attribute.key,
          insert: attribute.key,
          detail: attribute.description || "attribute",
          kind: "attribute" as const,
        }))
      : [
          ...Object.entries(PROPERTIES)
            .filter(([, property]) =>
              subjects.some((subject) => property.subjects.includes(subject)),
            )
            .map(([name, property]) => ({
              label: name,
              insert: name,
              detail: property.about,
              kind: "column" as const,
            })),
          {
            label: "metadata.…",
            insert: "metadata.",
            detail: "a key from its metadata",
            kind: "column" as const,
          },
        ];

  // Inside a call's brackets: a read's key, or the read a detail wraps
  if (innermost?.text === "(" && innermost.call) {
    const call = innermost.call;
    if ((call === "feature" || call === "variable") && previous?.text === "(") {
      const own = call === "feature" ? subjects.includes("feature") : subjects.includes("variable");
      return result([
        ...(own
          ? [{ label: "key", insert: "key)", detail: "the row's own", kind: "keyword" as const }]
          : []),
        {
          label: "'…'",
          insert: "'",
          detail: `a ${call === "feature" ? "feature" : "global variable"} by key`,
          kind: "value",
          chain: true,
        },
      ]);
    }
    if ((call === "feature" || call === "variable") && previous?.text === ",") {
      return result(
        project.environments.map((environment) => ({
          label: `'${environment}'`,
          insert: `'${environment}')`,
          detail: "in this environment",
          kind: "value",
        })),
      );
    }
    if (call in DETAILS && previous?.text === "(") {
      // rollout() reads a flag, so only feature reads without a variation or variable
      return result(
        reads().filter(
          (item) =>
            call !== "rollout" || (item.label.startsWith("feature(") && !item.label.includes(".")),
        ),
      );
    }
  }

  // A person's attributes, as keys of CONTEXT's object
  if (
    innermost?.text === "{" &&
    clause === "CONTEXT" &&
    (previous?.text === "{" || previous?.text === ",")
  ) {
    return result(
      project.attributes.map((attribute) => ({
        label: attribute.key,
        insert: `${attribute.key}: `,
        detail: attribute.description,
        kind: "attribute",
      })),
    );
  }

  // `AS` before a layout
  if (previous?.text === "AS" && innermost === undefined) {
    return result([
      { label: "TABLE", insert: "TABLE", detail: "layout", kind: "keyword" },
      { label: "MATRIX", insert: "MATRIX", detail: "environments across the top", kind: "keyword" },
    ]);
  }

  // Clauses yet to be written. FROM only comes first.
  const clauseKeywords = () =>
    CLAUSE_ITEMS.filter(({ clause: name }) => {
      if (name === "FROM") return starts.size === 0;
      if (name === "VARY") return true;
      return !used.has(name);
    }).map(({ item }) => item);
  const listStart = (...keywords: string[]) =>
    previous !== undefined && [...keywords, ","].includes(previous.text);
  const atTop = innermost === undefined;
  const inWhereGroup = clause === "WHERE" && innermost?.text === "(" && !innermost.call;
  if (!atTop && !inWhereGroup) return null;

  if (!clause) return result(clauseKeywords());
  if (clause === "FROM") {
    if (listStart("FROM"))
      return result(
        Object.entries(SUBJECTS)
          .filter(([, subject]) => !subjects.includes(subject))
          .map(([name]) => ({
            label: name,
            insert: name,
            detail: `a row per ${name.slice(0, -1)}`,
            kind: "value" as const,
          })),
      );
    return result(clauseKeywords());
  }
  if (clause === "SELECT" || clause === "GROUP" || clause === "ORDER") {
    if (listStart("SELECT", "GROUP", "ORDER", "BY")) {
      const count =
        clause === "SELECT" || (clause === "ORDER" && grouped)
          ? [
              {
                label: "count()",
                insert: "count()",
                detail: "rows in each group",
                kind: "column" as const,
              },
            ]
          : [];
      return result([...properties(), ...reads(), ...details(), ...count]);
    }
    const after: CompletionItem[] =
      clause === "SELECT"
        ? [{ label: "AS '…'", insert: "AS ''", cursor: 4, detail: "a heading", kind: "keyword" }]
        : clause === "ORDER"
          ? [
              {
                label: "DESC",
                insert: "DESC",
                detail: "largest, latest or last first",
                kind: "keyword",
              },
              {
                label: "ASC",
                insert: "ASC",
                detail: "smallest, earliest or first first",
                kind: "keyword",
              },
            ]
          : [];
    return result([...after, ...clauseKeywords()]);
  }
  if (clause === "VARY") {
    if (listStart("VARY"))
      return result([
        { label: "*", insert: "*", detail: "every attribute compared", kind: "value" },
        ...project.attributes.map((attribute) => ({
          label: attribute.key,
          insert: attribute.key,
          detail: attribute.description || "attribute",
          kind: "attribute" as const,
        })),
      ]);
    return result(clauseKeywords());
  }
  if (clause === "ENVIRONMENT") {
    if (listStart("ENVIRONMENT"))
      return result([
        { label: "*", insert: "*", detail: "every environment", kind: "value" },
        ...project.environments.map((environment) => ({
          label: environment,
          insert: environment,
          kind: "value" as const,
        })),
      ]);
    return result(clauseKeywords());
  }
  if (clause === "CONTEXT") {
    if (previous?.text === "CONTEXT")
      return result([
        { label: "{}", insert: "{}", detail: "everyone, as audiences", kind: "value" },
        {
          label: "{ … }",
          insert: "{ ",
          detail: "a person's attributes",
          kind: "value",
          chain: true,
        },
        // A test scenario's person, and its place in the rollout when it has one
        ...(project.scenarios || []).map((scenario) => ({
          label: scenario.key,
          insert: `${fqlValue(scenario.context)}${
            scenario.at !== undefined && !used.has("AT") ? `\nAT ${scenario.at}` : ""
          }`,
          detail: scenario.description || "test scenario",
          kind: "value" as const,
        })),
      ]);
    return result(clauseKeywords());
  }
  if (clause === "AT") {
    if (listStart("AT"))
      return result(
        ["0", "25", "50", "75", "100"].map((value) => ({
          label: value,
          insert: value,
          detail: "a place from 0 to 100",
          kind: "value" as const,
        })),
      );
    return result(clauseKeywords());
  }
  if (clause === "LIMIT") {
    if (previous?.text === "LIMIT")
      return result(
        ["10", "20", "50", "100"].map((value) => ({
          label: value,
          insert: value,
          kind: "value" as const,
        })),
      );
    return result(clauseKeywords());
  }
  if (clause === "WHERE") {
    if (previous && ["WHERE", "and", "or", "not", "("].includes(previous.text)) {
      const attributes = people
        ? []
        : project.attributes.map((attribute) => ({
            label: attribute.key,
            insert: attribute.key,
            detail: "the person's attribute",
            kind: "attribute" as const,
          }));
      return result([
        ...properties(),
        ...reads(),
        ...details(),
        ...(used.has("VARY") || used.has("CONTEXT") ? attributes : []),
      ]);
    }
    if (previous?.type === "word") {
      const property = people ? undefined : PROPERTIES[previous.text];
      const type: PropertyType | undefined = property
        ? property.type
        : previous.text.startsWith("metadata.") ||
            project.attributes.some((item) => item.key === previous.text)
          ? "text"
          : undefined;
      if (type)
        return result(
          OPERATORS[type].map(([operator, detail]) => ({
            label: operator,
            insert: operator,
            detail,
            kind: "operator",
          })),
        );
    }
    if (previous?.text === ")" && readEndingAt(sig, sig.length - 1)) {
      const read = readEndingAt(sig, sig.length - 1)!;
      const operators =
        read.call === "rollout"
          ? OPERATORS.number
          : read.call === "feature"
            ? OPERATORS.boolean
            : OPERATORS.text.slice(0, 4);
      return result([
        ...operators.map(([operator, detail]) => ({
          label: operator,
          insert: operator,
          detail,
          kind: "operator" as const,
        })),
        { label: "and", insert: "and ", kind: "operator" },
        { label: "or", insert: "or ", kind: "operator" },
        ...(atTop ? clauseKeywords() : []),
      ]);
    }
    return result([
      { label: "and", insert: "and ", kind: "operator" },
      { label: "or", insert: "or ", kind: "operator" },
      ...(atTop ? clauseKeywords() : []),
    ]);
  }
  return null;
}
