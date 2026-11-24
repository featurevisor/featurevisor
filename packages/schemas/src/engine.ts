import {
  applyVariableOperations,
  getPortableTimestamp,
  isValidVersion,
  type ConditionReaders,
} from "@featurevisor/sdk";
import type {
  Context,
  DatafileSchema,
  DatafileSchemaIssueEntry,
  DatafileSchemaMutation,
  SchemaMessages,
} from "@featurevisor/types";

import {
  chooseMessage,
  type MessageLookup,
  type MessageScope,
  type MessageSources,
} from "./messages.js";
import { assignOwn, hasOwn } from "./paths.js";
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
  /** How many issues of shape were found, which hold back the `issues` of every object around them. */
  shape?: number;
}

export type Validate = (value: unknown, run: Run, at: Position) => void;

/** Answers a mutation's conditions with the SDK's engine, for the schema being validated. */
export type Match = (
  conditions: unknown,
  context: Context,
  readers: ConditionReaders,
  schema: string,
) => boolean;

/**
 * A compiled schema by key in the current datafile, for references, or
 * undefined when it has none, with the matcher mutations' conditions use.
 */
export type Resolve = ((
  key: string,
) => { node: DatafileSchema; validate: Validate } | undefined) & {
  match?: Match;
};

type Node = DatafileSchema & Record<string, unknown>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  // Any realm's `Object.prototype`, as `structuredClone`, a frame or a worker can hand over.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
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

/** Issues after which an object's `issues` could not trust the values they compare. */
const SHAPE_CODES: ReadonlyArray<string> = [
  "type",
  "required",
  "enum",
  "const",
  "additionalProperties",
  "oneOf",
  "schemaNotFound",
];

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
  if (SHAPE_CODES.indexOf(code) !== -1) run.shape = (run.shape || 0) + 1;
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
  return referenced && own ? assignOwn({}, referenced, own) : own || referenced;
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

  // A listed timestamp must still be one, so its typed rules run after the value matches.
  const typed = node.format === "date-time" ? compileTyped(node, resolve) : undefined;

  if ("const" in node) {
    return (value, run, at) => {
      if (!sameJson(value, node.const)) report(run, at, "const", { const: node.const });
      else typed?.(value, run, at);
    };
  }

  if (Array.isArray(node.enum)) {
    const options = node.enum as unknown[];
    return (value, run, at) => {
      if (!options.some((option) => sameJson(value, option))) {
        const titles = titlesOf(options.map((option) => optionEntry(node, option)));
        report(run, at, "enum", { options, ...titles });
      } else typed?.(value, run, at);
    };
  }

  return compileTyped(node, resolve);
}

