import * as React from "react";
import { useParams } from "react-router-dom";

import { EmptyState, EntityKey, MarkdownContent } from "../../components/ui";
import { ConditionTree } from "../../components/trees";
import { VariableValueView } from "../../components/variables";
import { useOptionalCatalog } from "../../context/CatalogContext";
import { RulePermalink, slugifyFragment, useEntityDetail, useScrollToHash } from "./shared";
import {
  EnvironmentPills,
  sortEnvironmentKeys,
  useInheritEnvironments,
  useSelectedEnvironment,
} from "./environments";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A schema node with its mutations or issues, and where it sits, such as `address` or `items[]`. */
interface RuleNode {
  path: string;
  node: Node;
}

/** Every node with mutations or issues, the root first, in the order the file writes them. */
export function getSchemaRuleNodes(schema: unknown): RuleNode[] {
  const found: RuleNode[] = [];
  const visit = (node: unknown, path: string) => {
    if (!isNode(node)) return;
    if (
      (Array.isArray(node.mutations) && node.mutations.length > 0) ||
      (Array.isArray(node.issues) && node.issues.length > 0)
    )
      found.push({ path, node });
    const join = (part: string) => (path ? `${path}.${part}` : part);
    if (isNode(node.properties))
      for (const [key, property] of Object.entries(node.properties)) visit(property, join(key));
    if (isNode(node.items)) visit(node.items, `${path}[]`);
    if (isNode(node.additionalProperties)) visit(node.additionalProperties, join("*"));
    if (Array.isArray(node.oneOf))
      node.oneOf.forEach((branch, index) => visit(branch, `${path} oneOf ${index + 1}`.trim()));
  };
  visit(schema, "");
  return found;
}

/** How many rules a schema's Rules tab shows: environment entries, mutations and issues. */
export function countSchemaRules(schema: unknown): number {
  const environments = isNode(schema) && isNode(schema.environments) ? schema.environments : {};
  return (
    Object.keys(environments).length +
    getSchemaRuleNodes(schema).reduce(
      (count, { node }) =>
        count +
        (Array.isArray(node.mutations) ? node.mutations.length : 0) +
        (Array.isArray(node.issues) ? node.issues.length : 0),
      0,
    )
  );
}

/** A `mutate` value's changes, in the order they apply, whether written as a map or a list of maps. */
function getChanges(mutate: unknown): Array<[string, unknown]> {
  if (Array.isArray(mutate)) return mutate.flatMap(getChanges);
  return isNode(mutate) ? Object.entries(mutate) : [];
}

