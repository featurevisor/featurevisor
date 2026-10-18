import * as React from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Badge, EntityKey, TypeLabel } from "./ui";
import { ConditionTree } from "./trees";
import { slugifyFragment, VariablePermalink, VariableValueView } from "./variables";
import { MutationView } from "./mutations";

type VariationRecord = Record<string, unknown>;
type VariableOverrideRecord = {
  key?: string;
  description?: string;
  value?: unknown;
  mutate?: unknown;
  conditions?: unknown;
};

const VARIABLES_PARAM = "variables";
const OVERRIDES_PARAM = "overrides";
/** Short sections start open. These list the ones a reader closed. */
const CLOSED_PARAMS = {
  [VARIABLES_PARAM]: "variables-closed",
  [OVERRIDES_PARAM]: "overrides-closed",
} as const;
const OPEN_BY_DEFAULT_LIMIT = 5;

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

export function getVariationSlug(variation: VariationRecord) {
  return slugifyFragment(String(variation.value ?? "variation"));
}

export function getVariationVariableId(variationSlug: string, variableName: string) {
  return `${variationSlug}-variables-${slugifyFragment(variableName)}`;
}

export function getVariationOverrideId(variationSlug: string, variableName: string) {
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
}) {
  const location = useLocation();
  const navigate = useNavigate();

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
    const closedParam = CLOSED_PARAMS[parsed.section];
    const closed = parseListParam(props.searchParams.get(closedParam));

    if (expanded.has(parsed.variationSlug) && !closed.has(parsed.variationSlug)) {
      return;
    }

    const next = new Set(expanded);
    next.add(parsed.variationSlug);
    closed.delete(parsed.variationSlug);
    const search = setSearchParam(
      setSearchParam(props.searchParams, parsed.section, formatListParam(next)),
      closedParam,
      formatListParam(closed),
    );

    // Keep the anchor while expanding, so the scroll to it still happens afterwards.
    navigate(
      { pathname: location.pathname, search: `?${search.toString()}`, hash: location.hash },
      { replace: true },
    );
  }, [location.hash, location.pathname, navigate, props.searchParams, props.variations]);
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
    <div className="px-4 py-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:text-text"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <SectionCaret expanded={props.expanded} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {props.title}
        </span>
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold tabular-nums text-slate-600">
          {props.count}
        </span>
      </button>
      {props.expanded ? <div className="mt-3">{props.children}</div> : null}
    </div>
  );
}

function VariationRollout(props: { value: number; colorClass: string }) {
  const value = Math.max(0, Math.min(100, props.value));

  return (
    <div className="flex w-2/5 min-w-0 max-w-xs shrink-0 items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted">
        {value}%
      </span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${props.colorClass}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function VariationValue(props: { value: unknown }) {
  if (typeof props.value === "string") {
    return (
      <span className="font-mono font-semibold text-text [overflow-wrap:anywhere]">
        {props.value}
      </span>
    );
  }

  return <VariableValueView value={props.value} />;
}

export function VariableAssignment(props: { id: string; name: string; value: unknown }) {
  return (
    <div id={props.id} className="group scroll-mt-6 py-3 first:pt-0 last:pb-0">
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
      <div className="mt-1.5">
        <VariableValueView value={props.value} nested />
      </div>
    </div>
  );
}

function VariableOverrideEntry(props: { override: VariableOverrideRecord; setKey?: string }) {
  const hasConditions = props.override.conditions !== undefined;
  const usesMutation = props.override.mutate !== undefined;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {props.override.key && (
        <div className="border-b border-border bg-elevated px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <TypeLabel>override</TypeLabel>
            <span className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">
              <EntityKey value={props.override.key} />
            </span>
          </div>
          {props.override.description && (
            <p className="mt-1 text-xs text-muted">{props.override.description}</p>
          )}
        </div>
      )}
      <div className="space-y-3 px-3 py-3">
        {hasConditions && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
              Conditions
            </div>
            <ConditionTree conditions={props.override.conditions as any} setKey={props.setKey} />
          </div>
        )}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            {usesMutation ? "Mutation" : "Value"}
          </div>
          {usesMutation ? (
            <MutationView value={props.override.mutate} nested />
          ) : (
            <VariableValueView value={props.override.value} nested />
          )}
        </div>
      </div>
    </div>
  );
}

