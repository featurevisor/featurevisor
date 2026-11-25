import * as React from "react";
import { Link } from "react-router-dom";

import { SchemaRefLink, TypeBadge, getSchemaAnnotations, slugifyFragment } from "./variables";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function joinPath(first: string, second: string) {
  return first && second ? `${first}.${second}` : first || second;
}

/** A range as a person says it: "2 to 40 characters", "at least 1 item", "at most 5". */
function range(min: unknown, max: unknown, unit?: string): string | undefined {
  const low = typeof min === "number" ? min : undefined;
  const high = typeof max === "number" ? max : undefined;
  const counted = (count: number) => (unit ? plural(count, unit) : String(count));
  if (low !== undefined && high !== undefined) {
    if (low === high) return `exactly ${counted(low)}`;
    return unit ? `${low} to ${high} ${unit}s` : `${low} to ${high}`;
  }
  if (low !== undefined) return `at least ${counted(low)}`;
  if (high !== undefined) return unit ? `up to ${counted(high)}` : `at most ${high}`;
  return undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

/** The branch of a nullable `oneOf` that is not `null`, or undefined for any other node. */
function nullableOf(node: Node): Node | undefined {
  const branches = Array.isArray(node.oneOf) ? node.oneOf.filter(isNode) : [];
  if (branches.length !== 2) return undefined;
  const nulls = branches.filter((branch) => "const" in branch && branch.const === null);
  return nulls.length === 1 ? branches.find((branch) => !nulls.includes(branch)) : undefined;
}

function isChoiceList(node: Node): boolean {
  return (
    Array.isArray(node.oneOf) &&
    node.oneOf.length > 0 &&
    node.oneOf.every((branch) => isNode(branch) && "const" in branch)
  );
}

/** The branches of a `oneOf` that is neither a list of choices nor a nullable value. */
function branchesOf(node: Node): Node[] | undefined {
  if (!Array.isArray(node.oneOf) || isChoiceList(node) || nullableOf(node)) return undefined;
  return node.oneOf.filter(isNode);
}

/** One choice: its value, the title it shows and what else its vocabulary gives it. */
interface Choice {
  value: unknown;
  title?: string;
  fields: [string, unknown][];
}

function toChoice(value: unknown, entry: unknown): Choice {
  const { title, ...fields } = isNode(entry) ? entry : {};
  return {
    value,
    title: typeof title === "string" ? title : undefined,
    fields: Object.entries(fields),
  };
}

/** A node's choices, from an `enum` and its `options` annotation, or from a `oneOf` of consts. */
export function choicesOf(node: Node): Choice[] | undefined {
  if (Array.isArray(node.enum)) {
    const options = getSchemaAnnotations(node)?.options;
    return node.enum.map((value) => {
      const key = typeof value === "string" ? value : JSON.stringify(value);
      return toChoice(value, isNode(options) ? options[key] : undefined);
    });
  }
  if (isChoiceList(node)) {
    return (node.oneOf as Node[]).map((branch) =>
      toChoice(branch.const, getSchemaAnnotations(branch)),
    );
  }
  return undefined;
}

/* ---------------------------------------------------------------------------
 * What changes: mutations that change a field, and issues that report on it,
 * each linking to its card on the Rules tab.
 * ------------------------------------------------------------------------- */

/** A mutation or an issue entry, as a link to its card on the Rules tab. */
interface RuleLink {
  key: string;
  kind: "mutation" | "issue";
  to: { pathname: string; hash: string };
  /** The environments whose root lists hold it, for a schema with mutations by environment. */
  environments: string[];
}

type Changes = Map<string, RuleLink[]>;

const ChangesContext = React.createContext<Changes>(new Map());

/** A `mutate` value's entries, written as a map or as a list of single entry maps. */
function mutateEntries(mutate: unknown): [string, unknown][] {
  if (Array.isArray(mutate)) return mutate.flatMap(mutateEntries);
  return isNode(mutate) ? Object.entries(mutate) : [];
}

/**
 * The fields a mutation changes, by dot paths relative to its node, `""` for
 * the node itself: `properties.taxId.pattern` changes `taxId`, and
 * `required:appendUnique: taxId` makes `taxId` required.
 */
function changedFields(mutate: unknown): string[] {
  const changed = new Set<string>();
  for (const [notation, value] of mutateEntries(mutate)) {
    const parts = notation.replace(/:[A-Za-z]+$/, "").split(".");
    const field: string[] = [];
    let index = 0;
    for (;;) {
      if (parts[index] === "properties" && index + 1 < parts.length) {
        field.push(parts[index + 1]);
        index += 2;
      } else if (parts[index] === "items") {
        index += 1;
      } else if (parts[index] === "additionalProperties") {
        field.push("*");
        index += 1;
      } else break;
    }
    const rest = parts.slice(index);
    if (rest[0] === "required") {
      for (const name of Array.isArray(value) ? value : [value])
        if (typeof name === "string") changed.add([...field, name].join("."));
    } else if (rest[0] === "messages" && (rest.length > 2 || isNode(value))) {
      // An object's messages are keyed by field, so `messages.email.pattern` words `email`.
      changed.add([...field, rest[1]].filter(Boolean).join("."));
    } else {
      changed.add(field.join("."));
    }
  }
  return [...changed];
}

/** Every mutation and issue entry in a schema, by the field paths they change or report on. */
function collectChanges(schema: Node): Changes {
  const changes: Changes = new Map();
  const add = (path: string, link: RuleLink) => {
    const list = changes.get(path) || [];
    const existing = list.find((each) => each.kind === link.kind && each.key === link.key);
    if (existing) {
      for (const environment of link.environments)
        if (!existing.environments.includes(environment)) existing.environments.push(environment);
    } else list.push({ ...link, environments: [...link.environments] });
    changes.set(path, list);
  };

  // `rulePath` is where the Rules tab says a node sits, which its card's anchor is made from.
  const visit = (node: unknown, fieldPath: string, rulePath: string, depth: number) => {
    if (!isNode(node) || depth > 12) return;
    const lists: [string | undefined, unknown][] = Array.isArray(node.mutations)
      ? [[undefined, node.mutations]]
      : isNode(node.mutations)
        ? Object.entries(node.mutations)
        : [];
    for (const [environment, list] of lists) {
      const walk = (entries: unknown) => {
        if (!Array.isArray(entries)) return;
        for (const mutation of entries) {
          if (!isNode(mutation) || typeof mutation.key !== "string") continue;
          const link: RuleLink = {
            key: mutation.key,
            kind: "mutation",
            to: {
              pathname: environment ? `rules/${environment}` : "rules",
              hash: `#mutation-${slugifyFragment(`${rulePath} ${mutation.key}`)}`,
            },
            environments: environment ? [environment] : [],
          };
          for (const changed of changedFields(mutation.mutate))
            add(joinPath(fieldPath, changed), link);
          walk(mutation.mutations);
        }
      };
      walk(list);
    }
    const walkIssues = (entries: unknown) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!isNode(entry) || typeof entry.key !== "string") continue;
        // An entry that only groups others reports nothing itself.
        if (typeof entry.message === "string") {
          add(typeof entry.path === "string" ? joinPath(fieldPath, entry.path) : fieldPath, {
            key: entry.key,
            kind: "issue",
            to: {
              pathname: "rules",
              hash: `#issue-${slugifyFragment(`${rulePath} ${entry.key}`)}`,
            },
            environments: [],
          });
        }
        walkIssues(entry.issues);
      }
    };
    walkIssues(node.issues);
    if (isNode(node.properties))
      for (const [key, child] of Object.entries(node.properties))
        visit(child, joinPath(fieldPath, key), joinPath(rulePath, key), depth + 1);
    if (isNode(node.items)) visit(node.items, fieldPath, `${rulePath}[]`, depth + 1);
    if (isNode(node.additionalProperties))
      visit(
        node.additionalProperties,
        joinPath(fieldPath, "*"),
        joinPath(rulePath, "*"),
        depth + 1,
      );
    if (Array.isArray(node.oneOf))
      node.oneOf.forEach((branch, index) =>
        visit(branch, fieldPath, `${rulePath} oneOf ${index + 1}`.trim(), depth + 1),
      );
  };
  visit(schema, "", "", 0);
  return changes;
}

