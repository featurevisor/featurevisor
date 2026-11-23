import { getPortableTimestamp, isValidVersion } from "@featurevisor/sdk";
import type { DatafileSchema, SchemaMessages } from "@featurevisor/types";

import {
  chooseMessage,
  type MessageLookup,
  type MessageScope,
  type MessageSources,
} from "./messages.js";
import { hasOwn } from "./paths.js";
import type { IssueCode, PathKey, SchemaIssue, SchemasOptions } from "./types.js";

type SchemaMessagesTranslator = NonNullable<SchemasOptions["message"]>;

/** Where validation is in a value: its path, its message path and the schema messages around it. */
export interface Position extends MessageLookup {
  readonly path: ReadonlyArray<PathKey>;
}

/** One validation: where issues go and how they are worded. */
export interface Run {
  readonly schema: string;
  readonly issues: SchemaIssue[];
  readonly sources: MessageSources;
  readonly translate?: SchemaMessagesTranslator;
  /** Counting `oneOf` branches only notes whether a branch failed, without wording anything. */
  readonly trial?: boolean;
  failed: boolean;
}

export type Validate = (value: unknown, run: Run, at: Position) => void;

/** A compiled schema by key in the current datafile, for references, or undefined when it has none. */
export type Resolve = (key: string) => { node: DatafileSchema; validate: Validate } | undefined;

type Node = DatafileSchema & Record<string, unknown>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A string's length in code points, as JSON Schema counts it, so an emoji counts one. */
export function codePointLength(value: string): number {
  let length = value.length;
  for (let index = 0; index < value.length - 1; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length--;
        index++;
      }
    }
  }
  return length;
}

/** Deep equality of JSON values: arrays item by item, objects key by key in any order. */
export function sameJson(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (typeof first !== "object" || typeof second !== "object" || !first || !second) return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  if (Array.isArray(first)) {
    const other = second as unknown[];
    if (first.length !== other.length) return false;
    return first.every((item, index) => sameJson(item, other[index]));
  }
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every(
    (key) =>
      hasOwn(second, key) &&
      sameJson((first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key]),
  );
}

/** The kind of a value, as an issue names what it received. */
export function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : String(value);
  if (typeof value === "object" && !isPlainObject(value)) {
    // A Date, a File or a class instance is not an object as JSON has them.
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" && name ? name.toLowerCase() : "object";
  }
  return typeof value;
}

export function report(
  run: Run,
  at: Position,
  code: IssueCode,
  params: Record<string, unknown>,
  path: ReadonlyArray<PathKey> = at.path,
  lookup: MessageLookup = at,
  ownMessage?: string,
): void {
  run.failed = true;
  if (run.trial) return;
  // The field's title, so a message can say `{title} is required`.
  if (lookup.title !== undefined) params = { ...params, title: lookup.title };
  let message = chooseMessage(code, params, path, lookup, run.sources, ownMessage);
  const issue = { message, path, code, params, schema: run.schema };
  if (run.translate) {
    const translated = run.translate(issue, run.sources.info);
    if (typeof translated === "string") message = translated;
  }
  run.issues.push(message === issue.message ? issue : { ...issue, message });
}

/** A node's annotations, over those of the schema it references, so the reference's own win. */
export function annotationsOf(
  node: unknown,
  resolve: Resolve,
  seen = new Set<string>(),
): Record<string, unknown> | undefined {
  if (!isPlainObject(node)) return undefined;
  const own = isPlainObject(node.annotations) ? node.annotations : undefined;
  if (typeof node.schema !== "string" || seen.has(node.schema)) return own;
  seen.add(node.schema);
  const referenced = annotationsOf(resolve(node.schema)?.node, resolve, seen);
  return referenced && own ? { ...referenced, ...own } : own || referenced;
}

/** A node's `title` annotation, through the schema it references. */
export function titleOf(node: unknown, resolve: Resolve): string | undefined {
  const title = annotationsOf(node, resolve)?.title;
  return typeof title === "string" ? title : undefined;
}

/** What an `enum`'s `options` annotation says about one value, keyed by the value, or a value's JSON text. */
export function optionEntry(node: Node, value: unknown): Record<string, unknown> | undefined {
  const options = isPlainObject(node.annotations) ? node.annotations.options : undefined;
  const key = typeof value === "string" ? value : JSON.stringify(value);
  const entry = isPlainObject(options) && hasOwn(options, key) ? options[key] : undefined;
  return isPlainObject(entry) ? entry : undefined;
}

