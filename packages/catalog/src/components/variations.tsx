import * as React from "react";

import { EntityKey } from "./ui";
import { ConditionTree, GroupSegmentTree } from "./trees";
import { isInlineVariableValue, VariableValueView } from "./variables";

type VariationRecord = Record<string, unknown>;
type VariableOverrideRecord = {
  value?: unknown;
  segments?: unknown;
  conditions?: unknown;
};

function VariationRollout(props: { value: number }) {
  const value = Math.max(0, Math.min(100, props.value));

  return (
    <div className="flex min-w-0 max-w-xs shrink-0 items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs font-semibold text-muted">{value}%</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-pill">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function VariationValue(props: { value: unknown }) {
  if (typeof props.value === "string") {
    return (
      <span className="font-mono text-base font-semibold text-text [overflow-wrap:anywhere]">
        {props.value}
      </span>
    );
  }

  return <VariableValueView value={props.value} />;
}

function VariableAssignment(props: { name: string; value: unknown }) {
  const inlineValue = isInlineVariableValue(props.value);

  return (
    <div className="rounded-md border border-border/70 bg-surface/80 p-3">
      <div className="font-mono text-sm font-semibold text-text">
        <EntityKey value={props.name} className="font-semibold" />
      </div>
      <div className={inlineValue ? "mt-2 text-sm" : "mt-2"}>
        {inlineValue ? (
          <p>
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">Value </span>
            <VariableValueView value={props.value} />
          </p>
        ) : (
          <>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Value</div>
            <VariableValueView value={props.value} />
          </>
        )}
      </div>
    </div>
  );
}

function VariableOverrideEntry(props: {
  override: VariableOverrideRecord;
  setKey?: string;
}) {
  const hasSegments = props.override.segments !== undefined;
  const hasConditions = props.override.conditions !== undefined;

  return (
    <div className="rounded-md border border-border/70 bg-surface/80 p-3">
      {hasSegments && (
        <div className="mb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Segments
          </div>
          <GroupSegmentTree segments={props.override.segments as any} setKey={props.setKey} />
        </div>
      )}
      {hasConditions && (
        <div className="mb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Conditions
          </div>
          <ConditionTree conditions={props.override.conditions as any} setKey={props.setKey} />
        </div>
      )}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Value</div>
        <VariableValueView value={props.override.value} />
      </div>
    </div>
  );
}

function VariableOverrideGroup(props: {
  name: string;
  overrides: VariableOverrideRecord[];
  setKey?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-sm font-semibold text-text">
        <EntityKey value={props.name} className="font-semibold" />
      </div>
      <div className="space-y-2">
        {props.overrides.map((override, index) => (
          <VariableOverrideEntry key={index} override={override} setKey={props.setKey} />
        ))}
      </div>
    </div>
  );
}

function sortedRecordEntries(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function VariationCard(props: { variation: VariationRecord; setKey?: string }) {
  const variation = props.variation;
  const variables = sortedRecordEntries(variation.variables as Record<string, unknown> | undefined);
  const variableOverrides = sortedRecordEntries(
    variation.variableOverrides as Record<string, unknown> | undefined,
  );
  const description =
    typeof variation.description === "string" && variation.description.trim().length > 0
      ? variation.description.trim()
      : undefined;

  return (
    <section className="rounded-lg border border-border bg-elevated/60 p-4 ring-1 ring-black/5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">Value</div>
          <div className="mt-1">
            <VariationValue value={variation.value} />
          </div>
        </div>
        {typeof variation.weight === "number" && <VariationRollout value={variation.weight} />}
      </div>

      {description && <p className="mt-3 text-sm text-muted">{description}</p>}

      {variables.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">
            Variables
          </h3>
          <div className="space-y-2">
            {variables.map(([name, value]) => (
              <VariableAssignment key={name} name={name} value={value} />
            ))}
          </div>
        </div>
      )}

      {variableOverrides.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">
            Variable overrides
          </h3>
          <div className="space-y-4">
            {variableOverrides.map(([name, overrides]) => (
              <VariableOverrideGroup
                key={name}
                name={name}
                overrides={Array.isArray(overrides) ? (overrides as VariableOverrideRecord[]) : []}
                setKey={props.setKey}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function FeatureVariationsList(props: {
  variations: VariationRecord[];
  setKey?: string;
}) {
  if (props.variations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {props.variations.map((variation, index) => (
        <VariationCard
          key={String(variation.value ?? index)}
          variation={variation}
          setKey={props.setKey}
        />
      ))}
    </div>
  );
}
