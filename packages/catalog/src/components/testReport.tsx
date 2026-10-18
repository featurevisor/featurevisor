import * as React from "react";

import type { CatalogManifest } from "../types";
import { Badge } from "./ui";

const COUNTER_LABELS: Record<string, string> = {
  entityAssertions: "Assertions",
  scenarioCases: "Scenario cases",
};

/** Pass and fail totals from the `featurevisor test --json` report the Catalog was exported with. */
export function TestReportSummary(props: {
  report: NonNullable<CatalogManifest["testReport"]>;
  action?: React.ReactNode;
}) {
  const counters = Object.entries(props.report.summary).filter(
    ([key, value]) => COUNTER_LABELS[key] && value.passed + value.failed > 0,
  );
  const passed = counters.reduce((total, [, value]) => total + value.passed, 0);
  const failed = counters.reduce((total, [, value]) => total + value.failed, 0);
  const total = passed + failed;
  const current = props.report.verification === "current";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Badge tone={current ? (props.report.passed ? "success" : "danger") : "neutral"}>
          {current
            ? props.report.passed
              ? "✓ Reported cases passed"
              : "✗ Some reported cases failed"
            : `Historical report (${props.report.verification === "stale" ? "stale inputs" : "unverified inputs"})`}
        </Badge>
        {counters.map(([key, value]) => (
          <span key={key} className="text-muted">
            {COUNTER_LABELS[key]}{" "}
            <span className="font-semibold tabular-nums text-text">{value.passed}</span> passed
            {value.failed > 0 && (
              <>
                , <span className="font-semibold tabular-nums text-rose-700">{value.failed}</span>{" "}
                failed
              </>
            )}
          </span>
        ))}
        {props.report.hasCoverage && <Badge tone="info">with coverage</Badge>}
        {props.action && <span className="ml-auto">{props.action}</span>}
      </div>
      {props.report.cases && props.report.cases.executed < props.report.cases.total && (
        <p className="text-xs text-muted">
          This report covers {props.report.cases.executed} of {props.report.cases.total} cases.
        </p>
      )}
      {current && total > 0 && (
        <div
          className="flex h-1.5 overflow-hidden rounded-full bg-slate-200"
          role="img"
          aria-label={`${passed} of ${total} passed`}
        >
          <div className="bg-emerald-500" style={{ width: `${(passed / total) * 100}%` }} />
          <div className="bg-rose-500" style={{ width: `${(failed / total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
