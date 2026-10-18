import * as React from "react";
import { Link } from "react-router-dom";
import type { Test } from "@featurevisor/types";
import { getEntityRoute, entityLabels } from "../entityTypes";
import { getTestReferences, type TestEntityReference } from "../testReferences";
import type { EntityDetail } from "../types";

export function getTestCheckRoute(key: string, permalink: string, setKey?: string) {
  return `${getEntityRoute("test", key, setKey)}?${new URLSearchParams({ assertion: permalink })}`;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "54 checks across 18 cases" reads better than a bare count that dwarfs the case count. */
export function describeCheckCount(checks: number, cases: number, caseNoun: string) {
  return cases > 1
    ? `${plural(checks, "check")} across ${plural(cases, caseNoun)}`
    : plural(checks, "check");
}

export function TestReferences(props: {
  test: Test;
  setKey?: string;
  entity?: { type: string; key: string };
}) {
  const groups = new Map<string, Map<string, TestEntityReference>>();
  for (const reference of getTestReferences(props.test)) {
    if (
      props.entity &&
      (reference.type !== props.entity.type || reference.key !== props.entity.key)
    )
      continue;
    const id = JSON.stringify([reference.type, reference.key]);
    const group = groups.get(id) || new Map<string, TestEntityReference>();
    // One check can refer to the same entity through both operands.
    group.set(JSON.stringify([reference.permalink, reference.reason]), reference);
    groups.set(id, group);
  }
  if (!groups.size) return null;
  // A spec that simply belongs to its entity needs no explanation: on the entity's page
  // it is obvious, and on the spec's own page the header already names the entity.
  if (
    [...groups.values()].every((group) =>
      [...group.values()].every(
        (reference) => !reference.permalink && /own/i.test(reference.reason),
      ),
    )
  ) {
    return null;
  }
  const testKey = props.test.key || ("scenario" in props.test ? props.test.scenario : "");
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3
        className="text-xs font-semibold text-muted"
        title="Declared references, not test results or proof of coverage"
      >
        {props.entity ? "Referenced here through" : "Entities in this spec"}
      </h3>
      {[...groups.entries()].map(([id, group]) => {
        const references = [...group.values()];
        const first = references[0];
        const checks = references.filter((reference) => reference.permalink);
        return (
          <div key={id} className="space-y-2 text-sm">
            <Link
              className="text-primary hover:underline [overflow-wrap:anywhere]"
              to={getEntityRoute(first.type, first.key, props.setKey)}
            >
              {entityLabels[first.type].singular}: <span className="font-mono">{first.key}</span>
            </Link>
            <div className="text-xs text-muted">
              {[...new Set(references.map((reference) => reference.reason))].join(" · ")}
            </div>
            {checks.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-primary">
                  {describeCheckCount(
                    new Set(checks.map((reference) => reference.permalink)).size,
                    new Set(checks.map((reference) => reference.caseLabel)).size,
                    "scenario" in props.test ? "case" : "assertion",
                  )}
                </summary>
                <ul className="mt-2 space-y-2 pl-3">
                  {checks.map((reference, index) => (
                    <li key={index}>
                      <Link
                        className="text-xs text-primary hover:underline"
                        to={getTestCheckRoute(testKey, reference.permalink!, props.setKey)}
                      >
                        {"scenario" in props.test ? "Case" : "Assertion"} {reference.caseLabel} ·{" "}
                        {reference.checkLabel}: {reference.reason}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function RelatedScenarios(props: {
  scenarios: NonNullable<EntityDetail["relatedScenarios"]>;
  setKey?: string;
}) {
  if (!props.scenarios.length) return null;
  return (
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Related tests through dependencies ({props.scenarios.length})
      </summary>
      <p className="mt-3 text-sm text-muted">
        These scenarios test features or variables that use this segment, and these segment specs
        test segments built on it. They contain no explicit check for this segment and do not prove
        it was evaluated.
      </p>
      <ul className="mt-4 space-y-4">
        {props.scenarios.map((scenario) => (
          <li key={scenario.key} className="space-y-1">
            <Link
              className="font-mono text-sm text-primary hover:underline [overflow-wrap:anywhere]"
              to={getEntityRoute("test", scenario.key, props.setKey)}
            >
              {scenario.key}
            </Link>
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <span>Through:</span>
              {scenario.via.map((entity) => (
                <Link
                  key={JSON.stringify(entity)}
                  className="text-primary hover:underline"
                  to={getEntityRoute(entity.type, entity.key, props.setKey)}
                >
                  {entityLabels[entity.type].singular}: {entity.key}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