function RuleLinkChip(props: { link: RuleLink }) {
  const { link } = props;
  const where = link.environments.length > 0 ? ` in ${link.environments.join(", ")}` : "";
  return (
    <Link
      to={link.to}
      title={`${link.kind === "mutation" ? "Mutation" : "Issue"} ${link.key}${where}, on the Rules tab`}
      className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-pill hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {link.key}
    </Link>
  );
}

/** What changes a field under conditions, and what checks it against other fields, as links. */
function FieldChanges(props: { links: RuleLink[] }) {
  const mutations = props.links.filter((link) => link.kind === "mutation");
  const issues = props.links.filter((link) => link.kind === "issue");
  if (mutations.length === 0 && issues.length === 0) return null;
  const line = (label: string, links: RuleLink[]) =>
    links.length > 0 && (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs text-faint">{label}</span>
        {links.map((link) => (
          <RuleLinkChip key={`${link.kind}:${link.key}`} link={link} />
        ))}
      </div>
    );
  return (
    <div className="space-y-1.5">
      {line("Changes under", mutations)}
      {line("Checked by", issues)}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces of a row
 * ------------------------------------------------------------------------- */

/** What a node's type reads as, with a link for a referenced schema. */
function TypeLabel(props: { node: Node; setKey?: string }) {
  const { node } = props;
  const nullable = nullableOf(node);
  if (nullable) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <TypeLabel node={nullable} setKey={props.setKey} />
        <span className="text-[11px] text-faint">or null</span>
      </span>
    );
  }
  if (typeof node.schema === "string")
    return <SchemaRefLink name={node.schema} setKey={props.setKey} />;
  if (node.type === "array" && isNode(node.items)) {
    const items = node.items;
    if (typeof items.schema === "string") {
      return (
        <span className="inline-flex items-center gap-1">
          <SchemaRefLink name={items.schema} setKey={props.setKey} />
          <TypeBadge>[]</TypeBadge>
        </span>
      );
    }
    return <TypeBadge>{`${typeof items.type === "string" ? items.type : "any"}[]`}</TypeBadge>;
  }
  if (typeof node.type === "string") return <TypeBadge>{node.type}</TypeBadge>;
  if (isChoiceList(node)) return <TypeBadge>choice</TypeBadge>;
  if (Array.isArray(node.oneOf)) return <TypeBadge>one of</TypeBadge>;
  return null;
}

