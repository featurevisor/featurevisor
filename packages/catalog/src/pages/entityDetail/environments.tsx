import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { EntityDetail } from "../../types";
import { EmptyState } from "../../components/ui";
import { MutationView } from "../../components/mutations";
import { parseConditions, describeConditions } from "../../components/conditionExpression";

export function getEnvironmentItems(detail: EntityDetail, tab: "rules" | "force" | "overrides") {
  const entity = detail.entity as Record<string, any>;
  const value = entity[tab];

  if (!value || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value).sort(sortEnvironmentKeys);
}

function getEnvironmentSortGroup(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.startsWith("dev")) {
    return 0;
  }

  if (normalized.startsWith("prod")) {
    return 2;
  }

  return 1;
}

function sortEnvironmentKeys(left: string, right: string) {
  const leftGroup = getEnvironmentSortGroup(left);
  const rightGroup = getEnvironmentSortGroup(right);

  if (leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }

  return left.localeCompare(right);
}

const ENVIRONMENT_STORAGE_KEY = "featurevisor-catalog:environment";

function readRememberedEnvironment() {
  try {
    return window.localStorage.getItem(ENVIRONMENT_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pick the environment from the URL when present, otherwise the last one the
 * viewer chose, so moving between tabs and entities keeps the same context.
 */
export function useSelectedEnvironment(environments: string[], environmentKey?: string) {
  React.useEffect(() => {
    if (!environmentKey || !environments.includes(environmentKey)) return;

    try {
      window.localStorage.setItem(ENVIRONMENT_STORAGE_KEY, environmentKey);
    } catch {
      // Storage can be unavailable in private windows; selection still works from the URL.
    }
  }, [environmentKey, environments]);

  if (environmentKey) return environmentKey;

  const remembered = readRememberedEnvironment();

  return remembered && environments.includes(remembered) ? remembered : environments[0];
}

export function useComparedEnvironments(environments: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("compare");
  const selected = raw ? raw.split(",").filter((item) => environments.includes(item)) : [];
  const compared = selected.length === 2 ? (selected as [string, string]) : undefined;

  function setCompared(value?: [string, string]) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("compare", value.join(","));
    else next.delete("compare");
    setSearchParams(next, { replace: true });
  }

  return { compared, setCompared };
}

export function EnvironmentPills(props: {
  base: string;
  environments: string[];
  selectedEnvironment?: string;
  compared?: [string, string];
  onCompare?: (value?: [string, string]) => void;
}) {
  if (props.environments.length === 0) {
    return null;
  }

  const canCompare = props.environments.length >= 2 && props.onCompare;

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {!props.compared &&
        props.environments.map((environment) => (
          <Link
            key={environment}
            to={`../${props.base}/${environment}`}
            className={[
              "inline-flex rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              environment === props.selectedEnvironment
                ? "border-header-active bg-header-active !text-header-text"
                : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400 hover:bg-slate-50",
            ].join(" ")}
          >
            {environment}
          </Link>
        ))}
      {props.compared && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[0, 1].map((position) => (
            <React.Fragment key={position}>
              {position === 1 && <span className="font-semibold text-faint">vs</span>}
              <select
                aria-label={position === 0 ? "First environment" : "Second environment"}
                value={props.compared![position]}
                onChange={(event) => {
                  const next = [...props.compared!] as [string, string];
                  next[position] = event.target.value;
                  props.onCompare?.(next);
                }}
                className="rounded-full border border-border bg-surface px-2.5 py-1 font-semibold text-text"
              >
                {props.environments.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment}
                  </option>
                ))}
              </select>
            </React.Fragment>
          ))}
        </div>
      )}
      {canCompare && (
        <button
          type="button"
          onClick={() => {
            if (props.compared) {
              props.onCompare?.(undefined);
              return;
            }
            const first = props.selectedEnvironment || props.environments[0];
            const second = props.environments.find((environment) => environment !== first)!;
            props.onCompare?.([first, second]);
          }}
          className="ml-auto inline-flex rounded-full border border-slate-300 bg-surface px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
        >
          {props.compared ? "Done comparing" : "Compare environments"}
        </button>
      )}
    </nav>
  );
}

function summarizeCondition(value: unknown) {
  const node = parseConditions(value);
  return node ? describeConditions(node) : "No conditions";
}

function truncate(value: string, length = 90) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

type SummaryLine = { label: string; text: string; content?: React.ReactNode };

