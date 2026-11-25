import * as React from "react";

import { SchemaRefLink, TypeBadge, getSchemaAnnotations } from "./variables";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
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

/** Annotations other than those shown elsewhere, as a small grid of names and values. */
function AnnotationGrid(props: { annotations: [string, unknown][] }) {
  if (props.annotations.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
      {props.annotations.map(([name, value]) => (
        <React.Fragment key={name}>
          <dt className="font-mono text-[11px] leading-5 text-faint">{name}</dt>
          <dd className="text-muted [overflow-wrap:anywhere]">{formatValue(value)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A field of an object, with its node, whether its object requires it, and its own fields. */
interface Field {
  name: string;
  node: Node;
  required: boolean;
  /** The node its details come from: a nullable field's other branch. */
  details: Node;
  /** Annotations it shows: its own, and for a list its items' too. */
  annotations: Node;
  children?: { label?: string; fields: Field[] };
}

function toField(name: string, node: Node, required: boolean): Field {
  const details = nullableOf(node) || node;
  const items = details.type === "array" && isNode(details.items) ? details.items : undefined;
  const annotations = { ...(items && getSchemaAnnotations(items)), ...getSchemaAnnotations(node) };
  const object = (candidate: Node | undefined) =>
    candidate && isNode(candidate.properties) ? fieldsOf(candidate) : undefined;
  const own = object(details);
  const each = items ? object(items) : undefined;
  return {
    name,
    node,
    required,
    details,
    annotations,
    children: own ? { fields: own } : each ? { label: "Each item", fields: each } : undefined,
  };
}

/** An object's fields, those its `order` annotation lists first, then the rest as written. */
export function fieldsOf(node: Node): Field[] {
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
    .map((key) => toField(key, properties[key] as Node, required.has(key)));
  if (isNode(node.additionalProperties)) {
    fields.push(toField("*", node.additionalProperties, false));
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
  const title = typeof field.annotations.title === "string" ? field.annotations.title : undefined;
  const rules = rulesOf(field.details);
  const items =
    field.details.type === "array" && isNode(field.details.items) ? field.details.items : undefined;
  const choices = choicesOf(field.details) || (items && choicesOf(items));
  const itemRules = items && !field.children ? rulesOf(items) : [];
  const annotations = gridAnnotations(field.annotations);
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
        <RuleChips rules={[...rules, ...itemRules]} />
        {choices && <ChoiceChips choices={choices} />}
        <AnnotationGrid annotations={annotations} />
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

/** The root's annotations, at the top of the card: the title as a heading, the rest beneath. */
function RootHeader(props: { node: Node; alone?: boolean }) {
  const annotations = getSchemaAnnotations(props.node);
  if (!annotations) return null;
  const title = typeof annotations.title === "string" ? annotations.title : undefined;
  const rest = gridAnnotations(annotations);
  const ordered = Array.isArray(annotations.order);
  return (
    <div
      className={["space-y-2.5 px-5 py-4", props.alone ? "" : "border-b border-border"].join(" ")}
    >
      {title && <p className="text-base font-semibold text-text">{title}</p>}
      <AnnotationGrid annotations={rest} />
      {ordered && (
        <p className="text-xs text-faint">
          Fields in the order its <code className="font-mono">order</code> annotation lists.
        </p>
      )}
    </div>
  );
}

/**
 * A schema's structure on its Overview, as a list of fields: each with its
 * name, type and whether it is required, then its title, its rules in words,
 * its choices, its other annotations and any notes for maintainers. Nested
 * objects and the items of a list of objects show their fields inside.
 */
export function SchemaFields(props: { schema: Node; setKey?: string }) {
  const { schema } = props;
  const rootRules = rulesOf(schema);

  if (schema.type === "array" && isNode(schema.items)) {
    const items = schema.items;
    const itemFields = isNode(items.properties) ? fieldsOf(items) : undefined;
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-elevated">
        <RootHeader node={schema} />
        {rootRules.length > 0 && (
          <div className="border-b border-border px-5 py-3">
            <RuleChips rules={rootRules} />
          </div>
        )}
        <ul className="divide-y divide-border">
          {itemFields ? (
            itemFields.map((field) => (
              <FieldRow key={field.name} field={field} setKey={props.setKey} />
            ))
          ) : (
            <FieldRow field={toField("each item", items, false)} setKey={props.setKey} />
          )}
        </ul>
      </div>
    );
  }

  const fields = fieldsOf(schema);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-elevated">
      <RootHeader node={schema} />
      {rootRules.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          <RuleChips rules={rootRules} />
        </div>
      )}
      {fields.length > 0 ? (
        <ul className="divide-y divide-border">
          {fields.map((field) => (
            <FieldRow key={field.name} field={field} setKey={props.setKey} />
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted">An object with any keys.</p>
      )}
    </div>
  );
}

/** A schema that is a list of choices, one row each: its value, then its title and what it carries. */
export function SchemaChoices(props: { schema: Node }) {
  const branches = (props.schema.oneOf as Node[]) || [];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-elevated">
      <RootHeader node={props.schema} />
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
                <AnnotationGrid annotations={gridAnnotations(annotations)} />
                {!title && gridAnnotations(annotations).length === 0 && (
                  <p className="text-[13px] text-faint">No annotations</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A schema that is one value rather than fields, such as a string with a
 * pattern or a nullable name: its type on the left and its rules in words,
 * or each branch of a `oneOf` with its own.
 */
export function SchemaValue(props: { schema: Node; setKey?: string }) {
  const { schema } = props;
  const nullable = nullableOf(schema);
  const details = nullable || schema;
  const branches =
    !nullable && Array.isArray(schema.oneOf) ? schema.oneOf.filter(isNode) : undefined;
  const choices = choicesOf(details);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-elevated">
      <RootHeader node={schema} />
      <div className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <TypeLabel node={schema} setKey={props.setKey} />
        </div>
        <div className="min-w-0 space-y-2.5">
          {branches ? (
            <ul className="space-y-2">
              {branches.map((branch, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <TypeLabel node={branch} setKey={props.setKey} />
                  <RuleChips rules={rulesOf(branch)} />
                </li>
              ))}
            </ul>
          ) : (
            <>
              <RuleChips rules={rulesOf(details)} />
              {choices && <ChoiceChips choices={choices} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function isSchemaChoiceList(schema: Node): boolean {
  return isChoiceList(schema);
}