/** Each choice's title, when every choice has one, for an `enum` issue's `titles`. */
function titlesOf(entries: unknown[]): { titles?: string[] } {
  const titles = entries.map((entry) => (isPlainObject(entry) ? entry.title : undefined));
  return titles.length > 0 && titles.every((title) => typeof title === "string")
    ? { titles: titles as string[] }
    : {};
}

/** Schema messages around a field: its own node's, and a referenced schema's root's. */
export function ownScopes(
  node: unknown,
  base: number,
  resolve: Resolve,
  scopes: MessageScope[] = [],
  seen = new Set<string>(),
): MessageScope[] {
  if (!isPlainObject(node)) return scopes;
  if (isPlainObject(node.messages))
    scopes.push({ messages: node.messages as SchemaMessages, base });
  if (typeof node.schema === "string" && !seen.has(node.schema)) {
    seen.add(node.schema);
    ownScopes(resolve(node.schema)?.node, base, resolve, scopes, seen);
  }
  return scopes;
}

/** The node a reference resolves to, through any chain of references. */
export function resolveNode(
  node: unknown,
  resolve: Resolve,
  seen = new Set<string>(),
): Node | undefined {
  if (!isPlainObject(node)) return undefined;
  if (typeof node.schema === "string") {
    if (seen.has(node.schema)) return undefined;
    seen.add(node.schema);
    return resolveNode(resolve(node.schema)?.node, resolve, seen);
  }
  return node as Node;
}

/** The kinds of value a branch takes, or undefined when the branch alone cannot say. */
function branchKinds(node: unknown, resolve: Resolve): Set<string> | undefined {
  const resolved = resolveNode(node, resolve);
  if (!resolved) return undefined;
  if (Array.isArray(resolved.oneOf)) return undefined;
  if (resolved.type) {
    const type = resolved.type === "integer" ? "number" : String(resolved.type);
    return new Set([type]);
  }
  if ("const" in resolved) return new Set([kindOf(resolved.const)]);
  if (Array.isArray(resolved.enum)) return new Set(resolved.enum.map(kindOf));
  return undefined;
}

/** Whether a node is a `oneOf` whose every branch is a `const`, a list of choices like an `enum`. */
export function isConstList(node: Node, resolve: Resolve): boolean {
  const branches = node.oneOf;
  return (
    Array.isArray(branches) &&
    branches.length > 0 &&
    branches.every((branch) => {
      const resolved = resolveNode(branch, resolve);
      return Boolean(resolved && "const" in resolved);
    })
  );
}

interface OneOfKinds {
  nodes: (Node | undefined)[];
  kinds: (Set<string> | undefined)[];
  disjoint: boolean;
}

/** A `oneOf` of consts, which reports `enum` with its values, as an `enum` does. */
function compileConstList(node: Node, resolve: Resolve): Validate {
  const branchNodes = node.oneOf as unknown[];
  return (value, run, at) => {
    const options = branchNodes.map((branch) => resolveNode(branch, resolve)?.const);
    if (!options.some((option) => sameJson(value, option))) {
      const titles = titlesOf(branchNodes.map((branch) => annotationsOf(branch, resolve)));
      report(run, at, "enum", { options, ...titles });
    }
  };
}

function compileOneOf(node: Node, resolve: Resolve): Validate {
  if (isConstList(node, resolve)) return compileConstList(node, resolve);
  const branchNodes = node.oneOf as unknown[];
  const branches = branchNodes.map((branch) => compileNode(branch, resolve));
  let cached: OneOfKinds | undefined;

  // The kinds each branch takes, kept until a branch's reference resolves to another schema.
  const kindsNow = (): OneOfKinds => {
    const nodes = branchNodes.map((branch) => resolveNode(branch, resolve));
    if (cached && cached.nodes.every((resolved, index) => resolved === nodes[index])) return cached;
    const kinds = nodes.map((resolved) => (resolved ? branchKinds(resolved, resolve) : undefined));
    const disjoint =
      kinds.every(Boolean) &&
      kinds.every((set, index) =>
        kinds.every(
          (other, otherIndex) =>
            otherIndex === index || !Array.from(set!).some((kind) => other!.has(kind)),
        ),
      );
    cached = { nodes, kinds, disjoint };
    return cached;
  };

  return (value, run, at) => {
    const { kinds, disjoint } = kindsNow();

    if (disjoint) {
      // The value's type selects a branch, whose own issues are the ones reported.
      const kind = kindOf(value);
      const selected = kinds.findIndex((set) => set!.has(kind));
      if (selected === -1) {
        report(run, at, "oneOf", { matches: 0 });
        return;
      }
      branches[selected](value, run, at);
      return;
    }

    let matches = 0;
    for (const branch of branches) {
      const trial: Run = { ...run, issues: [], trial: true, failed: false };
      branch(value, trial, at);
      if (!trial.failed) matches++;
    }
    if (matches !== 1) report(run, at, "oneOf", { matches });
  };
}