/** A node's rules by its type: the type itself, then the keywords that type takes. */
function compileTyped(node: Node, resolve: Resolve): Validate {
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

/** The value at a dot path inside a value, through own keys only, for `input` leaves. */
export function readInput(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Where the rule an issue reports sits in a node's rules, such as
 * `properties.taxId.pattern`, and whether the walk reached it, which it does
 * not through a reference or a `oneOf`.
 */
function ruleOf(rules: unknown, path: ReadonlyArray<PathKey>, code: string): [PathKey[], boolean] {
  // A missing or an extra key is a rule of the object around it.
  const parent = code === "required" || code === "additionalProperties";
  const steps = parent ? path.slice(0, -1) : path;
  const at: PathKey[] = [];
  let current = rules;
  for (const step of steps) {
    const node = current as Record<string, unknown>;
    const properties = node.properties;
    if (typeof step === "string" && isPlainObject(properties) && hasOwn(properties, step)) {
      at.push("properties", step);
      current = properties[step];
    } else if (typeof step === "number" && isPlainObject(node.items)) {
      at.push("items");
      current = node.items;
    } else if (isPlainObject(node.additionalProperties)) {
      at.push("additionalProperties");
      current = node.additionalProperties;
    } else return [at, false];
  }
  if (code === "required") at.push("required");
  else if (code === "additionalProperties") at.push("properties", path[path.length - 1]);
  else at.push(code);
  return [at, true];
}

/** Whether an operation's path reaches a rule, as a prefix of it or, when the rule was reached, beyond it. */
function reaches(operation: ReadonlyArray<unknown>, rule: ReadonlyArray<PathKey>, whole: boolean) {
  for (let index = 0; index < Math.min(operation.length, rule.length); index++) {
    const part = operation[index];
    // A selector picks an item by its fields, as any item can.
    if (typeof part !== "object" && part !== rule[index]) return false;
  }
  return operation.length <= rule.length || whole;
}

const mutated = new WeakMap<object, Map<string, Node>>();

/** Which of a node's mutations match the value at it, as an id such as `0,2,`. */
export function matchingMutations(
  node: Node,
  value: unknown,
  context: Context,
  resolve: Resolve,
  schema: string,
): string {
  const mutations = node.mutations as unknown as DatafileSchemaMutation[];
  // `input` reads the value at this node, so a mutation in `address` reads the address's own fields.
  const readers = { input: (path: string) => readInput(value, path) };
  let id = "";
  for (let index = 0; index < mutations.length; index++) {
    if (resolve.match && resolve.match(mutations[index].conditions, context, readers, schema))
      id += `${index},`;
  }
  return id;
}

/** A node's rules with the mutations an id names applied in order, without `mutations`, the same object for the same id. */
export function mutatedRules(node: Node, id: string): Node {
  let byId = mutated.get(node);
  if (!byId) mutated.set(node, (byId = new Map()));
  let rules = byId.get(id);
  if (!rules) {
    const mutations = node.mutations as unknown as DatafileSchemaMutation[];
    rules = assignOwn({}, node) as Node;
    delete rules.mutations;
    for (const index of id.split(",")) {
      if (index)
        rules = applyVariableOperations(
          rules as never,
          mutations[Number(index)].operations,
        ) as Node;
    }
    byId.set(id, rules);
  }
  return rules;
}

/**
 * A node whose rules change under conditions: each value is validated against
 * the node with every mutation whose conditions match applied, in order. Each
 * combination of matches compiles once and is kept for the node. An issue
 * whose rule a matching mutation set or changed names the last such mutation.
 */
function compileMutations(node: Node, resolve: Resolve): Validate {
  const mutations = node.mutations as unknown as DatafileSchemaMutation[];
  const variants = new Map<string, [Validate, Node, number[]]>();
  return (value, run, at) => {
    const id = matchingMutations(node, value, run.sources.info.context, resolve, run.schema);
    let variant = variants.get(id);
    if (!variant) {
      const rules = mutatedRules(node, id);
      const matched = id.split(",").filter(Boolean).map(Number);
      variant = [compileNode(rules, resolve), rules, matched];
      variants.set(id, variant);
    }
    const [validate, rules, matched] = variant;
    const start = run.issues.length;
    validate(value, run, at);
    for (let position = start; position < run.issues.length && matched.length > 0; position++) {
      const issue = run.issues[position] as { mutation?: string } & SchemaIssue;
      // A mutation inside the node applies last, so its claim stands.
      if (issue.mutation !== undefined) continue;
      const [rule, whole] = ruleOf(rules, issue.path.slice(at.path.length), issue.code);
      for (let index = matched.length - 1; index >= 0; index--) {
        const mutation = mutations[matched[index]];
        // An issue entry's issue sits at its own path, so the mutation is one that changed `issues`.
        const sets = (path: ReadonlyArray<unknown>) =>
          issue.code === "refine" ? path.indexOf("issues") !== -1 : reaches(path, rule, whole);
        if (mutation.operations.some((operation) => sets(operation.path))) {
          issue.mutation = mutation.key;
          break;
        }
      }
    }
  };
}

/**
 * An object's `issues`: after its own rules, unless an issue of shape sits
 * anywhere inside it, each entry whose conditions match reports its issue at
 * its path, with that field's title and the messages around it.
 */
function compileIssues(node: Node, rules: Validate, resolve: Resolve): Validate {
  const entries = node.issues as unknown as DatafileSchemaIssueEntry[];
  return (value, run, at) => {
    const shape = run.shape;
    rules(value, run, at);
    if (run.shape !== shape || !isPlainObject(value) || !resolve.match) return;
    // `input` reads the value at this node, as a mutation's conditions do.
    const readers = { input: (path: string) => readInput(value, path) };
    for (const entry of entries) {
      if (!resolve.match(entry.conditions, run.sources.info.context, readers, run.schema)) continue;
      const parts = entry.path ? entry.path.split(".") : [];
      const scopes = [...at.scopes];
      let field: unknown = node;
      parts.forEach((part, index) => {
        const properties = resolveNode(field, resolve)?.properties;
        field =
          isPlainObject(properties) && hasOwn(properties, part) ? properties[part] : undefined;
        ownScopes(field, at.mpath.length + index + 1, resolve, scopes);
      });
      report(run, at, "refine", { refine: entry.key }, [...at.path, ...parts], {
        mpath: [...at.mpath, ...parts],
        scopes,
        title: parts.length > 0 ? titleOf(field, resolve) : at.title,
        own: entry.message,
      });
    }
  };
}

/** Compiles a schema node into a function that validates a value, with its messages and title in scope. */
export function compileNode(node: unknown, resolve: Resolve): Validate {
  if (!isPlainObject(node)) return () => {};
  if (Array.isArray(node.mutations) && node.mutations.length > 0) {
    return compileMutations(node as Node, resolve);
  }
  const own = compileRules(node as Node, resolve);
  const rules =
    Array.isArray(node.issues) && node.issues.length > 0
      ? compileIssues(node as Node, own, resolve)
      : own;
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
