import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  FeatureAssertion,
  SegmentAssertion,
  Test,
  TestFeature,
  TestSegment,
} from "@featurevisor/types";

import { Badge, EmptyState, EntityKey, LabelValueBadge, MarkdownContent } from "./ui";
import { expandTestAssertions, getTestAssertionPermalink } from "../testModel";

function getAssertionElementId(permalink: string) {
  return `assertion-${encodeURIComponent(permalink)}`;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null;
}

function ValueDisplay(props: { value: unknown }) {
  if (props.value === undefined || props.value === null) {
    return <span className="text-faint">not set</span>;
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
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
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

function TestDataPanel(props: { title: string; value: unknown; className?: string }) {
  if (!hasValue(props.value)) {
    return null;
  }

  return (
    <section
      className={`min-w-0 rounded-xl border border-border bg-elevated p-4 ${props.className || ""}`}
    >
      <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
      </h4>
      <ValueDisplay value={props.value} />
    </section>
  );
}

function AssertionPermalink(props: { permalink: string; label: string }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set("assertion", props.permalink);

  return (
    <Link
      to={{ pathname: location.pathname, search: `?${search.toString()}` }}
      aria-label={`Link to assertion ${props.label}`}
      title="Link to this assertion"
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
        <LabelValueBadge label="Environment" value={assertion.environment || "none"} compact />
        {assertion.target && <LabelValueBadge label="Target" value={assertion.target} compact />}
        {hasValue(assertion.at) && (
          <LabelValueBadge label="Bucket" value={`${assertion.at}%`} compact />
        )}
      </div>

      <div className="space-y-4">
        <TestDataPanel title="Context" value={assertion.context || {}} />
        <TestDataPanel title="Expected" value={expectations} />
        {Object.keys(defaults).length > 0 && <TestDataPanel title="Defaults" value={defaults} />}
        {assertion.sticky && <TestDataPanel title="Sticky features" value={assertion.sticky} />}
      </div>

      {assertion.children?.length ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-faint">
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
      <section className="rounded-xl border border-border bg-elevated p-4">
        <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-faint">
          Expected
        </h4>
        <Badge tone={props.assertion.expectedToMatch ? "success" : "neutral"}>
          {props.assertion.expectedToMatch ? "Matches segment" : "Does not match segment"}
        </Badge>
      </section>
    </div>
  );
}

function TestSpec(props: { test: Test; index: number; selectedPermalink?: string }) {
  const testKey = props.test.key || `test-${props.index + 1}`;
  const assertions = expandTestAssertions(props.test);
  const authoredCount = props.test.assertions.length;
  const hasMatrix = props.test.assertions.some((assertion) => Boolean(assertion.matrix));

  return (
    <section className="space-y-5">
      <header className="flex flex-col justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
            Test spec {props.index + 1}
          </div>
          <h2 className="mt-1 font-mono text-sm font-semibold [overflow-wrap:anywhere]">
            <EntityKey value={testKey} />
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.test.promotable === false && <Badge>not promotable</Badge>}
          <Badge>{authoredCount} authored</Badge>
          {hasMatrix && <Badge tone="primary">{assertions.length} applied</Badge>}
        </div>
      </header>

      {assertions.length === 0 ? (
        <EmptyState title="No assertions found in this test spec" />
      ) : (
        <div className="space-y-5">
          {assertions.map((expanded) => {
            const permalink = getTestAssertionPermalink(testKey, expanded.label);
            const selected = props.selectedPermalink === permalink;
            const assertion = expanded.assertion;

            return (
              <article
                id={getAssertionElementId(permalink)}
                key={permalink}
                className={[
                  "scroll-mt-6 space-y-4 rounded-2xl border bg-surface p-5 transition-shadow",
                  selected ? "border-primary ring-2 ring-primary/20" : "border-border",
                ].join(" ")}
              >
                <header className="space-y-2">
                  <div className="group flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="font-semibold">Assertion {expanded.label}</h3>
                      {hasValue(expanded.caseIndex) && (
                        <Badge tone="primary">
                          Matrix case {(expanded.caseIndex as number) + 1} of {expanded.caseCount}
                        </Badge>
                      )}
                    </div>
                    <div className="shrink-0">
                      <AssertionPermalink permalink={permalink} label={expanded.label} />
                    </div>
                  </div>
                  {assertion.description && <MarkdownContent value={assertion.description} />}
                </header>

                {expanded.matrixValues && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                      Matrix values
                    </span>
                    {Object.entries(expanded.matrixValues).map(([key, value]) => (
                      <LabelValueBadge key={key} label={key} value={String(value)} compact />
                    ))}
                  </div>
                )}

                {"feature" in props.test ? (
                  <FeatureAssertionContent assertion={assertion as FeatureAssertion} />
                ) : (
                  <SegmentAssertionContent assertion={assertion as SegmentAssertion} />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function EntityTests(props: { tests: Test[] }) {
  const [searchParams] = useSearchParams();
  const selectedPermalink = searchParams.get("assertion") || undefined;

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
      {props.tests.map((test, index) => (
        <TestSpec
          key={test.key || index}
          test={test as TestFeature | TestSegment}
          index={index}
          selectedPermalink={selectedPermalink}
        />
      ))}
    </div>
  );
}