/** A node's rules as a person reads them, rather than as keywords. */
function rulesOf(node: Node): React.ReactNode[] {
  const rules: React.ReactNode[] = [];
  const length = range(node.minLength, node.maxLength, "character");
  if (length) rules.push(length);
  const bounds = range(node.minimum, node.maximum);
  if (bounds) rules.push(bounds);
  if (typeof node.pattern === "string") {
    rules.push(
      <>
        matches <code className="font-mono text-[11px] text-text">{node.pattern}</code>
      </>,
    );
  }
  if (node.format === "date-time") rules.push("a timestamp");
  if (node.format === "semver") rules.push("a version");
  const count = range(node.minItems, node.maxItems, "item");
  if (count) rules.push(count);
  if (node.uniqueItems === true) rules.push("no item twice");
  if ("const" in node && !isChoiceList(node)) {
    rules.push(
      <>
        always <code className="font-mono text-[11px] text-text">{JSON.stringify(node.const)}</code>
      </>,
    );
  }
  if (node.additionalProperties === true) rules.push("any other keys too");
  // Without `properties` or `additionalProperties`, an object holds flat values only.
  if (node.type === "object" && !isNode(node.properties) && node.additionalProperties === undefined)
    rules.push("any keys, holding text, numbers, booleans or null");
  return rules;
}

function RuleChips(props: { rules: React.ReactNode[] }) {
  if (props.rules.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {props.rules.map((rule, index) => (
        <li
          key={index}
          className="rounded-md border border-border px-2 py-0.5 text-xs text-muted [overflow-wrap:anywhere]"
        >
          {rule}
        </li>
      ))}
    </ul>
  );
}

