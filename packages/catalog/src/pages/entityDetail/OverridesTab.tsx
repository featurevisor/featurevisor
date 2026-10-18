import * as React from "react";
import { Navigate, useParams } from "react-router-dom";

import type { EntityDetail } from "../../types";
import { Badge, EmptyState, EntityKey, MarkdownContent, TypeLabel } from "../../components/ui";
import { ConditionTree, RootConditionsBox } from "../../components/trees";
import { parseEntityConditions, type ConditionNode } from "../../components/conditionExpression";
import { VariableValueView } from "../../components/variables";
import { MutationView } from "../../components/mutations";
import {
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

export function VariableOverridesTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const entity = detail.entity as Record<string, any>;
  const environments = getEnvironmentItems(detail, "overrides");
  const selectedEnvironment = useSelectedEnvironment(environments, environmentKey);
  const rows = environments.length > 0 ? entity.overrides?.[selectedEnvironment] : entity.overrides;

  if (detail.type !== "variable") return <Navigate to=".." replace />;

  return (
    <VariableOverrideRows
      environments={environments}
      selectedEnvironment={selectedEnvironment}
      rows={Array.isArray(rows) ? rows : []}
      rowsByEnvironment={environments.length > 0 ? entity.overrides : undefined}
      preview={detail.accumulationPreview?.[environments.length > 0 ? selectedEnvironment : ""]}
      defaultValue={entity.defaultValue}
      composed={entity.compose !== undefined}
      alias={typeof entity.compose === "string"}
      gate={parseEntityConditions(entity)}
      observedPaths={
        detail.observedOverrides
          ? new Set(
              detail.observedOverrides
                .filter(
                  (item) =>
                    (environments.length === 0 && item.environment === null) ||
                    item.environment === selectedEnvironment,
                )
                .map((item) => JSON.stringify(item.path)),
            )
          : undefined
      }
      setKey={setKey}
    />
  );
}

interface VariableOverrideView {
  continue?: boolean;
  key?: string;
  description?: string;
  promotable?: boolean;
  conditions?: unknown;
  value?: unknown;
  mutate?: unknown;
  overrides?: VariableOverrideView[];
}