function getDifferentKeys(left: unknown, right: unknown) {
  const a = (left || {}) as Record<string, unknown>;
  const b = (right || {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}

/** Labelled lines describing a rule, force entry or override, for side by side comparison. */
function summarizeRow(
  row: Record<string, unknown>,
  kind: "rules" | "force" | "overrides",
  other?: Record<string, unknown>,
): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const push = (label: string, text: string) => lines.push({ label, text });
  if (kind === "rules" && typeof row.percentage === "number")
    push("percentage", `${row.percentage}%`);
  if (row.conditions !== undefined) push("conditions", summarizeCondition(row.conditions));
  if (typeof row.enabled === "boolean") push("enabled", String(row.enabled));
  if (row.variation !== undefined) push("variation", String(row.variation));
  if (row.variationWeights && typeof row.variationWeights === "object")
    push(
      "weights",
      Object.entries(row.variationWeights)
        .map(([variation, weight]) => `${variation} ${weight}%`)
        .join(", "),
    );
  // A rule without its own allocation uses the feature's weights. Saying so keeps rows comparable.
  if (
    kind === "rules" &&
    row.enabled !== false &&
    row.variation === undefined &&
    !row.variationWeights
  )
    push("variation", "from feature weights");
  if (row.variables) {
    const keys = Object.keys(row.variables as object);
    const different = other ? getDifferentKeys(row.variables, other.variables) : [];
    push(
      "variables",
      different.length
        ? `${keys.length} set; different: ${different.join(", ")}`
        : `${keys.length} set`,
    );
  }
  if (row.value !== undefined) push("value", truncate(JSON.stringify(row.value)));
  if (row.mutate !== undefined)
    lines.push({
      label: "mutate",
      text: JSON.stringify(row.mutate),
      content: <MutationView value={row.mutate} nested />,
    });
  if (row.variableOverrides && typeof row.variableOverrides === "object") {
    for (const [name, overrides] of Object.entries(row.variableOverrides)) {
      if (!Array.isArray(overrides)) continue;
      overrides.forEach((override, index) => {
        if (!override || typeof override !== "object") return;
        lines.push({
          label: `variableOverrides ${name} #${index + 1}`,
          text: JSON.stringify(override),
          content:
            override.mutate !== undefined ? (
              <MutationView value={override.mutate} nested />
            ) : undefined,
        });
      });
    }
  }
  if (row.continue === true) push("continue", "true");
  if (Array.isArray(row.overrides)) push("nested", `${row.overrides.length} override(s)`);
  return lines;
}

function comparableRow(row: Record<string, unknown>) {
  // Descriptions are documentation, not behaviour, so they never count as a difference.
  return JSON.stringify({ ...row, description: undefined });
}

export function EnvironmentComparison(props: {
  compared: [string, string];
  rowsByEnvironment: Record<string, unknown>;
  kind: "rules" | "force" | "overrides";
}) {
  const [left, right] = props.compared;
  const rowsFor = (environment: string) => {
    const rows = props.rowsByEnvironment?.[environment];
    return (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
  };
  const keyOf = (row: Record<string, unknown>, index: number) =>
    typeof row.key === "string" ? row.key : `#${index + 1}`;
  const leftRows = new Map(rowsFor(left).map((row, index) => [keyOf(row, index), row]));
  const rightRows = new Map(rowsFor(right).map((row, index) => [keyOf(row, index), row]));
  // Rows are paired by key. Order also matters, since the first match wins, so show it.
  const positionIn = (rows: Map<string, unknown>, key: string) => {
    const position = [...rows.keys()].indexOf(key);
    return position === -1 ? "none" : `#${position + 1}`;
  };
  const keys = [...new Set([...leftRows.keys(), ...rightRows.keys()])];
  const differences = keys.filter((key) => {
    const a = leftRows.get(key);
    const b = rightRows.get(key);
    return !a || !b || comparableRow(a) !== comparableRow(b);
  }).length;

  if (keys.length === 0) {
    return <EmptyState title={`No ${props.kind} in either environment`} />;
  }

  const cell = (
    row: Record<string, unknown> | undefined,
    other: Record<string, unknown> | undefined,
  ) => {
    if (!row) {
      return (
        <td className="bg-amber-50 px-3 py-2 align-top">
          <span className="text-xs text-muted">Not defined</span>
        </td>
      );
    }

    const lines = summarizeRow(row, props.kind, other);
    const otherLines = other ? summarizeRow(other, props.kind, row) : [];
    const plain = (line: SummaryLine) =>
      line.label === "variables" ? line.text.split(";")[0] : line.text;

    return (
      <td className="px-3 py-2 align-top">
        <ul className="space-y-0.5 font-mono text-xs text-text">
          {lines.map((line) => {
            const counterpart = otherLines.find((item) => item.label === line.label);
            const differs =
              !counterpart ||
              plain(counterpart) !== plain(line) ||
              (line.label === "variables" && line.text.includes("different"));
            return (
              <li
                key={line.label}
                className={[
                  "rounded px-1 [overflow-wrap:anywhere]",
                  differs ? "bg-amber-100" : "",
                ].join(" ")}
              >
                <span className="text-faint">{line.label}:</span> {line.content ?? line.text}
              </li>
            );
          })}
        </ul>
      </td>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        {differences === 0
          ? "Both environments are identical."
          : `${differences} of ${keys.length} ${props.kind === "overrides" ? "overrides" : props.kind === "force" ? "force entries" : "rules"} differ. Differences are highlighted.`}{" "}
        {props.kind === "force"
          ? "Entries are paired by position."
          : `${props.kind === "overrides" ? "Overrides" : "Rules"} are paired by key.`}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
            <tr>
              <th className="w-32 px-3 py-2">Key</th>
              <th className="px-3 py-2">{left}</th>
              <th className="px-3 py-2">{right}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.map((key) => {
              const a = leftRows.get(key);
              const b = rightRows.get(key);
              const differs = !a || !b || comparableRow(a) !== comparableRow(b);
              return (
                <tr key={key}>
                  <td className="px-3 py-2 align-top font-mono text-xs font-semibold [overflow-wrap:anywhere]">
                    {key}
                    <div
                      className="mt-0.5 font-sans text-[10px] font-normal text-faint"
                      title={`Position in ${left} and ${right}`}
                    >
                      {positionIn(leftRows, key)} · {positionIn(rightRows, key)}
                      {!differs && " · identical"}
                    </div>
                  </td>
                  {cell(a, b)}
                  {cell(b, a)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
