import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  FeatureAssertion,
  ScenarioAssertion,
  SegmentAssertion,
  Test,
  TestCheck,
  VariableAssertion,
} from "@featurevisor/types";

import { Badge, EmptyState, EntityKey, LabelValueBadge, MarkdownContent } from "./ui";
import { entityLabels, getEntityRoute } from "../entityTypes";
import { TestReferences } from "./testNavigation";
import { CheckSentence, getCheckLogic } from "./checkSentence";
import type { CatalogEntityType, TestReportResult } from "../types";
import {
  expandTestAssertions,
  findTestReportCase,
  getTestReportCoverage,
  getTestReportStatus,
  getTestAssertionPermalink,
  getTestCheckDisplayLabel,
  getTestCheckPath,
  getTestCheckPermalink,
  getTestValuePresence,
  NOT_IN_REPORT,
  type ExpandedTestAssertion,
  type TestCheckPathPart,
} from "../testModel";

function getAssertionElementId(permalink: string) {
  return `assertion-${encodeURIComponent(permalink)}`;
}

function hasValue(value: unknown) {
  return value !== undefined;
}

function ValueDisplay(props: { value: unknown }) {
  const presence = getTestValuePresence(props.value);

  if (presence === "missing") {
    return <span className="text-faint">not set</span>;
  }

  if (presence === "null") {
    return <span className="font-mono text-xs [overflow-wrap:anywhere]">null</span>;
  }

  if (typeof props.value === "boolean") {
    return (
      <Badge tone={props.value ? "success" : "neutral"}>{props.value ? "true" : "false"}</Badge>
    );
  }

  if (Array.isArray(props.value)) {
    if (props.value.length === 0) {
      return <span className="text-faint">empty</span>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {props.value.map((value, index) => (
          <span key={index} className="rounded-md border border-border bg-surface px-2 py-1">
            <ValueDisplay value={value} />
          </span>
        ))}
      </div>
    );
  }

  if (typeof props.value === "object") {
    const entries = Object.entries(props.value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-faint">empty</span>;
    }

    return (
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(7rem,0.35fr)_1fr]">
            <dt className="font-mono text-xs font-semibold text-muted [overflow-wrap:anywhere]">
              {key}
            </dt>
            <dd className="min-w-0 text-sm [overflow-wrap:anywhere]">
              <ValueDisplay value={value} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className="font-mono text-xs [overflow-wrap:anywhere]">{String(props.value)}</span>;
}

function isEmptyObject(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.keys(value as object).length
  );
}

/** Context and expectations sit side by side; an empty context is only a badge. */
function ContextAndExpected(props: { context: unknown; expected?: Record<string, unknown> }) {
  const hasExpected = Boolean(props.expected && Object.keys(props.expected).length);
  const hasContext = !isEmptyObject(props.context || {});

  if (!hasContext && !hasExpected) return null;

  const isShallow = (value: unknown) =>
    Object.values((value || {}) as Record<string, unknown>).every(
      (item) => item === null || typeof item !== "object",
    );
  const sideBySide =
    hasContext && hasExpected && isShallow(props.context) && isShallow(props.expected);

  return (
    <div className={`grid gap-3 ${sideBySide ? "lg:grid-cols-2" : ""}`}>
      {hasContext && <TestDataPanel title="Context" value={props.context} />}
      {hasExpected && <TestDataPanel title="Expected" value={props.expected} />}
    </div>
  );
}

function ContextBadge(props: { context: unknown }) {
  return isEmptyObject(props.context || {}) ? (
    <LabelValueBadge label="Context" value="none" compact />
  ) : null;
}

function TestDataPanel(props: { title: string; value: unknown; className?: string }) {
  if (!hasValue(props.value)) {
    return null;
  }

  return (
    <section className={`min-w-0 ${props.className || ""}`}>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
      </h4>
      <ValueDisplay value={props.value} />
    </section>
  );
}

