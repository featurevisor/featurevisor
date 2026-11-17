import * as React from "react";

import { FullViewDialog, isMac } from "../components/fullView";
import { OPERATORS } from "../query/complete";
import { DETAILS, PROPERTIES, type Detail, type PropertyType } from "../query/report";

import { highlight } from "./queryHighlight";

/**
 * FQL at a glance, over the page as the full view is: the one rule, every clause, reads and
 * details, values, what WHERE compares, worked examples to try, and every property. The details,
 * operators and properties come from the registries the language itself uses, so the sheet
 * never falls behind them.
 */

/** FQL coloured as the editor colours it */
function Code(props: { children: string; block?: boolean }) {
  return (
    <code
      className={`${props.block ? "block" : ""} whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text`}
    >
      {highlight(props.children).map((segment, index) =>
        segment.className ? (
          <span key={index} className={segment.className}>
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </code>
  );
}

function Section(props: { title: string; about?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
      </h3>
      {props.about && <p className="text-sm text-muted">{props.about}</p>}
      {props.children}
    </section>
  );
}

/**
 * FQL on the left, what it does on the right, or one above the other on a phone. Plain rows show
 * words as the page shows them rather than as FQL.
 */
function Rows(props: { rows: Array<[string, React.ReactNode]>; plain?: boolean }) {
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {props.rows.map(([code, text]) => (
        <div
          key={code}
          className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="min-w-0">
            {props.plain ? (
              <span className="font-mono text-xs leading-5 text-text">{code}</span>
            ) : (
              <Code>{code}</Code>
            )}
          </dt>
          <dd className="text-sm text-muted">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

const CLAUSES: Array<[string, React.ReactNode]> = [
  [
    "FROM features, variables",
    "What each row is: features, variables, segments or attributes. Left out, each row is a context.",
  ],
  ["WHERE tags includes 'web'", "Keeps the rows that match, written as conditions are."],
  [
    "CONTEXT { country: 'nl', plan: 'pro' }",
    "The attributes every read is evaluated with. With what a feature buckets by, such as userId, its answer is exact, and without it a share. Left out, everyone.",
  ],
  [
    "AT 50",
    "Places them in every rollout, as test specs write at. AT 10, 90 makes a row for each place.",
  ],
  [
    "VARY country ['nl', 'de', OTHER]",
    "A row per value. Alone, VARY country takes the values conditions compare, and VARY * every attribute.",
  ],
  [
    "VARY [{ country: 'nl', city: 'amsterdam' }, OTHER]",
    "A row per context written out, so only real combinations are read, where VARY country, city crosses every value with every other.",
  ],
  [
    "VARY [{ city: 'amsterdam' } AS 'Amsterdam', OTHER AS 'Elsewhere']",
    "AS names a context, shown in place of its attributes in its column and across a matrix.",
  ],
  [
    "ENVIRONMENT staging, production",
    "Where to read, or * for all. Left out, the last environment configured.",
  ],
  ["SELECT key, owner AS team", "The columns, each with a heading AS gives it."],
  ["GROUP BY owner", "Gathers rows, and SELECT count() counts each group."],
  ["ORDER BY owner, key DESC", "Orders the rows, ASC or DESC."],
  ["LIMIT 10", "Shows the first rows only."],
  [
    "AS MATRIX BY ENVIRONMENT",
    "Puts each environment across the top, a row per feature and context.",
  ],
  [
    "AS MATRIX BY CONTEXT",
    "Puts each context CONTEXT, VARY and AT make across the top, a row per feature. Needs FROM.",
  ],
  ["# A note to self", "A line that starts with # is a comment."],
];

const READS: Array<[string, React.ReactNode]> = [
  ["feature('checkout')", "Whether it is on: On, Off, or a share such as 25%."],
  [
    "feature(key)",
    "The row's own feature, FROM features. variable(key) reads the row's own variable.",
  ],
  ["feature('pricing').variation", "Its variation, or how everyone splits between them."],
  ["feature('buyButton').label", "One of its variables."],
  [
    "variable('checkoutSettings').currency",
    "A global variable, and a path inside it, as .name or [0].",
  ],
  ["feature(key, 'staging')", "In an environment of its own, whatever ENVIRONMENT says."],
];

/** Each detail around the read it suits best */
const DETAIL_READS: Record<Detail, string> = {
  rollout: "rollout(feature(key))",
  rule: "rule(feature(key))",
  reason: "reason(feature(key))",
  override: "override(variable(key))",
};

const VALUES: Array<[string, React.ReactNode]> = [
  ["'nl'", "Text, in single quotes, with \\' for a quote inside."],
  ["42, -5, 2.5", "Numbers."],
  ["true, false, null", "True, false and nothing."],
  ["['nl', 'de']", "A list."],
  ["{ country: 'nl', account: { seats: 60 } }", "An object, its keys bare or in quotes."],
  ["VARY country ['nl', OTHER]", "OTHER, in a VARY list, is everyone the conditions do not name."],
];

/** What a cell says, written as cells show it */
const CELLS: Array<[string, React.ReactNode]> = [
  ["On, Off", "On or off for everyone in the row, or for its one context."],
  ["25%", "On for that share of the row's audience."],
  ["control 50% · treatment 50%", "How the audience splits, as shares of the whole row."],
  ["control: Buy · treatment: Buy now", "A variable whose value differs by variation."],
  ["Next day 50%", "A variable's value for the share a rollout turns on. The rest get it off."],
  ["support@example.com varies", "A value read at one place in a rollout it changes with."],
  ["None", "On, with no variation."],
];

/** The line above the results names how cells read */
const LENSES: Array<[string, React.ReactNode]> = [
  ["Audience", "Everyone matching each row, so rollouts read as shares."],
  ["One context", "CONTEXT has what each feature buckets by, or the report has AT."],
  ["Mixed", "Some of each, and the line under it names what CONTEXT lacks."],
  ["Exact", "Everyone matching each row gets the same value."],
];

/** What trips people up, and how FQL settles it */
const GOOD_TO_KNOW: React.ReactNode[] = [
  <>
    A context is whatever the attributes describe: a user, a device, an organization or a service.
  </>,
  <>
    <Code>WHERE feature(key)</Code> is true only when fully on. Compare{" "}
    <Code>rollout(feature(key))</Code> for partial rollouts.
  </>,
  <>
    Alone, <Code>VARY country</Code> takes the values conditions compare exactly. Name range values,
    such as versions, yourself. <Code>VARY *</Code> skips what features bucket by and stops before
    48 rows.
  </>,
  <>
    Several attributes in VARY cross every value with every other. A list of contexts reads only the
    combinations written.
  </>,
  <>
    Without SELECT, rows show <Code>key</Code>, <Code>description</Code>, <Code>owner</Code> and{" "}
    <Code>tags</Code>, or the row's own read when the report evaluates. Without FROM, SELECT is
    needed and bare names are the context's attributes.
  </>,
  <>
    <Code>GROUP BY tags</Code> counts a list once per item, a read groups by its answer, and groups
    sort by count unless ORDER BY says otherwise.
  </>,
  <>
    ORDER BY sorts a flag by its share, <Code>deadlineStatus</Code> by urgency and text naturally,
    blanks last.
  </>,
  <>A report runs up to 20,000 evaluations: rows × contexts × environments × reads.</>,
  <>
    The query lives in the link after <Code>#</Code>, so Copy link shares the report, and Copy as
    Markdown copies its table.
  </>,
];

/** Each type of property, a comparison to show it, and the words a heading calls it */
const TYPES: Array<{ type: PropertyType; label: string; example: string }> = [
  { type: "text", label: "Text", example: "WHERE owner == 'growth-team'" },
  { type: "list", label: "Lists", example: "WHERE tags includes 'web'" },
  { type: "boolean", label: "True or false", example: "WHERE deprecated == true" },
  { type: "number", label: "Numbers", example: "WHERE usedBy == 0" },
  { type: "date", label: "Dates", example: "WHERE deadline before '2027-01-01'" },
];

/** Questions that run in any project */
export const CHEAT_SHEET_EXAMPLES: Array<{ title: string; query: string }> = [
  {
    title: "Rollouts in progress, furthest first",
    query: [
      "FROM features",
      "WHERE rollout(feature(key)) > 0 and rollout(feature(key)) < 100",
      "SELECT key, owner, rollout(feature(key)) AS 'Rollout'",
      "ORDER BY 'Rollout' DESC",
    ].join("\n"),
  },
  {
    title: "What one user gets",
    query: [
      "FROM features",
      "CONTEXT { userId: 'user-1' }",
      "AT 50",
      "SELECT key, feature(key), feature(key).variation",
    ].join("\n"),
  },
  {
    title: "How many each team owns",
    query: ["FROM features, variables", "SELECT owner, count()", "GROUP BY owner"].join("\n"),
  },
  {
    title: "Features whose environments differ",
    query: [
      "FROM features",
      "WHERE differs == true",
      "ENVIRONMENT *",
      "SELECT feature(key)",
      "AS MATRIX BY ENVIRONMENT",
    ].join("\n"),
  },
  {
    title: "Gaps to fill",
    query: [
      "FROM features, variables",
      "WHERE owner notExists or description notExists",
      "SELECT kind, key, owner, description",
    ].join("\n"),
  },
  {
    title: "Every global variable, for each audience",
    query: ["FROM variables", "VARY *", "SELECT variable(key)", "AS MATRIX BY ENVIRONMENT"].join(
      "\n",
    ),
  },
  {
    title: "Three users side by side",
    query: [
      "FROM features",
      "VARY [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }]",
      "SELECT feature(key)",
      "AS MATRIX BY CONTEXT",
    ].join("\n"),
  },
];

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + ".";

export function QueryCheatSheet(props: { onClose: () => void; onTry: (query: string) => void }) {
  const properties = Object.entries(PROPERTIES);
  return (
    <FullViewDialog
      label="FQL cheat sheet"
      title="FQL cheat sheet"
      subtitle="How to write a query, at a glance"
      hint={`${isMac() ? "⌘" : "Ctrl"} Enter runs, Ctrl Space suggests, Esc closes`}
      closeLabel="Close the cheat sheet"
      onClose={props.onClose}
    >
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-4 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-elevated px-4 py-3">
              <Code block>owner, tags, bucketBy</Code>
              <p className="mt-1 text-sm text-muted">
                A bare name is a property of the row, read from what is defined.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-elevated px-4 py-3">
              <Code block>feature('checkout'), variable('supportEmail')</Code>
              <p className="mt-1 text-sm text-muted">
                A call reads what someone gets, as the SDK evaluates it.
              </p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Section
              title="Clauses"
              about="FROM comes first, and the rest in any order, one a line by habit. Keywords are capitals."
            >
              <Rows rows={CLAUSES} />
            </Section>
            <div className="space-y-8">
              <Section title="Reads">
                <Rows rows={READS} />
              </Section>
              <Section title="Details" about="Wrap a read for what its evaluation says beside it.">
                <Rows
                  rows={(Object.keys(DETAILS) as Detail[]).map((detail) => [
                    DETAIL_READS[detail],
                    sentence(DETAILS[detail]),
                  ])}
                />
              </Section>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Section
              title="Comparing in WHERE"
              about={
                <>
                  Join comparisons with <Code>and</Code>, <Code>or</Code> and <Code>not</Code>, and
                  group them in brackets. A read alone, as <Code>WHERE feature(key)</Code>, means on
                  for everyone in the row.
                </>
              }
            >
              <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {TYPES.map(({ type, label, example }) => (
                  <div key={type} className="space-y-1.5 px-3 py-2">
                    <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-text">{label}</span>
                      <Code>{example}</Code>
                    </dt>
                    <dd className="flex flex-wrap gap-1">
                      {OPERATORS[type].map(([operator, about]) => (
                        <span
                          key={operator}
                          title={about}
                          className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted"
                        >
                          {operator}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
            <Section title="Values" about="Written as conditions write them.">
              <Rows rows={VALUES} />
            </Section>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-8">
              <Section
                title="Reading results"
                about="Click any evaluated cell for its Why: the rule, the reason, the share and what it depends on."
              >
                <Rows rows={CELLS} plain />
              </Section>
              <Section title="Lenses" about="The line above the results says how its cells read.">
                <Rows rows={LENSES} plain />
              </Section>
            </div>
            <Section title="Good to know">
              <ul className="space-y-2 rounded-lg border border-border px-4 py-3 text-sm text-muted">
                {GOOD_TO_KNOW.map((item, index) => (
                  <li key={index} className="flex gap-2">
                    <span aria-hidden="true" className="text-faint">
                      ·
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <Section title="Examples" about="Each runs in any project. Try one, then change it.">
            <div className="grid gap-3 lg:grid-cols-2">
              {CHEAT_SHEET_EXAMPLES.map((example) => (
                <div
                  key={example.title}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text">{example.title}</span>
                    <button
                      type="button"
                      onClick={() => props.onTry(example.query)}
                      className="shrink-0 cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted shadow-sm outline-none transition-colors hover:border-slate-400 hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Try it
                    </button>
                  </div>
                  <Code block>{example.query}</Code>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Properties"
            about={
              <>
                What FROM's rows have, for SELECT, WHERE, GROUP BY and ORDER BY. A row per context
                has its attributes instead, and <Code>metadata.jira</Code> reads anything in a
                definition's metadata.
              </>
            }
          >
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map(([name, property]) => (
                <div key={name} className="flex min-w-0 items-baseline gap-2">
                  <dt className="shrink-0">
                    <Code>{name}</Code>
                  </dt>
                  <dd className="min-w-0 text-xs text-muted">{property.about}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </FullViewDialog>
  );
}
