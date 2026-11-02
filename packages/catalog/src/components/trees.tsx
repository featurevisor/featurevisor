import * as React from "react";
import { Link } from "react-router-dom";
import { treeToExpression } from "@featurevisor/expressions";
import type { Conditions } from "@featurevisor/types";

import { useConditionView, type ConditionView } from "../conditionView";
import { useOptionalCatalog } from "../context/CatalogContext";
import {
  conditionsOf,
  parseConditions,
  ConditionOutline,
  type ConditionNode,
} from "./conditionExpression";
import { getEntityRoute } from "../entityTypes";
import {
  colourExpression,
  expressionParts,
  type ExpressionReference,
  type ExpressionTokenType,
} from "./expressionTokens";
import { slugifyFragment } from "./variables";
import { formatComparisonOperator } from "./valueFormat";

function formatValue(value: unknown): string {
  if (typeof value === "undefined") return "";
  if (value === "") return '""';
  if (value === null) return "null";
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

/** The comparison operator in a condition, set lighter than the operands around it. */
export function Operator(props: { children: React.ReactNode }) {
  return (
    <span className="text-slate-500">
      {typeof props.children === "string"
        ? formatComparisonOperator(props.children)
        : props.children}
    </span>
  );
}

/** Condition operands read as literal values: monospace on a pale tint. */
export function ValueTokens(props: { value: unknown }) {
  const values = Array.isArray(props.value) ? props.value : [props.value];

  if (values.length === 0) {
    return <code className="font-mono text-xs text-slate-800">[]</code>;
  }

  return (
    <>
      {values.map((value, index) => (
        <code
          key={index}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 [overflow-wrap:anywhere]"
        >
          {formatValue(value)}
        </code>
      ))}
    </>
  );
}

const VIEWS: { value: ConditionView; label: string }[] = [
  { value: "tree", label: "Tree" },
  { value: "expression", label: "Expression" },
];

/** Shows conditions as the outline or as expressions, for every condition at once */
function ConditionViewToggle(props: {
  view: ConditionView;
  choose: (view: ConditionView, anchor?: Element) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Show conditions as"
      className="inline-flex shrink-0 self-end rounded-lg bg-elevated p-0.5 sm:self-start"
    >
      {VIEWS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={props.view === value}
          onClick={(event) => props.choose(value, event.currentTarget)}
          className={[
            "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            props.view === value
              ? "bg-surface text-text shadow-sm ring-1 ring-border"
              : "text-muted hover:text-text",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// The website's expression colours, in palette steps the dark theme remaps, so they read in both
const TOKEN_CLASSES: Record<ExpressionTokenType, string> = {
  name: "text-text",
  segment: "rounded bg-slate-100 px-1 text-text ring-1 ring-inset ring-slate-300",
  logic: "font-semibold text-violet-800",
  operator: "text-slate-500",
  comment: "text-slate-500",
  call: "text-rose-700",
  string: "text-sky-800",
  constant: "text-amber-800",
  regex: "text-emerald-700",
  punctuation: "text-faint",
  guide: "inline-block border-l border-violet-200 align-top",
  plain: "",
};

// A linked part's underline: always there but transparent, fading in on hover or focus in its
// own colour at under half strength, so the link shows without competing with the colours. The
// group is named, since a condition can sit in a card that is a group of its own for its
// permalink, and an unnamed group-hover would light every link in the card at once.
const LINKED_TOKEN =
  "underline decoration-transparent decoration-1 underline-offset-[3px] transition-[text-decoration-color] duration-150 group-hover/reference:decoration-[color:color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/reference:decoration-[color:color-mix(in_oklab,currentColor_45%,transparent)]";

/** Where a reference in an expression leads, as the tree view links the same leaf */
function referenceRoute(reference: ExpressionReference, setKey?: string) {
  if (reference.type === "feature" && reference.variable !== undefined) {
    const feature = getEntityRoute("feature", reference.key, setKey);
    return `${feature}/variables#${slugifyFragment(reference.variable)}`;
  }
  return getEntityRoute(reference.type, reference.key, setKey);
}

/**
 * An expression coloured by meaning, one condition a line as fmt writes it. Each segment,
 * attribute, feature and variable it names links to its definition, as in the tree view,
 * keeping its colour.
 */
export function ExpressionText(props: { source: string; setKey?: string }) {
  const lines = React.useMemo(() => colourExpression(props.source), [props.source]);
  return (
    <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-text [overflow-wrap:anywhere]">
      {lines.map((line, index) => (
        <div key={index}>
          {expressionParts(line).map((part, k) => {
            const tokens = part.tokens.map((token, j) => (
              <span
                key={j}
                className={
                  [TOKEN_CLASSES[token.type], part.reference && LINKED_TOKEN]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {token.text}
              </span>
            ));
            return part.reference ? (
              <Link
                key={k}
                to={referenceRoute(part.reference, props.setKey)}
                className="group/reference rounded-sm focus-visible:outline-none"
              >
                {tokens}
              </Link>
            ) : (
              <React.Fragment key={k}>{tokens}</React.Fragment>
            );
          })}
        </div>
      ))}
    </pre>
  );
}

/** Conditions as an expression laid out as fmt writes it, or undefined without an expression form */
export function toExpression(conditions: unknown, namespaceCharacter?: string): string | undefined {
  if (conditions === undefined) return undefined;
  // everyone, or a segment named on its own, reads the same in an expression
  if (typeof conditions === "string") return conditions === "*" ? "'*'" : conditions;
  return treeToExpression(conditions as Conditions, { namespaceCharacter, indent: 2 });
}

/**
 * Conditions as the outline, or, in a project that writes expressions, as an expression laid
 * out as fmt writes it when the reader chooses. A condition with no expression form, such as a
 * disabled feature's variation, stays an outline.
 */
function ConditionBody(props: { node: ConditionNode; conditions: unknown; setKey?: string }) {
  const projectConfig = useOptionalCatalog()?.manifest.projectConfig;
  const offered = projectConfig?.conditionExpressions === true;
  const [view, choose] = useConditionView();
  const namespaceCharacter = projectConfig?.namespaceCharacter;
  const expression = React.useMemo(
    () => (offered ? toExpression(props.conditions, namespaceCharacter) : undefined),
    [offered, props.conditions, namespaceCharacter],
  );
  const outline = <ConditionOutline node={props.node} setKey={props.setKey} />;
  if (!offered) return outline;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <ConditionViewToggle view={view} choose={choose} />
      <div className="min-w-0 flex-1 sm:order-first">
        {view === "expression" && expression !== undefined ? (
          <ExpressionText source={expression} setKey={props.setKey} />
        ) : (
          outline
        )}
        {view === "expression" && expression === undefined && (
          <p className="mt-2 text-xs text-muted">
            Shown as a tree, since it has no expression form.
          </p>
        )}
      </div>
    </div>
  );
}

/** All selectors and gates share the same expression renderer. */
export function ConditionTree(props: { conditions?: Conditions; setKey?: string }) {
  const node = parseConditions(props.conditions);
  return node ? (
    <div className="rounded-lg border border-border bg-surface px-3 py-3 text-sm sm:px-4">
      <ConditionBody node={node} conditions={props.conditions} setKey={props.setKey} />
    </div>
  ) : (
    <p className="text-sm text-muted">No conditions found.</p>
  );
}

/** The root gate above Rules and Overrides: what it guards, then its conditions. */
export function RootConditionsBox(props: {
  node: ConditionNode;
  children: React.ReactNode;
  setKey?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-elevated p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        Root conditions
      </h3>
      <p className="mt-1 text-sm text-muted">{props.children}</p>
      <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-3 sm:px-4">
        <ConditionBody
          node={props.node}
          conditions={conditionsOf(props.node)}
          setKey={props.setKey}
        />
      </div>
    </section>
  );
}