function Changes(props: { mutate: unknown }) {
  const changes = getChanges(props.mutate);
  if (changes.length === 0) return <p className="text-sm text-muted">Changes nothing.</p>;
  return (
    <ul className="space-y-2">
      {changes.map(([path, value], index) => (
        // As the file writes it, `path: value`, with a structured value below its path.
        <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <code className="font-mono text-xs text-text [overflow-wrap:anywhere]">
            {path}
            <span className="text-faint">:</span>
          </code>
          <div className="min-w-0 max-w-full">
            <VariableValueView value={value} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Where(props: { path: string }) {
  return props.path ? (
    <span className="text-xs text-muted">
      at <code className="font-mono text-text">{props.path}</code>
    </span>
  ) : null;
}

function RuleCard(props: {
  id: string;
  title: string;
  path: string;
  description?: unknown;
  children: React.ReactNode;
}) {
  return (
    <section
      id={props.id}
      className="group scroll-mt-24 rounded-xl border border-border bg-elevated p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-text">
          <EntityKey value={props.title} />
        </h3>
        <RulePermalink targetId={props.id} />
        <Where path={props.path} />
      </div>
      {typeof props.description === "string" && props.description && (
        <div className="mb-3">
          <MarkdownContent value={props.description} quiet />
        </div>
      )}
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

function Labelled(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-sm font-semibold text-muted">{props.label}</h4>
      {props.children}
    </div>
  );
}

/**
 * A schema's rules that change: per environment, resolved when its datafile is built, and under
 * conditions, applied when a value is validated, with the issues an object reports.
 */
export function SchemaRulesTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const schema = detail.entity as Node;
  const configured = useOptionalCatalog()?.manifest.projectConfig.environments;
  const inherit = useInheritEnvironments();
  const entries = isNode(schema.environments) ? schema.environments : undefined;
  const environments = entries
    ? [...(configured || Object.keys(entries))].sort(sortEnvironmentKeys)
    : [];
  const selected = useSelectedEnvironment(environments, environmentKey);
  const nodes = getSchemaRuleNodes(schema);
  useScrollToHash([detail.key]);

  // An environment without an entry uses the one it inherits from, then the base.
  let entryFrom: string | undefined = selected;
  const seen = new Set<string>();
  while (entryFrom && entries && !Object.prototype.hasOwnProperty.call(entries, entryFrom)) {
    if (seen.has(entryFrom)) break;
    seen.add(entryFrom);
    entryFrom = inherit?.[entryFrom]?.from;
  }
  const entry =
    entries && entryFrom && Object.prototype.hasOwnProperty.call(entries, entryFrom)
      ? entries[entryFrom]
      : undefined;

  const mutations = nodes.flatMap(({ path, node }) =>
    (Array.isArray(node.mutations) ? node.mutations : []).map((mutation) => ({ path, mutation })),
  );
  const issues = nodes.flatMap(({ path, node }) =>
    (Array.isArray(node.issues) ? node.issues : []).map((issue) => ({ path, issue })),
  );

  if (!entries && mutations.length === 0 && issues.length === 0) {
    return (
      <EmptyState
        title="No rules that change"
        description="This schema's rules are the same in every environment and for every value."
      />
    );
  }

  return (
    <div className="space-y-8">
      {entries && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text">Per environment</h2>
            <p className="text-sm text-muted">
              Each environment's datafile holds the schema with its entry applied.
            </p>
          </div>
          <EnvironmentPills
            base="rules"
            environments={environments}
            selectedEnvironment={selected}
          />
          {selected && (
            <div className="rounded-xl border border-border bg-elevated p-4">
              {entry === undefined ? (
                <p className="text-sm text-muted">{selected} uses the base rules.</p>
              ) : (
                <>
                  {entryFrom !== selected && (
                    <p className="mb-3 text-sm text-muted">
                      {selected} uses the entry of {entryFrom}.
                    </p>
                  )}
                  {isNode(entry) && entry.mutate !== undefined ? (
                    <Changes mutate={entry.mutate} />
                  ) : (
                    <p className="text-sm text-muted">
                      An empty entry, so {selected} uses the base rules.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {mutations.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text">Mutations</h2>
            <p className="text-sm text-muted">
              Every mutation whose conditions match changes the rules, in order, when a value is
              validated.
            </p>
          </div>
          {mutations.map(({ path, mutation }, index) => {
            const record = isNode(mutation) ? mutation : {};
            const key = typeof record.key === "string" ? record.key : `#${index + 1}`;
            return (
              <RuleCard
                key={`${path}:${key}:${index}`}
                id={`mutation-${slugifyFragment(`${path} ${key}`)}`}
                title={key}
                path={path}
                description={record.description}
              >
                <Labelled label="When">
                  <ConditionTree conditions={record.conditions as never} setKey={setKey} />
                </Labelled>
                <Labelled label="Changes">
                  <Changes mutate={record.mutate} />
                </Labelled>
              </RuleCard>
            );
          })}
        </section>
      )}

      {issues.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text">Issues</h2>
            <p className="text-sm text-muted">
              Each issue is reported when its conditions match, after the object's own rules.
            </p>
          </div>
          {issues.map(({ path, issue }, index) => {
            const record = isNode(issue) ? issue : {};
            const key = typeof record.key === "string" ? record.key : `#${index + 1}`;
            return (
              <RuleCard
                key={`${path}:${key}:${index}`}
                id={`issue-${slugifyFragment(`${path} ${key}`)}`}
                title={key}
                path={path}
                description={record.description}
              >
                <Labelled label="Reported when">
                  <ConditionTree conditions={record.conditions as never} setKey={setKey} />
                </Labelled>
                <Labelled label="Reported on">
                  <code className="font-mono text-xs text-text">
                    {typeof record.path === "string" ? record.path : "the object itself"}
                  </code>
                </Labelled>
                {typeof record.message === "string" && (
                  <Labelled label="Message">
                    <p className="text-sm text-text">{record.message}</p>
                  </Labelled>
                )}
              </RuleCard>
            );
          })}
        </section>
      )}
    </div>
  );
}