function compileString(node: Node): Validate {
  const minLength = typeof node.minLength === "number" ? node.minLength : undefined;
  const maxLength = typeof node.maxLength === "number" ? node.maxLength : undefined;
  const format = node.format;
  let pattern: RegExp | undefined;
  if (typeof node.pattern === "string") {
    try {
      pattern = new RegExp(node.pattern);
    } catch {
      // Lint reports a pattern that does not compile.
    }
  }

  return (value, run, at) => {
    const text = value as string;
    if (format === "date-time" && getPortableTimestamp(text) === null) {
      report(run, at, "format", { format });
    } else if (format === "semver" && !isValidVersion(text)) {
      report(run, at, "format", { format });
    }
    if (minLength !== undefined || maxLength !== undefined) {
      const length = codePointLength(text);
      if (minLength !== undefined && length < minLength) {
        report(run, at, "minLength", { minLength, length });
      }
      if (maxLength !== undefined && length > maxLength) {
        report(run, at, "maxLength", { maxLength, length });
      }
    }
    if (pattern) {
      pattern.lastIndex = 0;
      if (!pattern.test(text)) report(run, at, "pattern", { pattern: node.pattern });
    }
  };
}

function compileNumber(node: Node): Validate {
  const minimum = typeof node.minimum === "number" ? node.minimum : undefined;
  const maximum = typeof node.maximum === "number" ? node.maximum : undefined;
  return (value, run, at) => {
    const number = value as number;
    if (minimum !== undefined && number < minimum)
      report(run, at, "minimum", { minimum, value: number });
    if (maximum !== undefined && number > maximum)
      report(run, at, "maximum", { maximum, value: number });
  };
}

function compileArray(node: Node, resolve: Resolve): Validate {
  const minItems = typeof node.minItems === "number" ? node.minItems : undefined;
  const maxItems = typeof node.maxItems === "number" ? node.maxItems : undefined;
  const items = node.items !== undefined ? compileNode(node.items, resolve) : undefined;
  return (value, run, at) => {
    const list = value as unknown[];
    if (minItems !== undefined && list.length < minItems) {
      report(run, at, "minItems", { minItems, count: list.length });
    }
    if (maxItems !== undefined && list.length > maxItems) {
      report(run, at, "maxItems", { maxItems, count: list.length });
    }
    if (node.uniqueItems === true) {
      outer: for (let index = 1; index < list.length; index++) {
        for (let earlier = 0; earlier < index; earlier++) {
          if (sameJson(list[earlier], list[index])) {
            report(run, at, "uniqueItems", { index });
            break outer;
          }
        }
      }
    }
    const mpath = [...at.mpath, "[]"];
    for (let index = 0; index < list.length; index++) {
      const item = { path: [...at.path, index], mpath, scopes: at.scopes };
      if (items) items(list[index], run, item);
      else if (typeof list[index] !== "string") {
        // An array without `items` holds strings only.
        report(run, item, "type", { type: "string", received: kindOf(list[index]) });
      }
    }
  };
}

