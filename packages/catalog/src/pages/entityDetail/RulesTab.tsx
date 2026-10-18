import * as React from "react";
import { Navigate, useParams } from "react-router-dom";

import {
  Badge,
  EmptyState,
  EntityKey,
  OverviewChip,
  MarkdownContent,
  TypeLabel,
} from "../../components/ui";
import { ConditionTree, RootConditionsBox } from "../../components/trees";
import { RuleOutcome } from "../../components/variations";
import { parseEntityConditions, type ConditionNode } from "../../components/conditionExpression";
import {
  FormattedValue,
  RulePermalink,
  isEveryoneSelector,
  slugifyFragment,
  useEntityDetail,
  useScrollToHash,
} from "./shared";
import {
  EnvironmentComparison,
  EnvironmentPills,
  getEnvironmentItems,
  useComparedEnvironments,
  useSelectedEnvironment,
} from "./environments";

export function FeatureRulesTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "rules");
  const selectedEnvironment = useSelectedEnvironment(environments, environmentKey);
  const rules = environments.length > 0 ? entity.rules?.[selectedEnvironment] : entity.rules;
  const expose = environments.length > 0 ? entity.expose?.[selectedEnvironment] : entity.expose;

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  return (
    <FeatureRows
      title="Rules"
      base="rules"
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={rules || []}
      rowsByEnvironment={environments.length > 0 ? entity.rules : undefined}
      expose={expose}
      requirement={parseEntityConditions(entity)}
      featureVariations={Array.isArray(entity.variations) ? entity.variations : undefined}
      showFallthrough
      forceDecides={hasDecidingForce(
        environments.length > 0 ? entity.force?.[selectedEnvironment] : entity.force,
      )}
      observedRuleKeys={
        detail.observedRules
          ? new Set(
              detail.observedRules
                .filter(
                  (item) =>
                    (environments.length === 0 && item.environment === null) ||
                    item.environment === selectedEnvironment,
                )
                .map((item) => item.ruleKey),
            )
          : undefined
      }
      setKey={setKey}
    />
  );
}

export function FeatureForceTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "force");
  const selectedEnvironment = useSelectedEnvironment(environments, environmentKey);
  const rows = environments.length > 0 ? entity.force?.[selectedEnvironment] : entity.force;

  if (detail.type !== "feature") return <Navigate to=".." replace />;

  return (
    <FeatureRows
      title="Force"
      emptyTitle="No forced rules found"
      base="force"
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={rows || []}
      rowsByEnvironment={environments.length > 0 ? entity.force : undefined}
      setKey={setKey}
    />
  );
}

