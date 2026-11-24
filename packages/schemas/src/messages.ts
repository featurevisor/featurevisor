import type { SchemaMessages } from "@featurevisor/types";

import type {
  CodeMessages,
  FieldMessages,
  IssueCode,
  Message,
  MessageInfo,
  PathKey,
} from "./types.js";
import { hasOwn } from "./paths.js";

/**
 * Messages from a schema's `messages` that can word issues below `base`, the
 * length of the message path where the node carrying them sits.
 */
export interface MessageScope {
  readonly messages: SchemaMessages;
  readonly base: number;
}

/** Where an issue's message is looked for: the field's message path, and the schema messages around it. */
export interface MessageLookup {
  /** Keys, with `"[]"` for array items and `"*"` for the values of an open object. */
  readonly mpath: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<MessageScope>;
  /** The field's `title` annotation, which every issue about the field carries in its params. */
  readonly title?: string;
  /** An issue entry's `message`, the field's own, which the schema's scopes can replace. */
  readonly own?: string;
}

/** What wording an instance and a form bring, for one validation. */
export interface MessageSources {
  readonly form?: FieldMessages;
  readonly app?: CodeMessages;
  readonly info: MessageInfo;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(map: Record<string, unknown>, key: string): unknown {
  return hasOwn(map, key) ? map[key] : undefined;
}

/** The map of messages a path leads to, through own keys only. */
function navigate(
  messages: unknown,
  steps: ReadonlyArray<string>,
  from = 0,
): Record<string, unknown> | undefined {
  let node = messages;
  for (let index = from; index < steps.length; index++) {
    if (!isMap(node)) return undefined;
    node = own(node, steps[index]);
  }
  return isMap(node) ? node : undefined;
}

function formatParam(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatParam).join(", ");
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return String(value);
  return JSON.stringify(value);
}

/** Fills `{name}` from params. Lists are joined with commas, and `{{` and `}}` write literal braces. */
export function fillTemplate(template: string, params: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (match, name: string | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    return formatParam(own(params, name as string));
  });
}

function apply(
  message: Message,
  params: Readonly<Record<string, unknown>>,
  info: MessageInfo,
): string {
  return typeof message === "function" ? message(params, info) : fillTemplate(message, params);
}

const TYPE_NAMES: Record<string, string> = {
  string: "a string",
  integer: "an integer",
  number: "a number",
  boolean: "a boolean",
  object: "an object",
  array: "an array",
  primitive: "a string, number, boolean or null",
};

function subject(path: ReadonlyArray<PathKey>): string {
  return path.length === 0 ? "Value" : `Value at ${JSON.stringify(path.map(String).join("."))}`;
}

function items(count: unknown): string {
  return count === 1 ? "item" : "items";
}

/** The default wording of each issue, in lint's English. */
export function defaultMessage(
  code: IssueCode,
  params: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<PathKey>,
): string {
  const at = subject(path);
  switch (code) {
    case "type":
      return `${at} must be ${TYPE_NAMES[params.type as string] || String(params.type)} (got ${params.received}).`;
    case "const":
      return `${at} must equal ${JSON.stringify(params.const)}.`;
    case "enum":
      // The choices' titles when every choice has one, since those are what a person picks from.
      return `${at} must be one of ${((params.titles || params.options) as unknown[]).map((option) => (typeof option === "string" ? option : JSON.stringify(option))).join(", ")}.`;
    case "minimum":
      return `${at} must be at least ${params.minimum} (got ${params.value}).`;
    case "maximum":
      return `${at} must be at most ${params.maximum} (got ${params.value}).`;
    case "minLength":
      return `${at} must be at least ${params.minLength} characters long (got ${params.length}).`;
    case "maxLength":
      return `${at} must be at most ${params.maxLength} characters long (got ${params.length}).`;
    case "pattern":
      return `${at} does not match the expected pattern.`;
    case "format":
      return params.format === "date-time"
        ? `${at} must be a timestamp such as 2026-01-31T09:00:00Z.`
        : `${at} must be a version such as 1.2.3.`;
    case "minItems":
      return `${at} must have at least ${params.minItems} ${items(params.minItems)} (got ${params.count}).`;
    case "maxItems":
      return `${at} must have at most ${params.maxItems} ${items(params.maxItems)} (got ${params.count}).`;
    case "uniqueItems":
      return `${at} must not repeat items (item ${params.index} repeats an earlier one).`;
    case "required":
      return `${at} is required.`;
    case "additionalProperties":
      return `${at} is not allowed.`;
    case "oneOf":
      return params.matches === 0
        ? `${at} does not match any of the allowed shapes.`
        : `${at} must match exactly one of the allowed shapes (matched ${params.matches}).`;
    case "refine":
      return `${at} is not valid.`;
    case "refineError":
      return `${at} could not be checked.`;
    case "schemaNotFound":
      return params.field
        ? `Field ${JSON.stringify(params.field)} was not found in schema ${JSON.stringify(params.schema)}.`
        : `Schema ${JSON.stringify(params.schema)} was not found.`;
  }
}

/**
 * The message an issue carries, the first of: the form's message for the
 * field, the schema's from the outside in, the application's for the code, and
 * the default. A message is for the field it names, never for fields inside it.
 */
export function chooseMessage(
  code: IssueCode,
  params: Readonly<Record<string, unknown>>,
  path: ReadonlyArray<PathKey>,
  lookup: MessageLookup,
  sources: MessageSources,
  /** A check in code's own message, which wins over every other. */
  ownMessage?: string,
): string {
  if (ownMessage !== undefined) return fillTemplate(ownMessage, params);
  const { mpath, scopes } = lookup;

  const formMessages = navigate(sources.form, mpath);
  const form = formMessages && own(formMessages, code);
  if (typeof form === "string" || typeof form === "function") {
    return apply(form as Message, params, sources.info);
  }

  for (const scope of scopes) {
    if (scope.base > mpath.length) continue;
    const scopeMessages = navigate(scope.messages, mpath, scope.base);
    const schemaMessage = scopeMessages && own(scopeMessages, code);
    if (typeof schemaMessage === "string") return fillTemplate(schemaMessage, params);
  }
  if (lookup.own !== undefined) return fillTemplate(lookup.own, params);

  const app =
    sources.app && (own(sources.app as Record<string, unknown>, code) as Message | undefined);
  if (app !== undefined) return apply(app, params, sources.info);

  return defaultMessage(code, params, path);
}
