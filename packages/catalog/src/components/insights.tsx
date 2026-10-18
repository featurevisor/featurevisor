import * as React from "react";
import { Link } from "react-router-dom";

import { fetchEntityDetail } from "../api";
import { entityLabels, getEntityRoute } from "../entityTypes";
import type { CatalogEntityType, EntityDetail, EntityReference } from "../types";
import { useEntityDependencies, useSummaryLookup } from "./dependencies";
import { CodeBlock, EntityChip, OverviewSection } from "./ui";

export function countUsedBy(detail: EntityDetail) {
  const counts: Partial<Record<CatalogEntityType, number>> = {};

  for (const owner of detail.usedBy || []) {
    counts[owner.type] = (counts[owner.type] || 0) + 1;
  }

  return counts;
}

function formatConditionValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

const valueChipClass = "rounded px-1.5 py-0.5 font-mono text-xs";

/**
 * The values conditions compare this attribute against, grouped by path and operator.
 * Choosing a value lists the segments, features and variables comparing with it.
 */
export function AttributeConditionValues(props: {
  values?: EntityDetail["conditionValues"];
  setKey?: string;
}) {
  const [selected, setSelected] = React.useState<{ row: number; value: number }>();
  if (!props.values?.length) return null;

  return (
    <OverviewSection title="Values used in conditions">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-faint">
            <tr>
              <th className="px-3 py-2">Path</th>
              <th className="px-3 py-2">Operator</th>
              <th className="px-3 py-2">Values</th>
              <th className="px-3 py-2 text-right">Uses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {props.values.map((entry, row) => {
              const chosen = selected?.row === row ? selected.value : undefined;
              const users = chosen === undefined ? undefined : entry.users?.[chosen];

              return (
                <React.Fragment key={`${entry.path}:${entry.operator}`}>
                  <tr>
                    <td className="px-3 py-2 font-mono text-xs text-text">{entry.path}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{entry.operator}</td>
                    <td className="px-3 py-2">
                      {entry.values.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {entry.values.map((value, index) =>
                            entry.users?.[index]?.length ? (
                              <button
                                key={index}
                                type="button"
                                aria-pressed={chosen === index}
                                title="Show where this value is used"
                                onClick={() =>
                                  setSelected(chosen === index ? undefined : { row, value: index })
                                }
                                className={[
                                  valueChipClass,
                                  "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                  chosen === index
                                    ? "bg-header-active text-header-text"
                                    : "bg-slate-100 text-slate-800 hover:bg-slate-200",
                                ].join(" ")}
                              >
                                {formatConditionValue(value)}
                              </button>
                            ) : (
                              <code
                                key={index}
                                className={`${valueChipClass} bg-slate-100 text-slate-800`}
                              >
                                {formatConditionValue(value)}
                              </code>
                            ),
                          )}
                          {entry.moreValues ? (
                            <span className="text-xs text-faint">+{entry.moreValues} more</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-faint">no value</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted">
                      {entry.uses}
                    </td>
                  </tr>
                  {users && chosen !== undefined && (
                    <tr className="bg-elevated">
                      <td colSpan={4} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span>
                            <span className="font-mono text-text">{entry.path}</span>{" "}
                            {entry.operator}{" "}
                            <span className="font-mono text-text">
                              {formatConditionValue(entry.values[chosen])}
                            </span>{" "}
                            in
                          </span>
                          {users.map((user) => (
                            <EntityChip
                              key={`${user.type}:${user.key}`}
                              to={getEntityRoute(user.type, user.key, props.setKey)}
                              label={entityLabels[user.type].singular}
                              mono
                            >
                              {user.key}
                            </EntityChip>
                          ))}
                          {entry.moreUsers?.[chosen] ? (
                            <span>and {entry.moreUsers[chosen]} more, listed on the Usage tab</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </OverviewSection>
  );
}

type SchemaNode = Record<string, unknown>;

function collectSchemaRefs(schema: unknown, refs: Set<string>) {
  if (Array.isArray(schema)) {
    schema.forEach((item) => collectSchemaRefs(item, refs));
    return;
  }

  if (!schema || typeof schema !== "object") return;

  const node = schema as SchemaNode;
  if (typeof node.schema === "string") refs.add(node.schema);
  Object.values(node).forEach((value) => collectSchemaRefs(value, refs));
}

/** A representative value for a schema: enums pick their first option, bounds their minimum. */
export function generateSchemaExample(
  schema: unknown,
  resolve: (key: string) => SchemaNode | undefined,
  depth = 0,
): unknown {
  if (!schema || typeof schema !== "object" || depth > 8) return null;

  const node = schema as SchemaNode;

  if ("const" in node) return node.const;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
  if (typeof node.schema === "string") {
    const referenced = resolve(node.schema);
    return referenced ? generateSchemaExample(referenced, resolve, depth + 1) : null;
  }
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    return generateSchemaExample(node.oneOf[0], resolve, depth + 1);
  }

  switch (node.type) {
    case "string": {
      if (node.format === "date-time") return "2026-01-01T00:00:00Z";
      if (node.format === "semver") return "1.0.0";
      const minLength = Number(node.minLength) || 0;
      return minLength > 7 ? "x".repeat(minLength) : "example";
    }
    case "integer":
      return typeof node.minimum === "number" ? Math.ceil(node.minimum) : 1;
    case "number":
      return typeof node.minimum === "number" ? node.minimum : 0.5;
    case "boolean":
      return true;
    case "array": {
      const count = Math.max(1, Number(node.minItems) || 0);
      return Array.from({ length: Math.min(count, 3) }, () =>
        generateSchemaExample(node.items, resolve, depth + 1),
      );
    }
    case "object": {
      const properties = (node.properties || {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          generateSchemaExample(value, resolve, depth + 1),
        ]),
      );
    }
    case "json":
      return {};
    default:
      return null;
  }
}

/** Load every schema referenced (transitively) so examples can include their shapes. */
function useReferencedSchemas(schema: unknown, setKey?: string) {
  const [schemas, setSchemas] = React.useState<Map<string, SchemaNode>>(new Map());

  React.useEffect(() => {
    let active = true;
    const loaded = new Map<string, SchemaNode>();

    async function load(value: unknown, depth: number) {
      if (depth > 5) return;
      const refs = new Set<string>();
      collectSchemaRefs(value, refs);
      await Promise.all(
        [...refs]
          .filter((key) => !loaded.has(key))
          .map(async (key) => {
            try {
              const detail = await fetchEntityDetail("schema", key, setKey);
              loaded.set(key, detail.entity as SchemaNode);
              await load(detail.entity, depth + 1);
            } catch {
              // An unresolved reference renders as null in the example.
            }
          }),
      );
    }

    load(schema, 0).then(() => active && setSchemas(new Map(loaded)));

    return () => {
      active = false;
    };
  }, [schema, setKey]);

  return schemas;
}

export function SchemaExample(props: { schema: unknown; setKey?: string; title?: string }) {
  const schemas = useReferencedSchemas(props.schema, props.setKey);
  const example = React.useMemo(
    () => generateSchemaExample(props.schema, (key) => schemas.get(key)),
    [props.schema, schemas],
  );

  if (example === null || example === undefined) return null;

  return (
    <OverviewSection title={props.title || "Example value"}>
      <CodeBlock value={example} />
      <p className="mt-1.5 text-xs text-faint">
        Generated from the schema: first enum options, minimum bounds and one item per array.
      </p>
    </OverviewSection>
  );
}

/** A prominent notice for deprecated or archived entities, which a small badge undersells. */
export function LifecycleBanner(props: {
  type: CatalogEntityType;
  entity: Record<string, unknown>;
  /** Entities using it directly, and those reaching it only through them. */
  usage?: { direct: number; indirect: number };
}) {
  const label = entityLabels[props.type].singular.toLowerCase();
  const direct = props.usage?.direct || 0;
  const indirect = props.usage?.indirect || 0;

  if (props.entity.archived === true) {
    return (
      <div className="mx-6 mb-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
        <p className="font-semibold">This {label} is archived</p>
        <p className="mt-0.5 text-rose-800/90">
          Archived definitions are left out of built datafiles, so SDKs no longer see it.
        </p>
      </div>
    );
  }

  if (props.entity.deprecated === true) {
    return (
      <div className="mx-6 mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
        <p className="font-semibold">This {label} is deprecated</p>
        <p className="mt-0.5 text-amber-900/90">
          {props.type === "feature"
            ? "SDKs report a deprecated_feature diagnostic whenever it is evaluated. Move callers off it before archiving."
            : "Avoid adding new references to it, and move existing ones off before archiving."}
        </p>
        {direct + indirect > 0 && (
          <p className="mt-1.5 text-amber-900/90">
            <Link to="usage" className="font-medium underline underline-offset-2">
              {pluralize(direct, "entity", "entities")} {direct === 1 ? "refers" : "refer"} to it
              {indirect > 0 ? `, and ${indirect} more depend on it through them` : ""}
            </Link>
            .
          </p>
        )}
      </div>
    );
  }

  return null;
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Deprecated features this entity relies on, with the chain to each one reached through
 * others, so its owners know what has to move before those features are archived.
 */
export function DeprecatedDependencies(props: { detail: EntityDetail; setKey?: string }) {
  const summaryOf = useSummaryLookup(props.setKey);
  const { uses, usesIndirectly } = useEntityDependencies(props.detail, props.setKey);
  const deprecated = [
    ...uses.map((entry) => ({ ...entry, via: [] as EntityReference[] })),
    ...usesIndirectly,
  ].filter((entry) => entry.type === "feature" && summaryOf(entry)?.deprecated);

  if (!deprecated.length) return null;
  const label = entityLabels[props.detail.type].singular.toLowerCase();

  return (
    <div className="mx-6 mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
      <p className="font-semibold">
        This {label} depends on{" "}
        {deprecated.length === 1
          ? "a deprecated feature"
          : `${deprecated.length} deprecated features`}
      </p>
      <ul className="mt-1 space-y-0.5 text-amber-900/90">
        {deprecated.map((entry) => (
          <li key={entry.key} className="flex flex-wrap items-center gap-x-1.5">
            <Link
              to={getEntityRoute("feature", entry.key, props.setKey)}
              className="font-mono font-medium underline underline-offset-2"
            >
              {entry.key}
            </Link>
            {entry.via.length > 0 && (
              <span>
                through{" "}
                {entry.via
                  .map((step) => `${step.type === "feature" ? "" : `${step.type} `}${step.key}`)
                  .join(" › ")}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-amber-900/90">Move off it before it is archived.</p>
    </div>
  );
}

type DependencyNode = { type: CatalogEntityType; key: string };

/** Entities whose conditions reference this entity. */
export function getRequiredBy(detail: EntityDetail): DependencyNode[] {
  return (detail.usedBy || [])
    .filter((owner) =>
      owner.locations.some(
        (location) => !location.startsWith("compose ") && !location.startsWith("alias of "),
      ),
    )
    .map((owner) => ({ type: owner.type, key: owner.key }));
}
