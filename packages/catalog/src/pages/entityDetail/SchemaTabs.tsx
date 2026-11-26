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
interface EntryNode {
  path: string;
  node: Node;
}

/** How many entries a list holds, those nested under them included. */
function countNested(list: unknown, nested: string): number {
  return Array.isArray(list)
    ? list.reduce<number>(
        (count, entry) => count + 1 + (isNode(entry) ? countNested(entry[nested], nested) : 0),
        0,
      )
    : 0;
}

/** How many mutations a node lists: its list, or at a schema's root its list per environment. */
function countMutations(mutations: unknown): number {
  if (Array.isArray(mutations)) return countNested(mutations, "mutations");
  return isNode(mutations)
    ? Object.values(mutations).reduce<number>(
        (count, list) => count + countNested(list, "mutations"),
        0,
      )
    : 0;
}

/** Every node with mutations or issues, the root first, in the order the file writes them. */
export function getSchemaEntryNodes(schema: unknown): EntryNode[] {
  const found: EntryNode[] = [];
  const visit = (node: unknown, path: string) => {
    if (!isNode(node)) return;
    if (
      countMutations(node.mutations) > 0 ||
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

/** How many mutations the Mutations tab shows: in every environment's list, nested ones included. */
export function countSchemaMutations(schema: unknown): number {
  return getSchemaEntryNodes(schema).reduce(
    (count, { node }) => count + countMutations(node.mutations),
    0,
  );
}

/** How many issue entries the Issues tab shows, nested ones included. */
export function countSchemaIssues(schema: unknown): number {
  return getSchemaEntryNodes(schema).reduce(
    (count, { node }) => count + countNested(node.issues, "issues"),
    0,
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

function EntryCard(props: {
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

/** A mutation's card, with the mutations nested under it inside, each checked once it matches. */
function MutationCard(props: {
  mutation: unknown;
  path: string;
  index: number;
  setKey: ReturnType<typeof useEntityDetail>["setKey"];
}) {
  const record = isNode(props.mutation) ? props.mutation : {};
  const key = typeof record.key === "string" ? record.key : `#${props.index + 1}`;
  const nested = Array.isArray(record.mutations) ? record.mutations : [];
  return (
    <EntryCard
      id={`mutation-${slugifyFragment(`${props.path} ${key}`)}`}
      title={key}
      path={props.path}
      description={record.description}
    >
      <Labelled label="When">
        <ConditionTree conditions={record.conditions as never} setKey={props.setKey} />
      </Labelled>
      {record.mutate !== undefined && (
        <Labelled label="Changes">
          <Changes mutate={record.mutate} />
        </Labelled>
      )}
      {nested.length > 0 && (
        <Labelled label="Then, when these also match">
          <div className="space-y-3">
            {nested.map((child, index) => (
              <MutationCard
                key={index}
                mutation={child}
                path={props.path}
                index={index}
                setKey={props.setKey}
              />
            ))}
          </div>
        </Labelled>
      )}
    </EntryCard>
  );
}

/** An issue entry's card, with the entries nested under it inside, each checked once it matches. */
function IssueCard(props: {
  issue: unknown;
  path: string;
  index: number;
  setKey: ReturnType<typeof useEntityDetail>["setKey"];
}) {
  const record = isNode(props.issue) ? props.issue : {};
  const key = typeof record.key === "string" ? record.key : `#${props.index + 1}`;
  const nested = Array.isArray(record.issues) ? record.issues : [];
  return (
    <EntryCard
      id={`issue-${slugifyFragment(`${props.path} ${key}`)}`}
      title={key}
      path={props.path}
      description={record.description}
    >
      <Labelled label={typeof record.message === "string" ? "Reported when" : "When"}>
        <ConditionTree conditions={record.conditions as never} setKey={props.setKey} />
      </Labelled>
      {typeof record.message === "string" && (
        <>
          <Labelled label="Reported on">
            <code className="font-mono text-xs text-text">
              {typeof record.path === "string" ? record.path : "the object itself"}
            </code>
          </Labelled>
          <Labelled label="Message">
            <p className="text-sm text-text">{record.message}</p>
          </Labelled>
        </>
      )}
      {nested.length > 0 && (
        <Labelled label="Then, when these also match">
          <div className="space-y-3">
            {nested.map((child, index) => (
              <IssueCard
                key={index}
                issue={child}
                path={props.path}
                index={index}
                setKey={props.setKey}
              />
            ))}
          </div>
        </Labelled>
      )}
    </EntryCard>
  );
}

/**
 * A schema's mutations: at the root listed per environment in a project with
 * environments, and at any node, each changing the rules when its conditions
 * match a value being validated.
 */
export function SchemaMutationsTab() {
  const { detail, setKey } = useEntityDetail();
  const { environmentKey } = useParams();
  const schema = detail.entity as Node;
  const configured = useOptionalCatalog()?.manifest.projectConfig.environments;
  const inherit = useInheritEnvironments();
  const byEnvironment = isNode(schema.mutations) ? schema.mutations : undefined;
  const environments = byEnvironment
    ? [...(configured || Object.keys(byEnvironment))].sort(sortEnvironmentKeys)
    : [];
  const selected = useSelectedEnvironment(environments, environmentKey);
  useScrollToHash([detail.key]);

  // An environment without a list uses the one it inherits from, as the builder resolves it.
  const lists = (environment: string | undefined) =>
    !!byEnvironment &&
    !!environment &&
    Object.prototype.hasOwnProperty.call(byEnvironment, environment);
  const inherited = selected ? inherit?.[selected]?.from : undefined;
  const listFrom = lists(selected) ? selected : lists(inherited) ? inherited : undefined;
  const rootList = byEnvironment && listFrom ? byEnvironment[listFrom] : undefined;

  const mutations = [
    ...(Array.isArray(rootList) ? rootList : []).map((mutation) => ({ path: "", mutation })),
    ...getSchemaEntryNodes(schema).flatMap(({ path, node }) =>
      (Array.isArray(node.mutations) ? node.mutations : []).map((mutation) => ({
        path,
        mutation,
      })),
    ),
  ];

  if (!byEnvironment && mutations.length === 0) {
    return (
      <EmptyState
        title="No mutations"
        description="This schema's rules are the same in every environment and for every value."
      />
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">
        Every mutation whose conditions match changes the schema's rules, in order, when a value is
        validated. Those that always apply, before any others, are applied when the datafile is
        built.
      </p>
      {byEnvironment && (
        <>
          <EnvironmentPills
            base="mutations"
            environments={environments}
            selectedEnvironment={selected}
          />
          {selected && (listFrom !== selected || !Array.isArray(rootList) || !rootList.length) && (
            <p className="text-sm text-muted">
              {listFrom && listFrom !== selected
                ? `${selected} uses the mutations of ${listFrom}.`
                : `${selected} lists no mutations at the root.`}
            </p>
          )}
        </>
      )}
      {mutations.map(({ path, mutation }, index) => (
        <MutationCard
          key={`${path}:${index}`}
          mutation={mutation}
          path={path}
          index={index}
          setKey={setKey}
        />
      ))}
    </section>
  );
}

/**
 * A schema's issues: entries on its objects, each reporting an issue when its
 * conditions match, after the object's own rules.
 */
export function SchemaIssuesTab() {
  const { detail, setKey } = useEntityDetail();
  const schema = detail.entity as Node;
  useScrollToHash([detail.key]);
  const issues = getSchemaEntryNodes(schema).flatMap(({ path, node }) =>
    (Array.isArray(node.issues) ? node.issues : []).map((issue) => ({ path, issue })),
  );

  if (issues.length === 0) {
    return (
      <EmptyState
        title="No issues"
        description="Nothing checks this schema's fields against each other."
      />
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted">
        Each issue is reported when its conditions match, after the object's own rules, so its
        conditions say when a value fails.
      </p>
      {issues.map(({ path, issue }, index) => (
        <IssueCard
          key={`${path}:${index}`}
          issue={issue}
          path={path}
          index={index}
          setKey={setKey}
        />
      ))}
    </section>
  );
}