function FeatureRows(props: {
  title: string;
  emptyTitle?: string;
  base: string;
  environments: string[];
  selectedEnvironment?: string;
  rows: any[];
  rowsByEnvironment?: Record<string, unknown>;
  expose?: unknown;
  /** Rules only: requirements are checked before rules, while forced values bypass them. */
  requirement?: ConditionNode;
  /** Rules only: show what happens to users who match no rule. */
  showFallthrough?: boolean;
  /** Rules only: a force entry sets enabled, so it can decide before requirements and rules. */
  forceDecides?: boolean;
  /** Rules only: the feature's variations, which rules without their own allocation use. */
  featureVariations?: Array<{ value?: unknown; weight?: unknown }>;
  observedRuleKeys?: Set<string>;
  setKey?: string;
}) {
  useScrollToHash([props.base, props.selectedEnvironment, props.rows.length]);
  const { compared, setCompared } = useComparedEnvironments(props.environments);

  if (props.environments.length > 0 && props.selectedEnvironment) {
    const isKnown = props.environments.includes(props.selectedEnvironment);
    if (!isKnown) {
      return <Navigate to={`../${props.base}/${props.environments[0]}`} replace />;
    }
  }

  return (
    <div className="space-y-4">
      <EnvironmentPills
        base={props.base}
        environments={props.environments}
        selectedEnvironment={props.selectedEnvironment}
        compared={compared}
        onCompare={setCompared}
      />

      {compared && props.rowsByEnvironment ? (
        <EnvironmentComparison
          compared={compared}
          rowsByEnvironment={props.rowsByEnvironment}
          kind={props.base === "force" ? "force" : "rules"}
        />
      ) : (
        <>
          {typeof props.expose !== "undefined" && (
            <ExposeNotice
              expose={props.expose}
              environment={props.environments.length > 0 ? props.selectedEnvironment : undefined}
            />
          )}

          {props.requirement && (
            <RootConditionsBox node={props.requirement} setKey={props.setKey}>
              Checked before these rules. When they are not met, the feature is disabled.
              {props.forceDecides &&
                " Force entries are checked first and apply even when these conditions are not met."}
            </RootConditionsBox>
          )}

          {props.rows.length === 0 && (
            <EmptyState
              title={props.emptyTitle || `No ${props.title.toLowerCase()} found`}
              description={
                props.showFallthrough
                  ? props.forceDecides
                    ? "Only force entries can enable it here. Everyone they do not match gets the feature disabled."
                    : props.environments.length > 0
                      ? `The feature is disabled for everyone in ${props.selectedEnvironment}.`
                      : "The feature is disabled for everyone."
                  : undefined
              }
            />
          )}
          <div className="space-y-4">
            {props.rows.map((row, index) => {
              const ruleKey = String(row.key || `#${index + 1}`);
              const ruleId = slugifyFragment(
                [props.base, props.selectedEnvironment, ruleKey].filter(Boolean).join("-"),
              );

              return (
                <section
                  key={row.key || index}
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  <header className="flex min-w-0 items-center justify-between gap-4 border-b border-border bg-elevated px-4 py-2.5">
                    <div className="group flex min-w-0 flex-wrap items-center gap-2">
                      <TypeLabel>{props.base === "force" ? "force" : "rule"}</TypeLabel>
                      <h2
                        id={ruleId}
                        className="scroll-mt-6 font-mono font-semibold [overflow-wrap:anywhere]"
                      >
                        <EntityKey value={ruleKey} className="font-semibold" />
                      </h2>
                      {props.observedRuleKeys?.has(ruleKey) && (
                        <Badge tone="success">observed in tests</Badge>
                      )}
                      {row.promotable === false && <Badge>not promotable</Badge>}
                      <RulePermalink targetId={ruleId} />
                    </div>
                    {typeof row.percentage === "number" && <RuleProgress value={row.percentage} />}
                  </header>

                  <div className="divide-y divide-border">
                    {(row.summary || row.description) && (
                      <div className="space-y-1 px-4 py-3">
                        {row.summary && <p className="text-sm text-muted">{row.summary}</p>}
                        {row.description && <MarkdownContent value={row.description} />}
                      </div>
                    )}

                    <div className="space-y-2 px-4 py-4">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                        Conditions
                      </h3>
                      <ConditionTree conditions={row.conditions} setKey={props.setKey} />
                    </div>

                    <RuleOutcome
                      row={row}
                      idPrefix={ruleId}
                      setKey={props.setKey}
                      className="px-4 py-4"
                      ruleDefaults={
                        props.base === "rules" ? { variations: props.featureVariations } : undefined
                      }
                    />
                  </div>
                </section>
              );
            })}
            {/* A rule for everyone catches every user, so nobody falls through it. */}
            {props.showFallthrough &&
              props.rows.length > 0 &&
              !props.rows.some((row) => isEveryoneSelector(row.conditions)) && (
                <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
                  {props.forceDecides
                    ? "Users matched by no force entry and no rule above get the feature disabled."
                    : "Users who match no rule above get the feature disabled."}
                </p>
              )}
          </div>
        </>
      )}
    </div>
  );
}

/** Force entries are evaluated before requirements and rules, and decide the flag when they set enabled. */
function hasDecidingForce(force: unknown) {
  return (
    Array.isArray(force) &&
    force.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as { enabled?: unknown }).enabled === "boolean",
    )
  );
}

/** Plain language for `expose`, which decides whether datafiles include the feature at all. */
function ExposeNotice(props: { expose: unknown; environment?: string }) {
  const scope = props.environment ? `Datafiles for ${props.environment}` : "Datafiles";
  let title: string;
  let body: React.ReactNode;

  if (props.expose === false) {
    title = "Not exposed";
    body = `${scope} leave this feature out, so applications cannot evaluate it there. The rules below stay in the definition.`;
  } else if (props.expose === true) {
    title = "Exposed";
    body = `${scope} include this feature.`;
  } else if (Array.isArray(props.expose)) {
    title = "Exposed to selected tags only";
    body = (
      <>
        <span>
          {scope} built by targets that select these tags include this feature. Targets without tag
          selectors still include it.
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {props.expose.map((tag) => (
            <OverviewChip key={String(tag)}>#{String(tag)}</OverviewChip>
          ))}
        </span>
      </>
    );
  } else {
    title = "Exposure";
    body = <FormattedValue value={props.expose} />;
  }

  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 flex flex-col text-amber-900/90">{body}</div>
    </div>
  );
}

function RuleProgress(props: { value: number }) {
  const value = Math.max(0, Math.min(100, props.value));

  return (
    <div className="flex w-2/5 min-w-0 max-w-sm shrink-0 items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs font-semibold text-muted">{value}%</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