function ChoiceChips(props: { choices: Choice[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {props.choices.map((choice, index) => (
        <li
          key={index}
          className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md bg-header-active px-2 py-1 text-xs"
        >
          <code className="font-mono text-[11px] text-text">{formatValue(choice.value)}</code>
          {choice.title && <span className="text-text">{choice.title}</span>}
          {choice.fields.map(([name, value]) => (
            <span key={name} className="text-faint">
              {value === true ? name : `${name} ${formatValue(value)}`}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Names and values, such as annotations or messages by issue code, as a small grid. */
function NameValueGrid(props: { entries: [string, unknown][]; label?: string }) {
  if (props.entries.length === 0) return null;
  return (
    <div>
      {props.label && <p className="mb-1 text-xs text-faint">{props.label}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
        {props.entries.map(([name, value]) => (
          <React.Fragment key={name}>
            <dt className="font-mono text-[11px] leading-5 text-faint">{name}</dt>
            <dd className="text-muted [overflow-wrap:anywhere]">{formatValue(value)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

/** A `oneOf`'s branches, each with its type and rules. */
function Branches(props: { branches: Node[]; setKey?: string }) {
  return (
    <ul className="space-y-2">
      {props.branches.map((branch, index) => (
        <li key={index} className="flex flex-wrap items-center gap-2">
          <TypeLabel node={branch} setKey={props.setKey} />
          <RuleChips rules={rulesOf(branch)} />
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Fields
 * ------------------------------------------------------------------------- */

/** A field of an object, with what it shows and the fields inside it. */
interface Field {
  name: string;
  /** Its dot path from the schema's root, with list items adding nothing, as mutations name fields. */
  path: string;
  node: Node;
  required: boolean;
  /** The node its details come from: a nullable field's other branch. */
  details: Node;
  /** Annotations it shows: its own, and for a list its items' too. */
  annotations: Node;
  /** Its messages by issue code, as validation chooses them: the outermost wording wins. */
  messages: [string, string][];
  children?: { label?: string; fields: Field[] };
}

/** A node's own messages by issue code, leaving out those keyed by field. */
function codeMessages(messages: unknown): [string, string][] {
  return isNode(messages)
    ? Object.entries(messages).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
    : [];
}

/** The message maps that word a key's field, from the scopes around it. */
function scopesFor(scopes: Node[], key: string): Node[] {
  return scopes.map((scope) => scope[key]).filter(isNode);
}

function toField(name: string, path: string, node: Node, required: boolean, scopes: Node[]): Field {
  const details = nullableOf(node) || node;
  const items = details.type === "array" && isNode(details.items) ? details.items : undefined;
  const annotations = { ...(items && getSchemaAnnotations(items)), ...getSchemaAnnotations(node) };
  // Inner wording first, so the outermost scope's wording overwrites it, as validation chooses.
  const messages = new Map<string, string>(codeMessages(node.messages));
  for (const scope of [...scopes].reverse())
    for (const [code, text] of codeMessages(scope)) messages.set(code, text);
  const own = isNode(details.properties)
    ? fieldsOf(details, path, [...scopes, ...(isNode(details.messages) ? [details.messages] : [])])
    : undefined;
  const itemScopes = [...scopes, ...(isNode(details.messages) ? [details.messages] : [])].flatMap(
    (scope) => (isNode(scope["[]"]) ? [scope["[]"] as Node] : []),
  );
  const each =
    items && isNode(items.properties)
      ? fieldsOf(items, path, [...itemScopes, ...(isNode(items.messages) ? [items.messages] : [])])
      : undefined;
  return {
    name,
    path,
    node,
    required,
    details,
    annotations,
    messages: [...messages],
    children: own ? { fields: own } : each ? { label: "Each item", fields: each } : undefined,
  };
}

/**
 * An object's fields, those its `order` annotation lists first, then the rest
 * as written. `scopes` are the message maps around the object that reach into
 * it, its own included, outermost first.
 */
export function fieldsOf(node: Node, prefix = "", scopes?: Node[]): Field[] {
  const around = scopes ?? (isNode(node.messages) ? [node.messages] : []);
  const properties = isNode(node.properties) ? node.properties : {};
  const required = new Set(Array.isArray(node.required) ? node.required.map(String) : []);
  const order = getSchemaAnnotations(node)?.order;
  const listed = Array.isArray(order)
    ? order.filter((key): key is string => typeof key === "string")
    : [];
  const keys = [
    ...listed.filter((key, index) => key in properties && listed.indexOf(key) === index),
    ...Object.keys(properties).filter((key) => !listed.includes(key)),
  ];
  const fields = keys
    .filter((key) => isNode(properties[key]))
    .map((key) =>
      toField(
        key,
        joinPath(prefix, key),
        properties[key] as Node,
        required.has(key),
        scopesFor(around, key),
      ),
    );
  if (isNode(node.additionalProperties)) {
    fields.push(
      toField("*", joinPath(prefix, "*"), node.additionalProperties, false, scopesFor(around, "*")),
    );
  }
  return fields;
}

/** Annotations shown in the grid: not the title, which leads, `options`, which the choices show, or `order`, which the fields follow. */
function gridAnnotations(annotations: Node): [string, unknown][] {
  return Object.entries(annotations).filter(
    ([name]) => name !== "title" && name !== "options" && name !== "order",
  );
}

function FieldRow(props: { field: Field; setKey?: string; nested?: boolean }) {
  const { field } = props;
  const changes = React.useContext(ChangesContext);
  const title = typeof field.annotations.title === "string" ? field.annotations.title : undefined;
  const branches = branchesOf(field.details);
  const rules = branches ? [] : rulesOf(field.details);
  const items =
    field.details.type === "array" && isNode(field.details.items) ? field.details.items : undefined;
  const choices = choicesOf(field.details) || (items && choicesOf(items));
  const itemRules = items && !field.children ? rulesOf(items) : [];
  const description =
    typeof field.node.description === "string" ? field.node.description.trim() : undefined;
  return (
    <li
      className={[
        "grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]",
        props.nested ? "px-4 py-3" : "px-5 py-4",
      ].join(" ")}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <code className="font-mono text-[13px] font-medium text-text [overflow-wrap:anywhere]">
            {field.name === "*" ? "any other key" : field.name}
          </code>
          {field.required && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-danger">
              required
            </span>
          )}
        </div>
        <TypeLabel node={field.node} setKey={props.setKey} />
      </div>
      <div className="min-w-0 space-y-2.5">
        {title && <p className="text-sm font-medium text-text">{title}</p>}
        {branches && <Branches branches={branches} setKey={props.setKey} />}
        <RuleChips rules={[...rules, ...itemRules]} />
        {choices && <ChoiceChips choices={choices} />}
        <NameValueGrid entries={gridAnnotations(field.annotations)} />
        <NameValueGrid entries={field.messages} label="When it fails" />
        <FieldChanges links={changes.get(field.path) || []} />
        {description && <p className="text-[13px] text-muted">{description}</p>}
        {field.children && (
          <div>
            {field.children.label && (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {field.children.label}
              </p>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border">
              {field.children.fields.map((child) => (
                <FieldRow key={child.name} field={child} setKey={props.setKey} nested />
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/** A vocabulary a schema's annotations or choices follow: a referenced schema, or one written inline. */
function Vocabulary(props: { label: string; schema: unknown; setKey?: string }) {
  if (!isNode(props.schema)) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs text-faint">{props.label}</span>
      {typeof props.schema.schema === "string" ? (
        <SchemaRefLink name={props.schema.schema} setKey={props.setKey} />
      ) : (
        <span className="text-xs text-muted">an inline vocabulary</span>
      )}
    </div>
  );
}

/**
 * The top of the card, for the schema as a whole: its title as a heading, its
 * other annotations, the vocabularies they follow, its own messages, and what
 * changes or checks it beyond one field, such as a field a mutation adds.
 */
function RootHeader(props: {
  node: Node;
  fieldPaths?: string[];
  alone?: boolean;
  setKey?: string;
}) {
  const changes = React.useContext(ChangesContext);
  const annotations = getSchemaAnnotations(props.node) || {};
  const title = typeof annotations.title === "string" ? annotations.title : undefined;
  const ordered = Array.isArray(annotations.order);
  const messages = codeMessages(props.node.messages);
  const own = changes.get("") || [];
  // A field a mutation adds, or one the schema lists nowhere, has no row of its own.
  const known = new Set(props.fieldPaths || []);
  const added = props.fieldPaths
    ? [...changes.entries()].filter(
        ([path, links]) =>
          path !== "" &&
          !known.has(path) &&
          ![...known].some((field) => path.startsWith(`${field}.`)) &&
          links.some((link) => link.kind === "mutation"),
      )
    : [];
  const shown =
    title ||
    gridAnnotations(annotations).length > 0 ||
    ordered ||
    isNode(props.node.annotationsSchema) ||
    isNode(props.node.optionSchema) ||
    messages.length > 0 ||
    own.length > 0 ||
    added.length > 0;
  if (!shown) return null;
  return (
    <div
      className={["space-y-2.5 px-5 py-4", props.alone ? "" : "border-b border-border"].join(" ")}
    >
      {title && <p className="text-base font-semibold text-text">{title}</p>}
      <NameValueGrid entries={gridAnnotations(annotations)} />
      {ordered && (
        <p className="text-xs text-faint">
          Fields in the order its <code className="font-mono">order</code> annotation lists.
        </p>
      )}
      <Vocabulary
        label="Annotations follow"
        schema={props.node.annotationsSchema}
        setKey={props.setKey}
      />
      <Vocabulary label="Choices follow" schema={props.node.optionSchema} setKey={props.setKey} />
      <NameValueGrid entries={messages} label="When it fails" />
      <FieldChanges links={own} />
      {added.map(([path, links]) => (
        <div key={path} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-faint">Adds</span>
          <code className="font-mono text-[12px] text-text">{path}</code>
          <span className="text-xs text-faint">under</span>
          {links
            .filter((link) => link.kind === "mutation")
            .map((link) => (
              <RuleLinkChip key={link.key} link={link} />
            ))}
        </div>
      ))}
    </div>
  );
}

/** Every field path a list of fields shows, nested ones included. */
function pathsOf(fields: Field[]): string[] {
  return fields.flatMap((field) => [field.path, ...pathsOf(field.children?.fields || [])]);
}

/**
 * A schema's structure on its Overview, as a list of fields: each with its
 * name, type and whether it is required, then its title, its rules in words,
 * its choices, its other annotations, its messages, what changes or checks it
 * on the Rules tab, and any notes for maintainers. Nested objects and the
 * items of a list of objects show their fields inside.
 */
export function SchemaFields(props: { schema: Node; setKey?: string }) {
  const { schema } = props;
  const changes = React.useMemo(() => collectChanges(schema), [schema]);
  const rootRules = rulesOf(schema);
  const isList = schema.type === "array" && isNode(schema.items);
  const items = isList ? (schema.items as Node) : undefined;
  const fields = items
    ? isNode(items.properties)
      ? fieldsOf(items)
      : // The root's changes show in the header, so the item's row takes a path no mutation names.
        [toField("each item", "\u0000item", items, false, [])]
    : fieldsOf(schema);

  return (
    <ChangesContext.Provider value={changes}>
      <div className="overflow-hidden rounded-xl border border-border bg-elevated">
        <RootHeader node={schema} fieldPaths={pathsOf(fields)} setKey={props.setKey} />
        {rootRules.length > 0 && (
          <div className="border-b border-border px-5 py-3">
            <RuleChips rules={rootRules} />
          </div>
        )}
        {fields.length > 0 && (
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <FieldRow key={field.path || field.name} field={field} setKey={props.setKey} />
            ))}
          </ul>
        )}
      </div>
    </ChangesContext.Provider>
  );
}

/** A schema that is a list of choices, one row each: its value, then its title and what it carries. */
export function SchemaChoices(props: { schema: Node; setKey?: string }) {
  const branches = (props.schema.oneOf as Node[]) || [];
  const changes = React.useMemo(() => collectChanges(props.schema), [props.schema]);
  return (
    <ChangesContext.Provider value={changes}>
      <div className="overflow-hidden rounded-xl border border-border bg-elevated">
        <RootHeader node={props.schema} setKey={props.setKey} />
        <ul className="divide-y divide-border">
          {branches.map((branch, index) => {
            const annotations = getSchemaAnnotations(branch) || {};
            const title = typeof annotations.title === "string" ? annotations.title : undefined;
            return (
              <li
                key={index}
                className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
              >
                <code className="font-mono text-[13px] font-medium text-text [overflow-wrap:anywhere]">
                  {formatValue(branch.const)}
                </code>
                <div className="min-w-0 space-y-2.5">
                  {title && <p className="text-sm font-medium text-text">{title}</p>}
                  <NameValueGrid entries={gridAnnotations(annotations)} />
                  {!title && gridAnnotations(annotations).length === 0 && (
                    <p className="text-[13px] text-faint">No annotations</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </ChangesContext.Provider>
  );
}

/**
 * A schema that is one value rather than fields, such as a string with a
 * pattern or a nullable name: its type on the left and its rules in words,
 * or each branch of a `oneOf` with its own.
 */
export function SchemaValue(props: { schema: Node; setKey?: string }) {
  const { schema } = props;
  const changes = React.useMemo(() => collectChanges(schema), [schema]);
  const details = nullableOf(schema) || schema;
  const branches = branchesOf(schema);
  const choices = choicesOf(details);
  return (
    <ChangesContext.Provider value={changes}>
      <div className="overflow-hidden rounded-xl border border-border bg-elevated">
        <RootHeader node={schema} setKey={props.setKey} />
        <div className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <div className="min-w-0">
            <TypeLabel node={schema} setKey={props.setKey} />
          </div>
          <div className="min-w-0 space-y-2.5">
            {branches ? (
              <Branches branches={branches} setKey={props.setKey} />
            ) : (
              <>
                <RuleChips rules={rulesOf(details)} />
                {choices && <ChoiceChips choices={choices} />}
              </>
            )}
          </div>
        </div>
      </div>
    </ChangesContext.Provider>
  );
}

export function isSchemaChoiceList(schema: Node): boolean {
  return isChoiceList(schema);
}