/** An object's messages for a key it has no field for, which has no title of its own. */
function untitled(at: Position): MessageLookup {
  return { mpath: at.mpath, scopes: at.scopes };
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function compileObject(node: Node, resolve: Resolve): Validate {
  const properties = isPlainObject(node.properties)
    ? (node.properties as Record<string, unknown>)
    : undefined;
  const compiledProperties = new Map<string, Validate>();
  if (properties) {
    for (const key of Object.keys(properties))
      compiledProperties.set(key, compileNode(properties[key], resolve));
  }
  const required = Array.isArray(node.required) ? (node.required as string[]) : [];
  const additional = node.additionalProperties;
  const compiledAdditional =
    additional !== undefined && additional !== true ? compileNode(additional, resolve) : undefined;

  return (value, run, at) => {
    const object = value as Record<string, unknown>;

    if (properties) {
      for (const key of required) {
        if (hasOwn(object, key) && object[key] !== undefined) continue;
        // A missing key's issue is at the key, worded by the messages for that field, with its title.
        const mpath = [...at.mpath, key];
        report(run, at, "required", { key }, [...at.path, key], {
          mpath,
          scopes: [...at.scopes, ...ownScopes(properties[key], mpath.length, resolve)],
          title: titleOf(properties[key], resolve),
        });
      }
    }

    for (const key of Object.keys(object)) {
      const child = object[key];
      // A key whose value is `undefined` counts as absent, as form state often holds.
      if (child === undefined) continue;
      const property = compiledProperties.get(key);
      if (property) {
        property(child, run, {
          path: [...at.path, key],
          mpath: [...at.mpath, key],
          scopes: at.scopes,
        });
      } else if (additional === true) {
        continue;
      } else if (compiledAdditional) {
        compiledAdditional(child, run, {
          path: [...at.path, key],
          mpath: [...at.mpath, "*"],
          scopes: at.scopes,
        });
      } else if (properties) {
        // An extra key has no field of its own, so the object that rejects it words its issue, without a title.
        report(run, at, "additionalProperties", { key }, [...at.path, key], untitled(at));
      } else if (!isPrimitive(child)) {
        // Without `properties` or `additionalProperties`, an object is flat.
        report(
          run,
          at,
          "type",
          { type: "primitive", received: kindOf(child) },
          [...at.path, key],
          untitled(at),
        );
      }
    }
  };
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  integer: (value) => typeof value === "number" && Number.isInteger(value),
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  array: (value) => Array.isArray(value),
  object: isPlainObject,
};

function compileRules(node: Node, resolve: Resolve): Validate {
  if (typeof node.schema === "string") {
    const key = node.schema;
    return (value, run, at) => {
      const target = resolve(key);
      if (target) target.validate(value, run, at);
      else report(run, at, "schemaNotFound", { schema: key });
    };
  }

  if (Array.isArray(node.oneOf)) return compileOneOf(node, resolve);

  if ("const" in node) {
    return (value, run, at) => {
      if (!sameJson(value, node.const)) report(run, at, "const", { const: node.const });
    };
  }

  if (Array.isArray(node.enum)) {
    const options = node.enum as unknown[];
    return (value, run, at) => {
      if (!options.some((option) => sameJson(value, option))) {
        const titles = titlesOf(options.map((option) => optionEntry(node, option)));
        report(run, at, "enum", { options, ...titles });
      }
    };
  }

  const type = typeof node.type === "string" ? node.type : undefined;
  const check = type ? TYPE_CHECKS[type] : undefined;
  // With a type, only its own keywords can apply, so only they are compiled.
  const string = !type || type === "string" ? compileString(node) : undefined;
  const number = !type || type === "integer" || type === "number" ? compileNumber(node) : undefined;
  const array = !type || type === "array" ? compileArray(node, resolve) : undefined;
  const object = !type || type === "object" ? compileObject(node, resolve) : undefined;

  return (value, run, at) => {
    if (check && !check(value)) {
      report(run, at, "type", { type, received: kindOf(value) });
      return;
    }
    if (typeof value === "string") string?.(value, run, at);
    else if (typeof value === "number") number?.(value, run, at);
    else if (Array.isArray(value)) array?.(value, run, at);
    else if (isPlainObject(value)) object?.(value, run, at);
  };
}

/** Compiles a schema node into a function that validates a value, with its messages and title in scope. */
export function compileNode(node: unknown, resolve: Resolve): Validate {
  if (!isPlainObject(node)) return () => {};
  const rules = compileRules(node as Node, resolve);
  const messages = isPlainObject(node.messages) ? (node.messages as SchemaMessages) : undefined;
  const title =
    isPlainObject(node.annotations) && typeof node.annotations.title === "string"
      ? node.annotations.title
      : undefined;
  if (!messages && title === undefined) return rules;
  return (value, run, at) =>
    rules(value, run, {
      path: at.path,
      mpath: at.mpath,
      scopes: messages ? [...at.scopes, { messages, base: at.mpath.length }] : at.scopes,
      // A reference's own title wins over the title of the schema it references.
      title: at.title ?? title,
    });
}
