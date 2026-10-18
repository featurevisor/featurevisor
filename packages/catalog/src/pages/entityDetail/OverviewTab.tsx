import * as React from "react";
import type { ComposeReference, Test } from "@featurevisor/types";
import { Link } from "react-router-dom";

import { entityLabels, getBasePath, getEntityRoute } from "../../entityTypes";
import type { CatalogEntityType, EntityDetail } from "../../types";
import { useCatalog } from "../../context/CatalogContext";
import {
  Badge,
  EntityKey,
  DescriptionField,
  OverviewChip,
  OverviewChipLink,
  OverviewMetaPanel,
  OverviewMetaRow,
  OverviewSection,
} from "../../components/ui";
import { ConditionTree } from "../../components/trees";
import {
  SchemaPropertiesOverview,
  SchemaTable,
  VariableValueView,
  hasSchemaTableRows,
  slugifyFragment,
  usesSchemaStructureTable,
  type SchemaLike,
} from "../../components/variables";
import { AllocationBar } from "../../components/variations";
import { DECODED_JSON_DESCRIPTION, formatVariableType } from "../../components/valueFormat";
import { EntityTests } from "../../components/tests";
import {
  AttributeConditionValues,
  getRequiredBy,
  SchemaExample,
  countUsedBy,
} from "../../components/insights";
import {
  ReferenceChip,
  useEntityDependencies,
  useSummaryLookup,
} from "../../components/dependencies";
import type { EntityDependencies } from "../../dependencyIndex";
import { FormattedValue, asStringArray, getEnvironmentMap, useEntityDetail } from "./shared";

export function OverviewTab() {
  const { detail, setKey } = useEntityDetail();
  const { manifest } = useCatalog();

  if (detail.type === "test") {
    const test = detail.report
      ? ({ ...detail.entity, report: detail.report } as unknown as Test)
      : (detail.entity as unknown as Test);
    return <EntityTests tests={[test]} setKey={setKey} reportSupplied={!!manifest.testReport} />;
  }
  const entity = detail.entity as Record<string, unknown>;

  return (
    <div className="space-y-6">
      <EntityOverviewMeta detail={detail} entity={entity} setKey={setKey} />

      <DescriptionField value={entity.description} showTopDivider={false} />

      {(detail.type === "feature" || detail.type === "variable") &&
        entity.conditions !== undefined && (
          <OverviewSection title="Root conditions">
            <p className="mb-2 text-sm text-muted">{describeRootGate(detail.type, entity)}</p>
            <ConditionTree conditions={entity.conditions as any} setKey={setKey} />
            {detail.type === "variable" && entity.compose !== undefined && (
              <div className="mt-3">
                <p className="mb-1.5 text-sm text-muted">Returned when they are not met:</p>
                <CompositionDisabledValue
                  value={
                    Object.prototype.hasOwnProperty.call(entity, "disabledValue")
                      ? entity.disabledValue
                      : null
                  }
                />
              </div>
            )}
          </OverviewSection>
        )}

      {detail.type === "feature" && <FeatureSummary entity={entity} />}

      {detail.type === "target" && (
        <TargetDefinition detail={detail} entity={entity} setKey={setKey} />
      )}

      {detail.type === "segment" && (
        <OverviewSection title="Conditions">
          <ConditionTree conditions={entity.conditions as any} setKey={setKey} />
        </OverviewSection>
      )}

      {detail.type === "schema" && !usesSchemaStructureTable(entity as SchemaLike) && (
        <SchemaPropertiesOverview schema={entity as SchemaLike} setKey={setKey} />
      )}

      {detail.type === "schema" &&
        usesSchemaStructureTable(entity as SchemaLike) &&
        hasSchemaTableRows(entity as SchemaLike) && (
          <OverviewSection title="Structure">
            <SchemaTable schema={entity as SchemaLike} setKey={setKey} />
          </OverviewSection>
        )}

      {detail.type === "schema" && <SchemaExample schema={entity} setKey={setKey} />}

      {detail.type === "attribute" && hasSchemaTableRows(entity as SchemaLike) && (
        <OverviewSection title="Structure">
          <SchemaTable schema={entity as SchemaLike} setKey={setKey} />
        </OverviewSection>
      )}

      {detail.type === "attribute" && (
        <AttributeConditionValues values={detail.conditionValues} setKey={setKey} />
      )}

      {detail.type === "variable" && entity.compose !== undefined && (
        <CompositionTable
          compose={entity.compose as string | Record<string, ComposeReference>}
          hasOverrides={getEnvironmentMap(entity.overrides).some(
            ([, rows]) => Array.isArray(rows) && rows.length > 0,
          )}
          composedSourceAliases={detail.composedSourceAliases}
          aliasSourceType={detail.aliasSourceType}
          setKey={setKey}
        />
      )}

      {detail.type === "variable" &&
        entity.compose !== undefined &&
        "disabledValue" in entity &&
        entity.conditions === undefined && (
          <OverviewSection title="Disabled value">
            <CompositionDisabledValue value={entity.disabledValue} />
          </OverviewSection>
        )}

      {detail.type === "variable" && entity.compose === undefined && (
        <>
          {hasSchemaTableRows(entity as SchemaLike) && (
            <OverviewSection title="Structure">
              <SchemaTable schema={entity as SchemaLike} setKey={setKey} />
            </OverviewSection>
          )}
          <OverviewSection title="Default value">
            <VariableValueView value={entity.defaultValue} />
          </OverviewSection>
          {"disabledValue" in entity && (
            <OverviewSection title="Disabled value">
              <VariableValueView value={entity.disabledValue} />
            </OverviewSection>
          )}
        </>
      )}
    </div>
  );
}

