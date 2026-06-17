import * as React from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { EntityKey } from "./ui";
import { ConditionTree, GroupSegmentTree } from "./trees";
import { isInlineVariableValue, slugifyFragment, VariablePermalink, VariableValueView } from "./variables";

type VariationRecord = Record<string, unknown>;
type VariableOverrideRecord = {
  value?: unknown;
  segments?: unknown;
  conditions?: unknown;
};

const VARIABLES_PARAM = "variables";
const OVERRIDES_PARAM = "overrides";

function setSearchParam(searchParams: URLSearchParams, key: string, value?: string) {
  const next = new URLSearchParams(searchParams);

  if (!value) {
    next.delete(key);
  } else {
    next.set(key, value);
  }

  return next;
}

function parseListParam(value: string | null) {
  if (!value) {
    return new Set<string>();
  }

  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function formatListParam(values: Set<string>) {
  if (values.size === 0) {
    return undefined;
  }

  return Array.from(values).sort().join(",");
}

function getVariationSlug(variation: VariationRecord) {
  return slugifyFragment(String(variation.value ?? "variation"));
}

function getVariationVariableId(variationSlug: string, variableName: string) {
  return `${variationSlug}-variables-${slugifyFragment(variableName)}`;
}

function getVariationOverrideId(variationSlug: string, variableName: string) {
  return `${variationSlug}-overrides-${slugifyFragment(variableName)}`;
}

function parseVariationHash(hash: string) {
  const variablesMatch = hash.match(/^(.+)-variables-(.+)$/);

  if (variablesMatch) {
    return {
      variationSlug: variablesMatch[1],
      section: VARIABLES_PARAM as typeof VARIABLES_PARAM,
    };
  }

  const overridesMatch = hash.match(/^(.+)-overrides-(.+)$/);

  if (overridesMatch) {
    return {
      variationSlug: overridesMatch[1],
      section: OVERRIDES_PARAM as typeof OVERRIDES_PARAM,
    };
  }

  return null;
}

function useScrollToHash(dependencies: React.DependencyList) {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) {
      return;
    }

    const targetId = decodeURIComponent(window.location.hash.slice(1));

    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const targetElement = document.getElementById(targetId);

      if (!targetElement) {
        return;
      }

      targetElement.scrollIntoView({ block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, dependencies);
}

function useExpandSectionsFromHash(props: {
  variations: VariationRecord[];
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams) => void;
}) {
  const location = useLocation();

  React.useEffect(() => {
    const hash = decodeURIComponent(location.hash.slice(1));
    const parsed = parseVariationHash(hash);

    if (!parsed) {
      return;
    }

    const variationExists = props.variations.some(
      (variation) => getVariationSlug(variation) === parsed.variationSlug,
    );

    if (!variationExists) {
      return;
    }

    const expanded = parseListParam(props.searchParams.get(parsed.section));

    if (expanded.has(parsed.variationSlug)) {
      return;
    }

    const next = new Set(expanded);
    next.add(parsed.variationSlug);
    props.setSearchParams(setSearchParam(props.searchParams, parsed.section, formatListParam(next)));
  }, [location.hash, props.searchParams, props.setSearchParams, props.variations]);
}

function SectionCaret(props: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      fill="none"
      className={[
        "h-3 w-3 shrink-0 text-muted transition-transform",
        props.expanded ? "rotate-180" : "",
      ].join(" ")}
    >
      <path
        d="M3.25 4.5 6 7.25 8.75 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CollapsibleSection(props: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md py-1 text-left hover:bg-surface/80"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <SectionCaret expanded={props.expanded} />
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          {props.title}
          <span className="ml-1.5 font-medium text-muted">({props.count})</span>
        </span>
      </button>
      {props.expanded ? <div className="mt-2">{props.children}</div> : null}
    </div>
  );
}

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

function VariableAssignment(props: { id: string; name: string; value: unknown }) {
  const inlineValue = isInlineVariableValue(props.value);

  return (
    <div
      id={props.id}
      className="group scroll-mt-6 rounded-md border border-border/70 bg-surface/80 p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 font-mono text-sm font-semibold text-text">
          <a
            href={`#${props.id}`}
            className="text-text no-underline hover:text-primary [overflow-wrap:anywhere]"
          >
            <EntityKey value={props.name} className="font-semibold" />
          </a>
        </div>
        <VariablePermalink targetId={props.id} />
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
  id: string;
  name: string;
  overrides: VariableOverrideRecord[];
  setKey?: string;
}) {
  return (
    <div id={props.id} className="group scroll-mt-6 space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 font-mono text-sm font-semibold text-text">
          <a
            href={`#${props.id}`}
            className="text-text no-underline hover:text-primary [overflow-wrap:anywhere]"
          >
            <EntityKey value={props.name} className="font-semibold" />
          </a>
        </div>
        <VariablePermalink targetId={props.id} label="Link to this override" />
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

function VariationCard(props: {
  variation: VariationRecord;
  variationSlug: string;
  variablesExpanded: boolean;
  overridesExpanded: boolean;
  onToggleVariables: () => void;
  onToggleOverrides: () => void;
  setKey?: string;
}) {
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
        <CollapsibleSection
          title="Variables"
          count={variables.length}
          expanded={props.variablesExpanded}
          onToggle={props.onToggleVariables}
        >
          <div className="space-y-2">
            {variables.map(([name, value]) => (
              <VariableAssignment
                key={name}
                id={getVariationVariableId(props.variationSlug, name)}
                name={name}
                value={value}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {variableOverrides.length > 0 && (
        <CollapsibleSection
          title="Variable overrides"
          count={variableOverrides.length}
          expanded={props.overridesExpanded}
          onToggle={props.onToggleOverrides}
        >
          <div className="space-y-4">
            {variableOverrides.map(([name, overrides]) => (
              <VariableOverrideGroup
                key={name}
                id={getVariationOverrideId(props.variationSlug, name)}
                name={name}
                overrides={Array.isArray(overrides) ? (overrides as VariableOverrideRecord[]) : []}
                setKey={props.setKey}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </section>
  );
}

export function FeatureVariationsList(props: {
  variations: VariationRecord[];
  setKey?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const expandedVariables = React.useMemo(
    () => parseListParam(searchParams.get(VARIABLES_PARAM)),
    [searchParams],
  );
  const expandedOverrides = React.useMemo(
    () => parseListParam(searchParams.get(OVERRIDES_PARAM)),
    [searchParams],
  );

  useExpandSectionsFromHash({
    variations: props.variations,
    searchParams,
    setSearchParams,
  });
  useScrollToHash([props.variations.length, searchParams.toString(), location.hash]);

  if (props.variations.length === 0) {
    return null;
  }

  function toggleSection(param: string, slug: string, expanded: Set<string>) {
    const next = new Set(expanded);

    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
    }

    setSearchParams(setSearchParam(searchParams, param, formatListParam(next)));
  }

  return (
    <div className="space-y-4">
      {props.variations.map((variation, index) => {
        const variationSlug = getVariationSlug(variation);

        return (
          <VariationCard
            key={String(variation.value ?? index)}
            variation={variation}
            variationSlug={variationSlug}
            variablesExpanded={expandedVariables.has(variationSlug)}
            overridesExpanded={expandedOverrides.has(variationSlug)}
            onToggleVariables={() =>
              toggleSection(VARIABLES_PARAM, variationSlug, expandedVariables)
            }
            onToggleOverrides={() =>
              toggleSection(OVERRIDES_PARAM, variationSlug, expandedOverrides)
            }
            setKey={props.setKey}
          />
        );
      })}
    </div>
  );
}