function TestPermalink(props: {
  permalink: string;
  label: string;
  kind: "assertion" | "case" | "check";
}) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set("assertion", props.permalink);

  return (
    <Link
      to={{ pathname: location.pathname, search: `?${search.toString()}` }}
      aria-label={`Link to ${props.kind} ${props.label}`}
      title={`Link to this ${props.kind}`}
      className="inline-flex rounded p-1 text-muted opacity-100 transition-opacity hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:opacity-0 md:group-hover:opacity-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4" />
        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20" />
      </svg>
    </Link>
  );
}

/** Checks as an indented outline. Each line reads as a sentence and groups indent their children. */
function CheckList(props: {
  checks: TestCheck[];
  testKey: string;
  assertionLabel: string;
  selectedPermalink?: string;
  setKey?: string;
  ownerVariable?: string;
  parentLabel?: string;
  parentPath?: TestCheckPathPart[];
}) {
  return (
    <ul className="space-y-0.5">
      {props.checks.map((check, index) => {
        const label = getTestCheckDisplayLabel(check, index, props.parentLabel);
        const checkPath = getTestCheckPath(check, index, props.parentPath);
        const permalink = getTestCheckPermalink(props.testKey, props.assertionLabel, checkPath);
        const selected = props.selectedPermalink === permalink;
        const logic = getCheckLogic(check);

        return (
          <li
            id={getAssertionElementId(permalink)}
            key={permalink}
            aria-current={selected ? "true" : undefined}
            className="scroll-mt-6"
          >
            <div
              className={[
                "group flex min-w-0 items-start justify-between gap-3 rounded-md px-2 py-1",
                selected ? "bg-primary/5 ring-2 ring-primary/20" : "hover:bg-elevated",
              ].join(" ")}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-6">
                  {logic && (
                    <Badge tone={logicalCheckTones[logic.operator]}>
                      {logic.operator.toUpperCase()}
                    </Badge>
                  )}
                  {check.key && (
                    <span className="font-mono text-[11px] font-semibold text-faint [overflow-wrap:anywhere]">
                      {check.key}
                    </span>
                  )}
                  <CheckSentence
                    check={check}
                    ownerVariable={props.ownerVariable}
                    setKey={props.setKey}
                  />
                </div>
                {check.description && <MarkdownContent value={check.description} quiet />}
              </div>
              <TestPermalink permalink={permalink} label={label} kind="check" />
            </div>
            {logic && (
              <div className="ml-4 border-l border-border pl-2">
                <CheckList
                  {...props}
                  checks={logic.checks}
                  parentLabel={label}
                  parentPath={checkPath}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const logicalCheckTones = { and: "info", or: "accent", not: "warning" } as const;

function TestChecksPanel(props: {
  checks: TestCheck[] | undefined;
  testKey: string;
  assertionLabel: string;
  selectedPermalink?: string;
  setKey?: string;
  ownerVariable?: string;
  pathPrefix?: TestCheckPathPart[];
}) {
  if (!props.checks) return null;

  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Checks</h4>
      <div className="rounded-lg border border-border p-1">
        <CheckList {...props} checks={props.checks} parentPath={props.pathPrefix} />
      </div>
    </section>
  );
}

function FeatureAssertionContent(props: { assertion: FeatureAssertion }) {
  const assertion = props.assertion;
  const defaults = {
    ...(hasValue(assertion.defaultVariationValue)
      ? { variation: assertion.defaultVariationValue }
      : {}),
    ...(assertion.defaultVariableValues ? { variables: assertion.defaultVariableValues } : {}),
  };
  const expectations = {
    ...(hasValue(assertion.expectedToBeEnabled) ? { enabled: assertion.expectedToBeEnabled } : {}),
    ...(hasValue(assertion.expectedVariation) ? { variation: assertion.expectedVariation } : {}),
    ...(assertion.expectedVariables ? { variables: assertion.expectedVariables } : {}),
    ...(assertion.expectedEvaluations ? { evaluations: assertion.expectedEvaluations } : {}),
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {assertion.environment && (
          <LabelValueBadge label="Environment" value={assertion.environment} compact />
        )}
        {assertion.target && <LabelValueBadge label="Target" value={assertion.target} compact />}
        {hasValue(assertion.at) && (
          <LabelValueBadge label="Bucket" value={`${assertion.at}%`} compact />
        )}
        <ContextBadge context={assertion.context} />
      </div>

      <div className="space-y-3">
        <ContextAndExpected context={assertion.context} expected={expectations} />
        {Object.keys(defaults).length > 0 && <TestDataPanel title="Defaults" value={defaults} />}
        {assertion.stickyFeatures && (
          <TestDataPanel title="Sticky features" value={assertion.stickyFeatures} />
        )}
        {assertion.stickyVariables && (
          <TestDataPanel title="Sticky variables" value={assertion.stickyVariables} />
        )}
      </div>

      {assertion.children?.length ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Child instances
          </h4>
          <div className="space-y-3">
            {assertion.children.map((child, index) => (
              <div key={index} className="rounded-lg border border-border bg-elevated p-3">
                <div className="mb-3 text-xs font-semibold text-muted">Child {index + 1}</div>
                <ValueDisplay value={child} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function SegmentAssertionContent(props: { assertion: SegmentAssertion }) {
  return (
    <div className="space-y-4">
      <TestDataPanel title="Context" value={props.assertion.context} />
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          Expected
        </h4>
        <Badge tone={props.assertion.expectedToMatch ? "success" : "neutral"}>
          {props.assertion.expectedToMatch ? "Matches segment" : "Does not match segment"}
        </Badge>
      </section>
    </div>
  );
}

function VariableAssertionContent(props: {
  assertion: VariableAssertion;
  testKey: string;
  assertionLabel: string;
  selectedPermalink?: string;
  setKey?: string;
  ownerVariable?: string;
}) {
  const defaults = hasValue(props.assertion.defaultVariableValue)
    ? { value: props.assertion.defaultVariableValue }
    : undefined;
  const expectations = {
    ...(hasValue(props.assertion.expectedValue) ? { value: props.assertion.expectedValue } : {}),
    ...(props.assertion.expectedEvaluation
      ? { evaluation: props.assertion.expectedEvaluation }
      : {}),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {props.assertion.environment && (
          <LabelValueBadge label="Environment" value={props.assertion.environment} compact />
        )}
        {props.assertion.target && (
          <LabelValueBadge label="Target" value={props.assertion.target} compact />
        )}
        {hasValue(props.assertion.at) && (
          <LabelValueBadge
            label="Required feature bucket"
            value={`${props.assertion.at}%`}
            compact
          />
        )}
        <ContextBadge context={props.assertion.context} />
      </div>
      <ContextAndExpected context={props.assertion.context} expected={expectations} />
      <TestChecksPanel
        checks={props.assertion.checks}
        testKey={props.testKey}
        assertionLabel={props.assertionLabel}
        selectedPermalink={props.selectedPermalink}
        setKey={props.setKey}
        ownerVariable={props.ownerVariable}
      />
      <TestDataPanel title="Defaults" value={defaults} />
      {props.assertion.stickyFeatures && (
        <TestDataPanel title="Sticky features" value={props.assertion.stickyFeatures} />
      )}
      {props.assertion.stickyVariables && (
        <TestDataPanel title="Sticky variables" value={props.assertion.stickyVariables} />
      )}
      {props.assertion.children?.length ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Child instances
          </h4>
          <div className="space-y-3">
            {props.assertion.children.map((child, index) => {
              const { checks, ...value } = child;
              return (
                <div
                  key={index}
                  className="space-y-3 rounded-lg border border-border bg-elevated p-3"
                >
                  <div className="text-xs font-semibold text-muted">Child {index + 1}</div>
                  <ValueDisplay value={value} />
                  <TestChecksPanel
                    checks={checks}
                    testKey={props.testKey}
                    assertionLabel={props.assertionLabel}
                    selectedPermalink={props.selectedPermalink}
                    setKey={props.setKey}
                    ownerVariable={props.ownerVariable}
                    pathPrefix={[["child", index]]}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ScenarioAssertionContent(props: {
  assertion: ScenarioAssertion;
  testKey: string;
  assertionLabel: string;
  selectedPermalink?: string;
  setKey?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {props.assertion.environment && (
          <LabelValueBadge label="Environment" value={props.assertion.environment} compact />
        )}
        {props.assertion.target && (
          <LabelValueBadge label="Target" value={props.assertion.target} compact />
        )}
        {hasValue(props.assertion.at) && (
          <LabelValueBadge
            label="Required feature bucket"
            value={`${props.assertion.at}%`}
            compact
          />
        )}
        <ContextBadge context={props.assertion.context} />
      </div>
      <ContextAndExpected context={props.assertion.context} />
      <TestChecksPanel
        checks={props.assertion.checks}
        testKey={props.testKey}
        assertionLabel={props.assertionLabel}
        selectedPermalink={props.selectedPermalink}
        setKey={props.setKey}
      />
      {props.assertion.stickyFeatures && (
        <TestDataPanel title="Sticky features" value={props.assertion.stickyFeatures} />
      )}
      {props.assertion.stickyVariables && (
        <TestDataPanel title="Sticky variables" value={props.assertion.stickyVariables} />
      )}
      {props.assertion.children?.length ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Child instances
          </h4>
          <div className="space-y-3">
            {props.assertion.children.map((child, index) => {
              const { checks, ...value } = child;
              return (
                <div
                  key={index}
                  className="space-y-3 rounded-lg border border-border bg-elevated p-3"
                >
                  <div className="text-xs font-semibold text-muted">Child {index + 1}</div>
                  <ValueDisplay value={value} />
                  <TestChecksPanel
                    checks={checks}
                    testKey={props.testKey}
                    assertionLabel={props.assertionLabel}
                    selectedPermalink={props.selectedPermalink}
                    setKey={props.setKey}
                    pathPrefix={[["child", index]]}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ResultBadge(props: { passed: boolean; verification?: TestReportResult["verification"] }) {
  if (props.verification !== "current")
    return (
      <Badge>
        Historical {props.passed ? "pass" : "failure"} (
        {props.verification === "stale" ? "stale inputs" : "unverified inputs"})
      </Badge>
    );
  return (
    <Badge tone={props.passed ? "success" : "danger"}>
      {props.passed ? "✓ Passed" : "✗ Failed"}
    </Badge>
  );
}

function formatReportValue(value: unknown) {
  if (value === undefined) return "undefined";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function ReportErrors(props: { errors: TestReportResult["cases"][number]["errors"] }) {
  if (props.errors.length === 0) return null;

  return (
    <ul className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs">
      {props.errors.map((error, index) => (
        <li key={index} className="space-y-1">
          <div className="font-semibold text-rose-800">{error.message}</div>
          {error.path && <div className="font-mono text-rose-700">{error.path.join(".")}</div>}
          {("expected" in error || "actual" in error) && (
            <div className="grid gap-1 font-mono text-rose-900 sm:grid-cols-2">
              <span className="[overflow-wrap:anywhere]">
                expected: {formatReportValue(error.expected)}
              </span>
              <span className="[overflow-wrap:anywhere]">
                actual: {formatReportValue(error.actual)}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The feature, segment or variable an entity test spec is written for. */
function getTestSubject(test: Test): { type: CatalogEntityType; key: string } | undefined {
  const record = test as unknown as Record<string, unknown>;

  for (const type of ["feature", "segment", "variable"] as const) {
    if (typeof record[type] === "string") return { type, key: record[type] as string };
  }

  return undefined;
}

/** Specs with more cases than this start with cases collapsed to one line each. */
const COLLAPSE_AFTER = 3;

function formatSummaryValue(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isMatrixTemplate(value: unknown) {
  return typeof value === "string" && value.includes("${{");
}

/**
 * One line describing a collapsed case: where it runs and what it expects.
 * Values filled in from the matrix are left out because the row already shows them.
 */
export function getAssertionSummary(
  test: Test,
  assertion: ExpandedTestAssertion["assertion"],
  template?: Record<string, unknown>,
) {
  const parts: string[] = [];
  const authored = assertion as Partial<FeatureAssertion & VariableAssertion & ScenarioAssertion>;
  const fromMatrix = (field: string) => isMatrixTemplate(template?.[field]);
  if (authored.environment && !fromMatrix("environment")) parts.push(`in ${authored.environment}`);
  if (authored.target && !fromMatrix("target")) parts.push(`target ${authored.target}`);
  if (hasValue(authored.at) && !fromMatrix("at")) parts.push(`at ${authored.at}%`);

  if ("feature" in test) {
    const feature = assertion as FeatureAssertion;
    const expects: string[] = [];
    if (hasValue(feature.expectedToBeEnabled))
      expects.push(feature.expectedToBeEnabled ? "enabled" : "disabled");
    if (hasValue(feature.expectedVariation))
      expects.push(`variation ${formatSummaryValue(feature.expectedVariation)}`);
    if (feature.expectedVariables)
      expects.push(pluralize(Object.keys(feature.expectedVariables).length, "variable"));
    if (feature.expectedEvaluations) expects.push("evaluations");
    if (expects.length) parts.push(`expects ${expects.join(", ")}`);
  } else if ("segment" in test) {
    parts.push(
      (assertion as SegmentAssertion).expectedToMatch ? "expects a match" : "expects no match",
    );
  } else {
    const variable = assertion as VariableAssertion;
    if (hasValue(variable.expectedValue))
      parts.push(`expects ${formatSummaryValue(variable.expectedValue)}`);
    if (variable.expectedEvaluation) parts.push("expects evaluation details");
    if (authored.checks?.length) parts.push(pluralize(authored.checks.length, "check"));
  }
  if (authored.children?.length) parts.push(pluralize(authored.children.length, "child instance"));

  return parts.join(" · ");
}

function Chevron(props: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${props.open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function TestSpec(props: {
  test: Test;
  index: number;
  permalinkKey: string;
  selectedPermalink?: string;
  setKey?: string;
  entity?: { type: string; key: string };
  reportSupplied?: boolean;
}) {
  const testKey = props.test.key || `test-${props.index + 1}`;
  const assertions = expandTestAssertions(props.test);
  const authoredCount = props.test.assertions?.length || 0;
  const hasMatrix = props.test.assertions?.some((assertion) => Boolean(assertion.matrix));
  const assertionKind = "scenario" in props.test ? "case" : "assertion";
  const report = (props.test as unknown as { report?: TestReportResult }).report;
  const coverage = report && getTestReportCoverage(report, props.test, props.setKey);
  const collapsible = assertions.length > COLLAPSE_AFTER;
  // Only explicit toggles are stored. Everything else follows the defaults below.
  // Each toggle remembers the permalink selected when it was made. Following a newer
  // permalink into a collapsed case opens it, so the target is rendered before scrolling.
  const [toggled, setToggled] = React.useState<
    Record<string, { open: boolean; selection?: string }>
  >({});
  const items = assertions.map((expanded) => {
    const permalink = getTestAssertionPermalink(props.permalinkKey, expanded.label);
    const result = findTestReportCase(report, props.test, expanded, props.setKey);
    const linked =
      props.selectedPermalink === permalink ||
      Boolean(props.selectedPermalink?.startsWith(`${permalink}:check:`));
    const toggle = toggled[permalink];
    const open =
      linked && toggle?.selection !== props.selectedPermalink
        ? true
        : (toggle?.open ?? (!collapsible || linked || result?.passed === false));
    return { expanded, permalink, result, open };
  });
  const allOpen = items.every((item) => item.open);

  const showScenarioName = "scenario" in props.test && props.test.scenario !== testKey;
  // On a spec's own page, name the entity it tests instead of repeating the spec key.
  const subject = !props.entity ? getTestSubject(props.test) : undefined;
  const hasHeader =
    Boolean(props.entity) ||
    showScenarioName ||
    Boolean(report) ||
    props.reportSupplied ||
    props.test.promotable === false ||
    assertionKind === "assertion" ||
    hasMatrix;

  return (
    <section className="space-y-5">
      {hasHeader && (
        <header className="flex flex-col justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-end">
          <div className="min-w-0">
            {props.entity && (
              <h2 className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                <EntityKey value={testKey} />
              </h2>
            )}
            {props.entity && (
              <Link
                className="mt-2 inline-block text-xs text-primary hover:underline"
                to={getEntityRoute("test", testKey, props.setKey)}
              >
                {"scenario" in props.test ? "Open complete scenario" : "Open complete test spec"}
              </Link>
            )}
            {subject && (
              <p className="text-sm text-muted">
                Tests {entityLabels[subject.type].singular.toLowerCase()}{" "}
                <Link
                  to={getEntityRoute(subject.type, subject.key, props.setKey)}
                  className="font-medium text-primary hover:underline"
                >
                  <EntityKey value={subject.key} />
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {showScenarioName && (
              <LabelValueBadge
                label="Scenario"
                value={(props.test as { scenario: string }).scenario}
                compact
              />
            )}
            {report &&
              coverage &&
              (report.verification !== "current" ||
                (coverage.complete && report.passed === coverage.passed)) && (
                <ResultBadge passed={report.passed} verification={report.verification} />
              )}
            {!report && props.reportSupplied && <Badge>{NOT_IN_REPORT}</Badge>}
            {props.test.promotable === false && <Badge>not promotable</Badge>}
            {assertionKind === "assertion" && (
              <Badge>
                {authoredCount} assertion{authoredCount === 1 ? "" : "s"}
              </Badge>
            )}
            {hasMatrix && (
              <Badge tone="accent">
                {assertions.length} matrix case{assertions.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </header>
      )}

      {/* A complete current pass is already said by the badge. */}
      {report &&
        coverage &&
        !(
          report.verification === "current" &&
          coverage.complete &&
          coverage.passed &&
          report.passed
        ) && (
          <p className="text-sm text-muted">
            {getTestReportStatus(report, props.test, props.setKey)}
          </p>
        )}
      <TestReferences test={props.test} entity={props.entity} setKey={props.setKey} />

      {assertions.length === 0 ? (
        <EmptyState
          title={`No ${assertionKind === "case" ? "cases" : "assertions"} found in this test spec`}
        />
      ) : (
        <div className="space-y-2">
          {items.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-medium text-muted hover:text-text"
                onClick={() =>
                  setToggled(
                    Object.fromEntries(
                      items.map((item) => [
                        item.permalink,
                        { open: !allOpen, selection: props.selectedPermalink },
                      ]),
                    ),
                  )
                }
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}
          {items.map(({ expanded, permalink, result, open }) => {
            const selected = props.selectedPermalink === permalink;
            const assertion = expanded.assertion;
            const bodyId = `${getAssertionElementId(permalink)}-body`;
            const summary = getAssertionSummary(
              props.test,
              assertion,
              props.test.assertions?.[expanded.assertionIndex] as Record<string, unknown>,
            );

            return (
              <article
                id={getAssertionElementId(permalink)}
                key={permalink}
                aria-current={selected ? "true" : undefined}
                className={[
                  "scroll-mt-6 rounded-xl border bg-surface transition-shadow",
                  selected ? "border-primary ring-2 ring-primary/20" : "border-border",
                ].join(" ")}
              >
                <header className={`space-y-0.5 px-4 ${open ? "pt-4" : "py-2.5"}`}>
                  <div className="group flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={bodyId}
                          className="inline-flex items-center gap-1.5 rounded text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() =>
                            setToggled((current) => ({
                              ...current,
                              [permalink]: { open: !open, selection: props.selectedPermalink },
                            }))
                          }
                        >
                          <Chevron open={open} />
                          {assertionKind === "case" ? "Case" : "Assertion"} {expanded.label}
                        </button>
                      </h3>
                      {result && (
                        <ResultBadge passed={result.passed} verification={report?.verification} />
                      )}
                      {!result && (report || props.reportSupplied) && (
                        <Badge>
                          {report && report.verification !== "current"
                            ? "Not in earlier report"
                            : NOT_IN_REPORT}
                        </Badge>
                      )}
                      {assertion.promotable === false && <Badge>not promotable</Badge>}
                      {expanded.matrixValues &&
                        Object.entries(expanded.matrixValues).map(([key, value]) => (
                          <LabelValueBadge key={key} label={key} value={String(value)} compact />
                        ))}
                    </div>
                    <div className="shrink-0">
                      <TestPermalink
                        permalink={permalink}
                        label={expanded.label}
                        kind={assertionKind}
                      />
                    </div>
                  </div>
                  {assertion.description && (
                    <div className="pl-5">
                      <MarkdownContent value={assertion.description} />
                    </div>
                  )}
                  {!open && summary && <p className="pl-5 text-xs text-muted">{summary}</p>}
                </header>

                {open && (
                  <div id={bodyId} className="space-y-3 px-4 pb-4 pt-2">
                    {result && !result.passed && <ReportErrors errors={result.errors} />}
                    {"feature" in props.test ? (
                      <FeatureAssertionContent assertion={assertion as FeatureAssertion} />
                    ) : "variable" in props.test ? (
                      <VariableAssertionContent
                        assertion={assertion as VariableAssertion}
                        testKey={props.permalinkKey}
                        assertionLabel={expanded.label}
                        selectedPermalink={props.selectedPermalink}
                        setKey={props.setKey}
                        ownerVariable={(props.test as { variable: string }).variable}
                      />
                    ) : "scenario" in props.test ? (
                      <ScenarioAssertionContent
                        assertion={assertion as ScenarioAssertion}
                        testKey={props.permalinkKey}
                        assertionLabel={expanded.label}
                        selectedPermalink={props.selectedPermalink}
                        setKey={props.setKey}
                      />
                    ) : (
                      <SegmentAssertionContent assertion={assertion as SegmentAssertion} />
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function EntityTests(props: {
  tests: Test[];
  setKey?: string;
  entity?: { type: string; key: string };
  allTests?: Test[];
  reportSupplied?: boolean;
}) {
  const [searchParams] = useSearchParams();
  const selectedPermalink = searchParams.get("assertion") || undefined;
  const testKeyCounts = (props.allTests || props.tests).reduce<Map<string, number>>(
    (counts, test, index) => {
      const key = test.key || `test-${index + 1}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    },
    new Map(),
  );

  React.useEffect(() => {
    if (!selectedPermalink) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(getAssertionElementId(selectedPermalink))
        ?.scrollIntoView({ block: "start" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedPermalink, props.tests]);

  return (
    <div className="space-y-10">
      {props.tests.map((test, index) => {
        const testKey = test.key || `test-${index + 1}`;
        const permalinkKey =
          (testKeyCounts.get(testKey) || 0) > 1
            ? `${"scenario" in test ? "scenario" : "test"}:${testKey}`
            : testKey;

        return (
          <TestSpec
            key={permalinkKey}
            test={test}
            index={index}
            permalinkKey={permalinkKey}
            selectedPermalink={selectedPermalink}
            entity={props.entity}
            setKey={props.setKey}
            reportSupplied={props.reportSupplied}
          />
        );
      })}
    </div>
  );
}