export function VariableOverrideGroup(props: {
  id: string;
  name: string;
  overrides: VariableOverrideRecord[];
  setKey?: string;
}) {
  return (
    <div id={props.id} className="group scroll-mt-6 py-3 first:pt-0 last:pb-0">
      <div className="mb-2 flex min-w-0 items-center gap-2">
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
          <VariableOverrideEntry
            key={override.key || index}
            override={override}
            setKey={props.setKey}
          />
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
  index: number;
  variationSlug: string;
  variablesExpanded: boolean;
  overridesExpanded: boolean;
  onToggleVariables: () => void;
  onToggleOverrides: () => void;
  /** Whether the feature declares variables, so a variation without values uses defaults. */
  featureHasVariables?: boolean;
  /** Entities whose conditions check for this variation. */
  checkedBy?: React.ReactNode;
  setKey?: string;
}) {
  const variation = props.variation;
  const colorClass = WEIGHT_COLORS[props.index % WEIGHT_COLORS.length];
  const variables = sortedRecordEntries(variation.variables as Record<string, unknown> | undefined);
  const variableOverrides = sortedRecordEntries(
    variation.variableOverrides as Record<string, unknown> | undefined,
  );
  const description =
    typeof variation.description === "string" && variation.description.trim().length > 0
      ? variation.description.trim()
      : undefined;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex min-w-0 items-center justify-between gap-4 border-b border-border bg-elevated px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`} />
          <TypeLabel>variation</TypeLabel>
          <VariationValue value={variation.value} />
        </div>
        {typeof variation.weight === "number" && (
          <VariationRollout value={variation.weight} colorClass={colorClass} />
        )}
      </header>

      <div className="divide-y divide-border">
        {description && <p className="px-4 py-3 text-sm text-muted">{description}</p>}

        {variables.length === 0 && variableOverrides.length === 0 && props.featureHasVariables && (
          <p className="px-4 py-3 text-sm text-faint">Uses every variable's default value.</p>
        )}

        {variables.length > 0 && (
          <CollapsibleSection
            title="Variables"
            count={variables.length}
            expanded={props.variablesExpanded}
            onToggle={props.onToggleVariables}
          >
            <div className="divide-y divide-border/50">
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
            <div className="divide-y divide-border/50">
              {variableOverrides.map(([name, overrides]) => (
                <VariableOverrideGroup
                  key={name}
                  id={getVariationOverrideId(props.variationSlug, name)}
                  name={name}
                  overrides={
                    Array.isArray(overrides) ? (overrides as VariableOverrideRecord[]) : []
                  }
                  setKey={props.setKey}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {props.checkedBy && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 text-sm">
            <span
              className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint"
              title="Their conditions check for this variation, so renaming or removing it changes them."
            >
              Checked by
            </span>
            {props.checkedBy}
          </div>
        )}
      </div>
    </section>
  );
}

export function FeatureVariationsList(props: {
  variations: VariationRecord[];
  featureHasVariables?: boolean;
  /** Who checks each variation, by its value. */
  checkedBy?: Map<string, React.ReactNode>;
  setKey?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const listParam = (name: string) => parseListParam(searchParams.get(name));

  useExpandSectionsFromHash({
    variations: props.variations,
    searchParams,
  });
  useScrollToHash([props.variations.length, searchParams.toString(), location.hash]);

  if (props.variations.length === 0) {
    return null;
  }

  // Open when the URL asks for it, or when the list is short and the reader has not closed it.
  function isOpen(
    param: typeof VARIABLES_PARAM | typeof OVERRIDES_PARAM,
    slug: string,
    count: number,
  ) {
    return (
      listParam(param).has(slug) ||
      (count <= OPEN_BY_DEFAULT_LIMIT && !listParam(CLOSED_PARAMS[param]).has(slug))
    );
  }

  function toggleSection(
    param: typeof VARIABLES_PARAM | typeof OVERRIDES_PARAM,
    slug: string,
    count: number,
  ) {
    const open = listParam(param);
    const closed = listParam(CLOSED_PARAMS[param]);
    if (isOpen(param, slug, count)) {
      open.delete(slug);
      if (count <= OPEN_BY_DEFAULT_LIMIT) closed.add(slug);
    } else {
      open.add(slug);
      closed.delete(slug);
    }
    setSearchParams(
      setSearchParam(
        setSearchParam(searchParams, param, formatListParam(open)),
        CLOSED_PARAMS[param],
        formatListParam(closed),
      ),
    );
  }

  return (
    <div className="space-y-4">
      {props.variations.map((variation, index) => {
        const variationSlug = getVariationSlug(variation);
        const variableCount = Object.keys((variation.variables as object) || {}).length;
        const overrideCount = Object.keys((variation.variableOverrides as object) || {}).length;

        return (
          <VariationCard
            key={String(variation.value ?? index)}
            variation={variation}
            index={index}
            variationSlug={variationSlug}
            variablesExpanded={isOpen(VARIABLES_PARAM, variationSlug, variableCount)}
            overridesExpanded={isOpen(OVERRIDES_PARAM, variationSlug, overrideCount)}
            onToggleVariables={() => toggleSection(VARIABLES_PARAM, variationSlug, variableCount)}
            onToggleOverrides={() => toggleSection(OVERRIDES_PARAM, variationSlug, overrideCount)}
            featureHasVariables={props.featureHasVariables}
            checkedBy={props.checkedBy?.get(String(variation.value))}
            setKey={props.setKey}
          />
        );
      })}
    </div>
  );
}

/** The variable a key sets. Mutation keys such as "methods:appendUnique" belong to their root. */
export function rootVariableKey(key: string) {
  return key.split(/[.:[]/)[0];
}

function hasOwn(value: unknown, key: string) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

/** A value short enough for a table cell. The full value is in the title. */
function CompactValue(props: { value: unknown }) {
  const value = props.value;
  const text = Array.isArray(value)
    ? `[${value.length} item${value.length === 1 ? "" : "s"}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}}`
      : JSON.stringify(value);
  const shortened = text.length > 32 ? `${text.slice(0, 31)}…` : text;
  return (
    <code className="font-mono text-xs [overflow-wrap:anywhere]" title={JSON.stringify(value)}>
      {shortened}
    </code>
  );
}

/**
 * Every variable against every variation, so "what does treatment get?" is one glance. A value
 * links to its place in the variation below, and defaults are muted.
 */
export function VariableValuesTable(props: {
  variations: VariationRecord[];
  variablesSchema: Record<string, unknown>;
}) {
  const location = useLocation();
  const names = Object.keys(props.variablesSchema).sort((left, right) => left.localeCompare(right));
  if (names.length === 0 || props.variations.length === 0) return null;
  const anchor = (id: string) => ({
    pathname: location.pathname,
    search: location.search,
    hash: id,
  });

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
        Variable values by variation
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
            <tr>
              <th className="px-3 py-2">Variable</th>
              <th className="px-3 py-2">Default</th>
              {props.variations.map((variation, index) => (
                <th
                  key={index}
                  className="px-3 py-2 font-mono normal-case tracking-normal text-muted"
                >
                  {String(variation.value)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {names.map((name) => {
              const schema = props.variablesSchema[name] as Record<string, unknown> | undefined;
              return (
                <tr key={name}>
                  <td className="px-3 py-2 align-top font-mono text-xs font-semibold text-text">
                    {name}
                  </td>
                  <td className="px-3 py-2 align-top text-muted">
                    {schema && hasOwn(schema, "defaultValue") ? (
                      <CompactValue value={schema.defaultValue} />
                    ) : (
                      <span className="text-faint">none</span>
                    )}
                  </td>
                  {props.variations.map((variation, index) => {
                    const slug = getVariationSlug(variation);
                    const own = variation.variables as Record<string, unknown> | undefined;
                    const mutation = Object.keys(own || {}).find(
                      (key) => key !== name && rootVariableKey(key) === name,
                    );
                    const overrides = (variation.variableOverrides as Record<string, unknown[]>)?.[
                      name
                    ];
                    return (
                      <td key={index} className="px-3 py-2 align-top">
                        {hasOwn(own, name) ? (
                          <Link
                            to={anchor(getVariationVariableId(slug, name))}
                            className="font-semibold text-text hover:underline"
                          >
                            <CompactValue value={own![name]} />
                          </Link>
                        ) : mutation ? (
                          <Link
                            to={anchor(getVariationVariableId(slug, mutation))}
                            className="text-xs font-semibold text-text hover:underline"
                          >
                            mutated
                          </Link>
                        ) : (
                          <span className="text-xs text-faint">default</span>
                        )}
                        {Array.isArray(overrides) && overrides.length > 0 && (
                          <Link
                            to={anchor(getVariationOverrideId(slug, name))}
                            className="mt-0.5 block text-[11px] text-muted hover:text-text hover:underline"
                          >
                            +{overrides.length} override{overrides.length === 1 ? "" : "s"}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const WEIGHT_COLORS = [
  "bg-primary",
  "bg-violet-500",
  "bg-teal-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
];

/** Stacked allocation bar for variation weights. */
export function AllocationBar(props: {
  items: Array<{ label: React.ReactNode; weight: number; muted?: boolean }>;
}) {
  const total = props.items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        {props.items.map((item, index) =>
          item.weight > 0 ? (
            <div
              key={index}
              className={item.muted ? "bg-slate-300" : WEIGHT_COLORS[index % WEIGHT_COLORS.length]}
              style={{ width: `${total > 0 ? (item.weight / total) * 100 : 0}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {props.items.map((item, index) => (
          <li key={index} className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                item.muted ? "bg-slate-300" : WEIGHT_COLORS[index % WEIGHT_COLORS.length]
              }`}
            />
            <span className="font-medium text-text">{item.label}</span>
            <span className="text-muted">{item.weight}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutcomeLabel(props: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-medium text-muted">{props.children}</div>;
}

/**
 * Show what a matching rule or force entry does: enabled state, variation,
 * variation weights and variable values or overrides.
 */
export function RuleOutcome(props: {
  row: Record<string, unknown>;
  idPrefix: string;
  setKey?: string;
  className?: string;
  /**
   * Rules only. A matching rule enables the feature unless it says otherwise, and takes its
   * variation from the rule, then the rule's weights, then these feature variations.
   */
  ruleDefaults?: { variations?: Array<{ value?: unknown; weight?: unknown }> };
}) {
  const { row } = props;
  const variables = sortedRecordEntries(row.variables as Record<string, unknown> | undefined);
  const variableOverrides = sortedRecordEntries(
    row.variableOverrides as Record<string, unknown> | undefined,
  );
  const weights = sortedRecordEntries(row.variationWeights as Record<string, unknown> | undefined);
  const hasVariation = row.variation !== undefined;
  const hasEnabled = typeof row.enabled === "boolean";
  const isRule = Boolean(props.ruleDefaults);
  const disabled = row.enabled === false;
  // A rule that names no variation falls back to the feature's own weights.
  const featureWeights =
    isRule && !disabled && !hasVariation && !weights.length
      ? (props.ruleDefaults?.variations || []).map(
          (variation) => [String(variation.value), variation.weight] as [string, unknown],
        )
      : [];

  if (
    !isRule &&
    !hasEnabled &&
    !hasVariation &&
    !weights.length &&
    !variables.length &&
    !variableOverrides.length
  ) {
    return null;
  }

  return (
    <div className={`space-y-4 ${props.className || ""}`}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Outcome</h3>
      {(hasEnabled || hasVariation || isRule) && (
        <div className="flex flex-wrap gap-6">
          {(hasEnabled || isRule) && (
            <div>
              <OutcomeLabel>Enabled</OutcomeLabel>
              <Badge tone={disabled ? "neutral" : "success"}>{disabled ? "false" : "true"}</Badge>
              {!hasEnabled && <span className="ml-2 text-xs text-faint">by default</span>}
            </div>
          )}
          {hasVariation && (
            <div>
              <OutcomeLabel>Variation</OutcomeLabel>
              <span className="font-mono text-sm font-semibold text-text">
                {String(row.variation)}
              </span>
            </div>
          )}
        </div>
      )}
      {featureWeights.length > 0 && (
        <div>
          <OutcomeLabel>Variation weights, from the feature</OutcomeLabel>
          <AllocationBar
            items={featureWeights.map(([variation, weight]) => ({
              label: <span className="font-mono">{variation}</span>,
              weight: Number(weight) || 0,
            }))}
          />
        </div>
      )}
      {weights.length > 0 && (
        <div>
          <OutcomeLabel>Variation weights</OutcomeLabel>
          <AllocationBar
            items={weights.map(([variation, weight]) => ({
              label: <span className="font-mono">{variation}</span>,
              weight: Number(weight) || 0,
            }))}
          />
        </div>
      )}
      {variables.length > 0 && (
        <div>
          <OutcomeLabel>Variables</OutcomeLabel>
          <div className="divide-y divide-border/50">
            {variables.map(([name, value]) => (
              <VariableAssignment
                key={name}
                id={`${props.idPrefix}-variables-${slugifyFragment(name)}`}
                name={name}
                value={value}
              />
            ))}
          </div>
        </div>
      )}
      {variableOverrides.length > 0 && (
        <div>
          <OutcomeLabel>Variable overrides</OutcomeLabel>
          <div className="divide-y divide-border/50">
            {variableOverrides.map(([name, overrides]) => (
              <VariableOverrideGroup
                key={name}
                id={`${props.idPrefix}-overrides-${slugifyFragment(name)}`}
                name={name}
                overrides={Array.isArray(overrides) ? (overrides as VariableOverrideRecord[]) : []}
                setKey={props.setKey}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