/** Show how the value builds up when every override matches, step by step. */
function AccumulationPreview(props: {
  steps: NonNullable<EntityDetail["accumulationPreview"]>[string];
  defaultValue: unknown;
}) {
  const lastApplied = props.steps.reduce((last, step, index) => (step.skipped ? last : index), -1);

  return (
    <details className="rounded-xl border border-border bg-elevated p-4" open>
      <summary className="cursor-pointer text-sm font-semibold text-text">
        Accumulation when every override matches
      </summary>
      <p className="mt-2 text-xs text-muted">
        Each step applies to the value before it. An override without{" "}
        <code className="font-mono">continue: true</code> stops its sibling group, so later siblings
        are skipped on this path. Real contexts may match only some overrides.
      </p>
      <ol className="mt-4 space-y-3 border-l border-border pl-4">
        <li>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Default value
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-primary">Show value</summary>
            <div className="mt-2">
              <VariableValueView value={props.defaultValue} />
            </div>
          </details>
        </li>
        {props.steps.map((step, index) => (
          <li key={`${step.path.join("/")}-${index}`} className={step.skipped ? "opacity-60" : ""}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-text">
                {step.path.join(" › ")}
              </span>
              {step.skipped ? (
                <Badge>skipped on this path</Badge>
              ) : step.continues ? (
                <Badge tone="info">continues</Badge>
              ) : (
                <Badge>stops sibling group</Badge>
              )}
              {step.error && <Badge tone="danger">{step.error}</Badge>}
            </div>
            {!step.skipped && (
              <details className="mt-1" open={index === lastApplied}>
                <summary className="cursor-pointer text-xs text-primary">
                  {index === lastApplied ? "Resulting value" : "Value after this step"}
                </summary>
                <div className="mt-2">
                  <VariableValueView value={step.value} />
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function hasContinue(rows: VariableOverrideView[]): boolean {
  return rows.some(
    (row) => row.continue === true || (Array.isArray(row.overrides) && hasContinue(row.overrides)),
  );
}

/** A wildcard condition matches every user. */
function isCatchAllOverride(row: VariableOverrideView) {
  return isEveryoneSelector(row.conditions);
}

function isScalar(value: unknown) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function VariableOverrideRows(props: {
  environments: string[];
  selectedEnvironment?: string;
  rows: VariableOverrideView[];
  rowsByEnvironment?: Record<string, unknown>;
  preview?: NonNullable<EntityDetail["accumulationPreview"]>[string];
  defaultValue?: unknown;
  composed?: boolean;
  alias?: boolean;
  /** Root conditions, checked before composition sources and overrides. */
  gate?: ConditionNode;
  observedPaths?: Set<string>;
  setKey?: string;
}) {
  const base = "overrides";
  const gated = props.gate !== undefined;
  useScrollToHash([base, props.selectedEnvironment, props.rows.length]);
  const { compared, setCompared } = useComparedEnvironments(props.environments);

  if (props.environments.length > 0 && props.selectedEnvironment) {
    const isKnown = props.environments.includes(props.selectedEnvironment);
    if (!isKnown) {
      return <Navigate to={`../${base}/${props.environments[0]}`} replace />;
    }
  }

  return (
    <div className="space-y-4">
      <EnvironmentPills
        base={base}
        environments={props.environments}
        selectedEnvironment={props.selectedEnvironment}
        compared={compared}
        onCompare={setCompared}
      />

      {compared && props.rowsByEnvironment ? (
        <EnvironmentComparison
          compared={compared}
          rowsByEnvironment={props.rowsByEnvironment}
          kind="overrides"
        />
      ) : (
        <>
          {props.gate && (
            <RootConditionsBox node={props.gate} setKey={props.setKey}>
              {props.composed
                ? "Checked before composition sources and overrides. The values below apply only when these conditions are met."
                : "Checked before overrides. The values below apply only when these conditions are met."}
            </RootConditionsBox>
          )}
          {!props.composed && props.preview && (
            <AccumulationPreview steps={props.preview} defaultValue={props.defaultValue} />
          )}
          {props.rows.length === 0 && (
            <EmptyState
              title="No overrides found"
              description={
                props.alias
                  ? gated
                    ? "Users who pass the root gate get the source variable value, including null."
                    : "Everyone gets the source variable value, including null."
                  : props.composed
                    ? gated
                      ? "Users who pass the root gate get the object assembled from the composition sources."
                      : "Everyone gets the object assembled from the composition sources."
                    : gated
                      ? "Users who pass the root gate get the default value."
                      : "Everyone gets the default value."
              }
            />
          )}
          {props.rows.length > 0 && (
            <p className="text-sm text-muted">
              {props.alias
                ? "The source variable is evaluated first. Overrides then run at runtime in order, replacing or mutating its value."
                : props.composed
                  ? "All composition sources are evaluated first. Overrides then run at runtime in order, replacing or mutating the assembled object."
                  : "Overrides are checked in order and the first match supplies the value."}
              {hasContinue(props.rows) &&
                " An override with continue lets later matches keep changing it."}
            </p>
          )}
          <div className="space-y-4">
            {props.rows.map((row, index) => (
              <VariableOverrideSection
                key={row.key || index}
                override={row}
                index={index}
                base={base}
                selectedEnvironment={props.selectedEnvironment}
                observedPaths={props.observedPaths}
                setKey={props.setKey}
              />
            ))}
            {/* An override for everyone catches every user, so nobody falls through it. */}
            {props.rows.length > 0 && !props.rows.some(isCatchAllOverride) && props.composed && (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
                {props.alias
                  ? "Users matched by no override keep the source variable value, including null."
                  : "Users matched by no override keep the object assembled from the composition sources."}
              </p>
            )}
            {props.rows.length > 0 && !props.rows.some(isCatchAllOverride) && !props.composed && (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">
                Users matched by no override get the default value{" "}
                {isScalar(props.defaultValue) ? (
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                    {JSON.stringify(props.defaultValue)}
                  </code>
                ) : (
                  "shown on Overview"
                )}
                .
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function VariableOverrideSection(props: {
  override: VariableOverrideView;
  index: number;
  depth?: number;
  base: string;
  selectedEnvironment?: string;
  ancestorKeys?: string[];
  observedPaths?: Set<string>;
  setKey?: string;
}) {
  const { override, index, depth = 0, setKey } = props;
  const ancestorKeys = props.ancestorKeys || [];
  const overrideKey = String(override.key || `#${index + 1}`);
  const keyPath = [...ancestorKeys, overrideKey];
  const overrideId = slugifyFragment(
    [props.base, props.selectedEnvironment, ...keyPath].filter(Boolean).join("-"),
  );
  const hasConditions = override.conditions !== undefined;
  const hasMutate = override.mutate !== undefined;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="group flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-elevated px-4 py-2.5">
        <TypeLabel>{depth > 0 ? "nested override" : "override"}</TypeLabel>
        <h2
          id={overrideId}
          className="scroll-mt-6 font-mono font-semibold [overflow-wrap:anywhere]"
        >
          <EntityKey value={overrideKey} className="font-semibold" />
        </h2>
        {props.observedPaths?.has(JSON.stringify(keyPath)) && (
          <Badge tone="success">observed in tests</Badge>
        )}
        {override.continue === true && <Badge tone="info">continues to next sibling</Badge>}
        {override.promotable === false && <Badge>not promotable</Badge>}
        <RulePermalink targetId={overrideId} label="Link to this override" />
      </header>

      <div className="divide-y divide-border">
        {override.description && (
          <div className="px-4 py-3">
            <MarkdownContent value={override.description} />
          </div>
        )}

        {hasConditions && (
          <div className="px-4 py-4">
            <OverrideBlock title="Conditions">
              <ConditionTree conditions={override.conditions as any} setKey={setKey} />
            </OverrideBlock>
          </div>
        )}

        <div className="px-4 py-4">
          <OverrideBlock title={hasMutate ? "Mutation" : "Value"}>
            {hasMutate ? (
              <MutationView value={override.mutate} />
            ) : (
              <VariableValueView value={override.value} />
            )}
          </OverrideBlock>
        </div>

        {override.overrides?.length ? (
          <div className="space-y-3 bg-elevated/60 px-4 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              Nested overrides
            </h3>
            {override.overrides.map((child, childIndex) => (
              <VariableOverrideSection
                key={child.key || childIndex}
                override={child}
                index={childIndex}
                depth={depth + 1}
                base={props.base}
                selectedEnvironment={props.selectedEnvironment}
                ancestorKeys={keyPath}
                observedPaths={props.observedPaths}
                setKey={setKey}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OverrideBlock(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        {props.title}
      </h3>
      {props.children}
    </div>
  );
}