type FeatureRowLike = { percentage?: unknown };

/** What the root gate is checked against, and what an unmet gate returns. */
function describeRootGate(type: string, entity: Record<string, unknown>) {
  if (type === "feature") {
    return "Checked after force entries and before rules. When they are not met, the feature is disabled.";
  }
  if (entity.compose !== undefined) {
    return "Checked before composition sources and overrides. When they are not met, neither runs.";
  }
  const fallback =
    "disabledValue" in entity
      ? "the disabled value below"
      : entity.useDefaultWhenDisabled === true
        ? "the default value below"
        : "null";
  return `Checked before overrides. When they are not met, overrides are skipped and the variable returns ${fallback}.`;
}

function CompositionDisabledValue(props: { value: unknown }) {
  return props.value === null ? (
    <code className="font-mono text-sm text-text">null</code>
  ) : (
    <VariableValueView value={props.value} />
  );
}

export function CompositionTable(props: {
  compose: string | Record<string, ComposeReference>;
  hasOverrides?: boolean;
  composedSourceAliases?: string[];
  aliasSourceType?: string;
  setKey?: string;
}) {
  if (typeof props.compose === "string") {
    return (
      <OverviewSection title="Alias">
        <p className="mb-3 text-sm text-muted">
          {props.hasOverrides
            ? "The source variable is evaluated first. Overrides then run in order and can change its value."
            : "Returns the source variable value, including null."}
        </p>
        {props.aliasSourceType === "json" && (
          <p className="mb-3 text-sm text-muted">{DECODED_JSON_DESCRIPTION}</p>
        )}
        <OverviewMetaRow label="Source">
          <Link to={getEntityRoute("variable", props.compose, props.setKey)}>{props.compose}</Link>
        </OverviewMetaRow>
      </OverviewSection>
    );
  }
  return (
    <OverviewSection title="Composition">
      <p className="mb-3 text-sm text-muted">
        {props.hasOverrides
          ? "Each property starts with its source value. Overrides then run in order and can change it."
          : "Each property contains its source value."}{" "}
        False and null values do not gate other members.
      </p>
      <table className="w-full text-left text-sm [overflow-wrap:anywhere]">
        <thead>
          <tr>
            <th>Property</th>
            <th>Kind</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(props.compose)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([alias, source]) => {
              const feature = source.feature !== undefined;
              const key = feature ? source.feature! : source.variable!;
              const kind = !feature
                ? props.composedSourceAliases?.includes(alias)
                  ? "Composed variable"
                  : "Global variable"
                : source.variable !== undefined
                  ? "Feature variable"
                  : source.variation
                    ? "Variation"
                    : "Flag";
              return (
                <tr key={alias}>
                  <td>
                    <EntityKey value={alias} />
                  </td>
                  <td>{kind}</td>
                  <td>
                    <Link
                      to={
                        getEntityRoute(feature ? "feature" : "variable", key, props.setKey) +
                        (feature && source.variable !== undefined
                          ? `/variables#${slugifyFragment(source.variable)}`
                          : "")
                      }
                    >
                      {key}
                      {feature && source.variable !== undefined && (
                        <>
                          {" "}
                          / <EntityKey value={source.variable} />
                        </>
                      )}
                    </Link>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </OverviewSection>
  );
}

/** At a glance summary of a feature, per environment when the project has them. */
function FeatureSummary(props: { entity: Record<string, unknown> }) {
  const { entity } = props;
  const rulesByEnvironment = getEnvironmentMap(entity.rules);
  const forceByEnvironment = new Map(getEnvironmentMap(entity.force));
  const exposeByEnvironment =
    entity.expose && typeof entity.expose === "object" && !Array.isArray(entity.expose)
      ? (entity.expose as Record<string, unknown>)
      : undefined;
  const variations = Array.isArray(entity.variations)
    ? (entity.variations as Array<{ value?: unknown; weight?: unknown }>)
    : [];
  // Projects without environments keep one flat list of rules; show no environment column then.
  const hasEnvironments = rulesByEnvironment.some(([environment]) => Boolean(environment));

  return (
    <>
      {rulesByEnvironment.length > 0 && (
        <OverviewSection title={hasEnvironments ? "Environments" : "Rollout"}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
                <tr>
                  {hasEnvironments && <th className="px-2 py-2 sm:px-3">Environment</th>}
                  <th className="px-2 py-2 sm:px-3">Rules</th>
                  <th className="px-2 py-2 sm:px-3">
                    <span className="sm:hidden">Rollout</span>
                    <span className="hidden sm:inline">Highest rollout</span>
                  </th>
                  <th className="hidden px-2 py-2 sm:table-cell sm:px-3">Forced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rulesByEnvironment.map(([environment, rules]) => {
                  const rows = Array.isArray(rules) ? (rules as FeatureRowLike[]) : [];
                  const highest = rows.reduce(
                    (max, row) =>
                      typeof row.percentage === "number" ? Math.max(max, row.percentage) : max,
                    0,
                  );
                  const force = forceByEnvironment.get(environment);
                  const forced = Array.isArray(force) ? force.length : 0;
                  const exposed = environment
                    ? exposeByEnvironment?.[environment]
                    : entity.expose === false
                      ? false
                      : undefined;
                  const rulesPath = environment ? `rules/${environment}` : "rules";
                  const notExposed = exposed === false && (
                    <span className="ml-2">
                      <Badge tone="warning">not exposed</Badge>
                    </span>
                  );

                  return (
                    <tr key={environment || "all"}>
                      {hasEnvironments && (
                        <td className="px-2 py-2 font-medium sm:px-3">
                          <Link to={rulesPath} className="text-primary hover:underline">
                            {environment}
                          </Link>
                          {notExposed}
                        </td>
                      )}
                      <td className="px-2 py-2 text-muted sm:px-3">
                        {hasEnvironments ? (
                          rows.length
                        ) : (
                          <>
                            <Link
                              to={rulesPath}
                              className="font-medium text-primary hover:underline"
                            >
                              {rows.length} {rows.length === 1 ? "rule" : "rules"}
                            </Link>
                            {notExposed}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 sm:px-3">
                        <div className="flex items-center gap-2">
                          <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 sm:block">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${highest}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted">{highest}%</span>
                        </div>
                      </td>
                      <td className="hidden px-2 py-2 sm:px-3 text-muted sm:table-cell">
                        {forced}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </OverviewSection>
      )}

      {variations.length > 0 && (
        <OverviewSection title="Variations">
          <AllocationBar
            items={variations.map((variation) => ({
              label: <span className="font-mono">{String(variation.value)}</span>,
              weight: Number(variation.weight) || 0,
            }))}
          />
        </OverviewSection>
      )}
    </>
  );
}

function TargetPatternChips(props: {
  type: "feature" | "variable";
  value: unknown;
  setKey?: string;
}) {
  if (props.value === "*") {
    return <OverviewChip>all</OverviewChip>;
  }

  const patterns = asStringArray(props.value) || [];

  return (
    <>
      {patterns.map((pattern) =>
        pattern.includes("*") ? (
          <OverviewChip key={pattern} className="font-mono">
            {pattern}
          </OverviewChip>
        ) : (
          <OverviewChipLink key={pattern} to={getEntityRoute(props.type, pattern, props.setKey)}>
            {pattern}
          </OverviewChipLink>
        ),
      )}
    </>
  );
}

/** A tag that opens the list it filters, such as features tagged "checkout". */
function TagChip(props: { tag: string; list: "features" | "variables"; setKey?: string }) {
  return (
    <OverviewChipLink
      to={`${getBasePath(props.setKey)}/${props.list}?q=${encodeURIComponent(`tag:${props.tag}`)}`}
    >
      <span className="text-faint">#</span>
      {props.tag}
    </OverviewChipLink>
  );
}

function TargetTags(props: { entity: Record<string, unknown>; setKey?: string }) {
  const tags = props.entity.tags;
  const tag = typeof props.entity.tag === "string" ? props.entity.tag : undefined;
  let operator: "and" | "or" | undefined;
  let values: string[] = [];

  if (Array.isArray(tags)) {
    operator = "and";
    values = tags.map(String);
  } else if (tags && typeof tags === "object") {
    operator = "and" in tags ? "and" : "or";
    values = asStringArray((tags as Record<string, unknown>)[operator]) || [];
  }

  if (tag) {
    values = [tag, ...values];
  }

  if (values.length === 0) {
    return null;
  }

  return (
    <OverviewMetaRow label="Tags">
      {values.map((value, index) => (
        <React.Fragment key={`${value}-${index}`}>
          {index > 0 && operator && (
            <span className="text-[10px] font-semibold uppercase text-faint">{operator}</span>
          )}
          <TagChip tag={value} list="features" setKey={props.setKey} />
        </React.Fragment>
      ))}
    </OverviewMetaRow>
  );
}

/** Matches the CLI's info output, which divides bytes by 1024. */
function formatKilobytes(bytes: number) {
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`;
}

function TargetDefinition(props: {
  detail: EntityDetail;
  entity: Record<string, unknown>;
  setKey?: string;
}) {
  const { entity, setKey } = props;
  const features = props.detail.relationships?.features || [];
  const variables = props.detail.relationships?.variables || [];
  const segments = props.detail.relationships?.segments || [];
  const pulledIn = Object.keys(props.detail.contentPulledIn || {}).length;
  const count = (length: number, noun: string) => `${length} ${noun}${length === 1 ? "" : "s"}`;
  const hasContext =
    entity.context && typeof entity.context === "object" && Object.keys(entity.context).length > 0;
  const rows = [
    ["Include features", "feature", entity.includeFeatures],
    ["Exclude features", "feature", entity.excludeFeatures],
    ["Include variables", "variable", entity.includeVariables],
    ["Exclude variables", "variable", entity.excludeVariables],
  ] as const;

  return (
    <>
      <OverviewSection title="Selection">
        <OverviewMetaPanel>
          <TargetTags entity={entity} setKey={props.setKey} />
          {rows.map(([label, type, value]) =>
            value === undefined ? null : (
              <OverviewMetaRow key={label} label={label}>
                <TargetPatternChips type={type} value={value} setKey={setKey} />
              </OverviewMetaRow>
            ),
          )}
          <OverviewMetaRow label="Resolves to">
            <Link to="contents" className="text-sm font-medium text-primary hover:underline">
              {count(features.length, "feature")}, {count(variables.length, "variable")},{" "}
              {count(segments.length, "segment")}
            </Link>
            {pulledIn > 0 && (
              <span
                className="text-xs text-muted"
                title="The Target does not select them, but entities it selects depend on them."
              >
                {pulledIn} pulled in as {pulledIn === 1 ? "a dependency" : "dependencies"}
              </span>
            )}
          </OverviewMetaRow>
          {props.detail.datafiles?.length ? (
            <OverviewMetaRow label="Estimated size">
              <span className="flex flex-col gap-1 text-sm text-text">
                {props.detail.datafiles.map((datafile) => (
                  <span key={datafile.environment ?? ""}>
                    {datafile.environment && (
                      <span className="mr-2 text-muted">{datafile.environment}</span>
                    )}
                    <span title="Built by Core for this Target. The revision is a placeholder, so the real file can differ slightly.">
                      about {formatKilobytes(datafile.bytes)}
                    </span>
                    <span
                      className="text-muted"
                      title="Gzip at its default level. Your host may compress differently."
                    >
                      {" "}
                      (about {formatKilobytes(datafile.gzipBytes)} gzipped)
                    </span>
                  </span>
                ))}
              </span>
            </OverviewMetaRow>
          ) : null}
        </OverviewMetaPanel>
      </OverviewSection>
      {hasContext ? (
        <OverviewSection title="Context">
          <VariableValueView value={entity.context} />
        </OverviewSection>
      ) : null}
    </>
  );
}

function EntityStatusBadges(props: { entity: Record<string, unknown> }) {
  const hasBadges =
    props.entity.archived === true ||
    props.entity.deprecated === true ||
    props.entity.promotable === false;

  if (!hasBadges) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {props.entity.archived === true && <Badge tone="danger">archived</Badge>}
      {props.entity.deprecated === true && <Badge tone="warning">deprecated</Badge>}
      {props.entity.promotable === false && <Badge>not promotable</Badge>}
    </div>
  );
}

function LinkedEntityChips(props: { type: CatalogEntityType; values?: string[]; setKey?: string }) {
  if (!props.values?.length) {
    return null;
  }

  return (
    <>
      {props.values.map((value) => (
        <OverviewChipLink key={value} to={getEntityRoute(props.type, value, props.setKey)}>
          {value}
        </OverviewChipLink>
      ))}
    </>
  );
}

function hasBucketBy(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function getAttributeEntityKey(attributePath: string) {
  return attributePath.split(".")[0];
}

function BucketByDisplay(props: { value: unknown; setKey?: string }) {
  const value = props.value;

  if (!hasBucketBy(value)) {
    return null;
  }

  if (typeof value === "string") {
    return (
      <OverviewChipLink
        to={getEntityRoute("attribute", getAttributeEntityKey(value), props.setKey)}
      >
        <EntityKey value={value} className="font-mono" />
      </OverviewChipLink>
    );
  }

  if (Array.isArray(value)) {
    return (
      <>
        {value.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-xs text-faint">and</span>}
            <BucketByDisplay setKey={props.setKey} value={item} />
          </React.Fragment>
        ))}
      </>
    );
  }

  if (typeof value === "object" && value !== null && "or" in value) {
    const orValue = (value as { or: unknown }).or;
    const orItems = Array.isArray(orValue) ? orValue : [orValue];

    return (
      <>
        {orItems.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-xs text-faint">or</span>}
            <BucketByDisplay setKey={props.setKey} value={item} />
          </React.Fragment>
        ))}
      </>
    );
  }

  return (
    <OverviewChip>
      <span className="font-mono text-xs">
        <FormattedValue value={value} />
      </span>
    </OverviewChip>
  );
}

/** Attributes an entity reads from context, directly or through segments. */
function getContextAttributes(dependencies: EntityDependencies) {
  return [...dependencies.uses, ...dependencies.usesIndirectly]
    .filter((entry) => entry.type === "attribute")
    .map((entry) => entry.key)
    .sort((left, right) => left.localeCompare(right));
}

function MoreThroughLink(props: { count: number; alone?: boolean }) {
  if (!props.count) return null;
  return (
    <Link to="usage" className="text-xs font-medium text-primary hover:underline">
      {props.alone
        ? `${props.count} through other entities`
        : `and ${props.count} more through them`}
    </Link>
  );
}

/**
 * What uses this entity and what it uses, as linked chips naming their types. Indirect ones are
 * counted and linked to the Usage tab, which shows each chain.
 */
function DependencyRows(props: {
  detail: EntityDetail;
  dependencies: EntityDependencies;
  setKey?: string;
}) {
  const { detail, dependencies, setKey } = props;
  const summaryOf = useSummaryLookup(setKey);
  const requiredBy = getRequiredBy(detail);
  const composedBy = (detail.usedBy || [])
    .filter(
      (owner) =>
        owner.type === "variable" &&
        owner.locations.some(
          (location) => location.startsWith("compose ") || location.startsWith("alias of "),
        ),
    )
    .map((owner) => ({ type: "variable" as const, key: owner.key }));
  const dependsOn = dependencies.uses.filter((entry) => entry.type !== "attribute");
  const indirectUsers = dependencies.usedIndirectlyBy.length;
  const indirectDependencies = dependencies.usesIndirectly.filter(
    (entry) => entry.type !== "attribute",
  ).length;
  const context = getContextAttributes(dependencies);
  const chips = (nodes: Array<{ type: CatalogEntityType; key: string }>) =>
    nodes.map((node) => (
      <ReferenceChip
        key={`${node.type}:${node.key}`}
        reference={node}
        summary={summaryOf(node)}
        setKey={setKey}
      />
    ));

  return (
    <>
      {/* Segments summarise their users in a count row of their own. */}
      {detail.type !== "segment" && (requiredBy.length > 0 || indirectUsers > 0) && (
        <OverviewMetaRow label="Used by">
          {chips(requiredBy)}
          <MoreThroughLink count={indirectUsers} alone={requiredBy.length === 0} />
        </OverviewMetaRow>
      )}
      {composedBy.length > 0 && (
        <OverviewMetaRow label="Composed by">{chips(composedBy)}</OverviewMetaRow>
      )}
      {(dependsOn.length > 0 || indirectDependencies > 0) && (
        <OverviewMetaRow label="Depends on">
          {chips(dependsOn)}
          <MoreThroughLink count={indirectDependencies} alone={dependsOn.length === 0} />
        </OverviewMetaRow>
      )}
      {context.length > 0 && (
        <OverviewMetaRow label="Context">
          {context.map((key) => (
            <OverviewChipLink key={key} to={getEntityRoute("attribute", key, setKey)}>
              <span className="font-mono">{key}</span>
            </OverviewChipLink>
          ))}
        </OverviewMetaRow>
      )}
    </>
  );
}

function hasDependencies(detail: EntityDetail, dependencies: EntityDependencies) {
  return Boolean(
    detail.usedBy?.length ||
    dependencies.usedIndirectlyBy.length ||
    dependencies.uses.length ||
    dependencies.usesIndirectly.length,
  );
}

function EntityOverviewMeta(props: {
  detail: EntityDetail;
  entity: Record<string, unknown>;
  setKey?: string;
}) {
  const { detail, entity, setKey } = props;
  const dependencies = useEntityDependencies(detail, setKey);
  const tags = asStringArray(entity.tags);
  const targets = detail.relationships?.targets;
  const hasStatus =
    entity.archived === true || entity.deprecated === true || entity.promotable === false;

  if (detail.type === "feature") {
    const showBucketBy = hasBucketBy(entity.bucketBy);
    const hasFacts = showBucketBy;
    const hasRelations =
      Boolean(tags?.length) || Boolean(targets?.length) || hasDependencies(detail, dependencies);

    if (!hasStatus && !hasFacts && !hasRelations) {
      return null;
    }

    return (
      <OverviewMetaPanel>
        {hasStatus && (
          <OverviewMetaRow label="Status">
            <EntityStatusBadges entity={entity} />
          </OverviewMetaRow>
        )}
        {showBucketBy && (
          <OverviewMetaRow label="Bucket by">
            <BucketByDisplay value={entity.bucketBy} setKey={setKey} />
          </OverviewMetaRow>
        )}
        {tags?.length ? (
          <OverviewMetaRow label="Tags">
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} list="features" setKey={setKey} />
            ))}
          </OverviewMetaRow>
        ) : null}
        {targets?.length ? (
          <OverviewMetaRow label="Targets">
            <LinkedEntityChips type="target" values={targets} setKey={setKey} />
          </OverviewMetaRow>
        ) : null}
        <DependencyRows detail={detail} dependencies={dependencies} setKey={setKey} />
      </OverviewMetaPanel>
    );
  }

  if (detail.type === "variable") {
    // The Structure table below already names the type of objects and arrays.
    const hasType =
      !hasSchemaTableRows(entity as SchemaLike) &&
      (entity.compose !== undefined ||
        Boolean(entity.type) ||
        (Array.isArray(entity.oneOf) && entity.oneOf.length > 0));
    const typeLabel =
      typeof entity.compose === "string"
        ? formatVariableType(detail.aliasSourceType || "unknown", true)
        : entity.compose !== undefined
          ? "object"
          : entity.type
            ? String(entity.type)
            : "oneOf";
    const schemaKey = typeof entity.schema === "string" ? entity.schema : undefined;
    const hasFacts = hasType || Boolean(schemaKey);
    const hasRelations =
      Boolean(tags?.length) || Boolean(targets?.length) || hasDependencies(detail, dependencies);

    if (!hasStatus && !hasFacts && !hasRelations) {
      return null;
    }

    return (
      <OverviewMetaPanel>
        {hasStatus && (
          <OverviewMetaRow label="Status">
            <EntityStatusBadges entity={entity} />
          </OverviewMetaRow>
        )}
        {hasType ? (
          <OverviewMetaRow label="Type">
            <OverviewChip>{typeLabel}</OverviewChip>
            {entity.compose !== undefined && <Badge>composed</Badge>}
          </OverviewMetaRow>
        ) : null}
        {schemaKey ? (
          <OverviewMetaRow label="Schema">
            <OverviewChipLink to={getEntityRoute("schema", schemaKey, setKey)}>
              {schemaKey}
            </OverviewChipLink>
          </OverviewMetaRow>
        ) : null}
        {tags?.length ? (
          <OverviewMetaRow label="Tags">
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} list="variables" setKey={setKey} />
            ))}
          </OverviewMetaRow>
        ) : null}
        {targets?.length ? (
          <OverviewMetaRow label="Targets">
            <LinkedEntityChips type="target" values={targets} setKey={setKey} />
          </OverviewMetaRow>
        ) : null}
        <DependencyRows detail={detail} dependencies={dependencies} setKey={setKey} />
      </OverviewMetaPanel>
    );
  }

  const typeShownInStructure =
    detail.type === "schema" &&
    usesSchemaStructureTable(entity as SchemaLike) &&
    hasSchemaTableRows(entity as SchemaLike);
  const showType =
    (detail.type === "attribute" || detail.type === "schema") &&
    !typeShownInStructure &&
    Boolean(entity.type || (Array.isArray(entity.oneOf) && entity.oneOf.length > 0));
  const usedBy = <UsedByRow detail={detail} dependencies={dependencies} />;
  const hasUsage =
    detail.type === "segment" || detail.type === "attribute" || detail.type === "schema";
  const segmentTargets = detail.type === "segment" ? targets : undefined;

  if (!hasStatus && !showType && !hasUsage) {
    return null;
  }

  return (
    <OverviewMetaPanel>
      {hasStatus && (
        <OverviewMetaRow label="Status">
          <EntityStatusBadges entity={entity} />
        </OverviewMetaRow>
      )}
      {showType && (
        <OverviewMetaRow label="Type">
          <OverviewChip>{entity.type ? String(entity.type) : "oneOf"}</OverviewChip>
        </OverviewMetaRow>
      )}
      {segmentTargets?.length ? (
        <OverviewMetaRow label="Targets">
          <LinkedEntityChips type="target" values={segmentTargets} setKey={setKey} />
        </OverviewMetaRow>
      ) : null}
      {usedBy}
      {detail.type === "segment" && (
        <DependencyRows detail={detail} dependencies={dependencies} setKey={setKey} />
      )}
    </OverviewMetaPanel>
  );
}

function formatCounts(counts: Array<[CatalogEntityType, number]>) {
  const parts = counts
    .filter(([, count]) => count > 0)
    .map(
      ([type, count]) =>
        `${count} ${(count === 1 ? entityLabels[type].singular : entityLabels[type].plural).toLowerCase()}`,
    );
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0] || "";
}

/**
 * How many features and variables use a segment, attribute or schema, directly or through
 * other entities. When that differs from what refers to it directly, the direct count follows.
 */
function UsedByRow(props: { detail: EntityDetail; dependencies: EntityDependencies }) {
  const { detail } = props;
  const reach = [
    ["feature", detail.relationships?.features?.length || 0],
    ["variable", detail.relationships?.variables?.length || 0],
  ] as Array<[CatalogEntityType, number]>;
  const direct = countUsedBy(detail);
  const directText = formatCounts(
    (["feature", "variable", "segment"] as const).map((type) => [type, direct[type] || 0]),
  );
  const reachText = reach
    .filter(([, count]) => count > 0)
    .map(
      ([type, count]) =>
        `${count} ${(count === 1 ? entityLabels[type].singular : entityLabels[type].plural).toLowerCase()}`,
    )
    .join(" · ");
  const showDirect =
    detail.type !== "schema" &&
    Boolean(directText) &&
    (props.dependencies.usedIndirectlyBy.length > 0 || Boolean(direct.segment));

  return (
    <OverviewMetaRow label="Used by">
      {reachText ? (
        <Link to="usage" className="text-sm text-primary hover:underline">
          {reachText}
        </Link>
      ) : (
        <Badge>unused</Badge>
      )}
      {showDirect && (
        <span className="text-xs text-muted">
          {reachText
            ? `directly by ${directText}`
            : `only referred to by ${directText} that no feature or variable uses`}
        </span>
      )}
    </OverviewMetaRow>
  );
}
