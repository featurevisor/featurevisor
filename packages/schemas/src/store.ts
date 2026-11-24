import type { Featurevisor, FeaturevisorModuleApi } from "@featurevisor/sdk";
import type { DatafileSchema, SchemaMessages } from "@featurevisor/types";

import { compileNode, isPlainObject, type Resolve, type Validate } from "./engine.js";
import type { MessageScope } from "./messages.js";
import { hasOwn, type PathStep } from "./paths.js";

/** What every schemas instance on one SDK instance shares: its module API and compiled schemas. */
export interface Store {
  readonly f: Featurevisor;
  readonly api: FeaturevisorModuleApi;
  /** A schema of the current datafile, compiled, or undefined when the datafile has none. */
  readonly resolve: Resolve;
  /** The entry as the datafile holds it. */
  entry(key: string): DatafileSchema | undefined;
  /** What changes when the schema does, through the schemas it references too, since its hash covers them. */
  version(key: string): unknown;
  /** Reports `schema_not_found` once per key. */
  reportMissing(key: string): void;
}

const stores = new WeakMap<Featurevisor, Store>();

const SECTION = "schemas";

function registerModule(f: Featurevisor): FeaturevisorModuleApi {
  if (typeof (f as Partial<Featurevisor>).addModule !== "function") {
    throw new Error(
      "@featurevisor/schemas takes the instance createFeaturevisor returns, not a child. Pass a child's context to validate instead.",
    );
  }

  let api: FeaturevisorModuleApi | undefined;
  const setup = (moduleApi: FeaturevisorModuleApi) => {
    api = moduleApi;
  };
  // A frozen module without evaluation hooks costs evaluations nothing.
  f.addModule(Object.freeze({ name: "@featurevisor/schemas", setup }));
  // Another copy of this package on the same instance took the name first.
  if (!api) f.addModule(Object.freeze({ setup }));

  if (!api || typeof api.getEntry !== "function" || typeof api.matchConditions !== "function") {
    throw new Error(
      "@featurevisor/schemas needs an @featurevisor/sdk whose modules can read datafile sections, 4.14.0 or later.",
    );
  }
  return api;
}

/** The store for an SDK instance, created and registered on first use. */
export function getStore(f: Featurevisor): Store {
  const existing = stores.get(f);
  if (existing) return existing;

  const api = registerModule(f);
  const compiled = new Map<string, { entry: DatafileSchema; validate: Validate }>();
  const reported = new Set<string>();

  const entry = (key: string): DatafileSchema | undefined => {
    const value = api.getEntry(SECTION, key);
    return isPlainObject(value) ? (value as DatafileSchema) : undefined;
  };

  // Compiled schemas are kept by the entry the datafile holds, so a new datafile
  // that changes one compiles it again, and references resolve at call time.
  const resolve: Resolve = (key) => {
    const node = entry(key);
    if (!node) return undefined;
    const cached = compiled.get(key);
    if (cached && cached.entry === node) return { node, validate: cached.validate };
    const validate = compileNode(node, resolve);
    compiled.set(key, { entry: node, validate });
    return { node, validate };
  };
  // Mutations' conditions read through the SDK, so a segment means in a schema what it means in a flag.
  resolve.match = (conditions, context, readers, schema) =>
    api.matchConditions(conditions as never, context, { type: "schema", key: schema, readers });

  const store: Store = {
    f,
    api,
    resolve,
    entry,
    version(key) {
      const node = entry(key);
      return node ? (node.hash ?? node) : undefined;
    },
    reportMissing(key: string) {
      if (reported.has(key)) return;
      reported.add(key);
      api.reportDiagnostic({
        level: "warn",
        code: "schema_not_found",
        message: `Schema "${key}" is not in the datafile. Check that a target delivers it.`,
        details: { schemaKey: key },
      });
    },
  };
  stores.set(f, store);
  return store;
}

/** A field inside a schema: its node, and the message path and messages around it. */
export interface FieldLocation {
  readonly node: unknown;
  readonly mpath: string[];
  /** Schema messages of the nodes on the way, not the field's own, which validating it adds. */
  readonly scopes: MessageScope[];
  /** The field's value in a view's values. */
  readonly value?: unknown;
  /** Whether the object the field sits in requires it, after that object's mutations in a view. */
  readonly required?: boolean;
}

/** How a view walks: its values, from which step they apply, and what applies a node's matching mutations. */
export interface Walk {
  readonly value: unknown;
  readonly from: number;
  readonly adjust: (node: unknown, value: unknown) => unknown;
}

/**
 * Follows a path from a node, through references, `properties`, array items and
 * the values an open object allows. It stops at `oneOf`, and gives undefined for
 * a path the schema does not describe. In a view, each node on the way, and each
 * schema it references, has its matching mutations applied for the value there.
 */
export function locate(
  resolve: Resolve,
  root: unknown,
  steps: ReadonlyArray<PathStep>,
  start: { mpath: string[]; scopes: MessageScope[] } = { mpath: [], scopes: [] },
  walk?: Walk,
): FieldLocation | undefined {
  let node = root;
  let value = walk && walk.value;
  let required = false;
  const mpath = [...start.mpath];
  const scopes = [...start.scopes];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const adjust = walk && index >= walk.from ? walk.adjust : undefined;
    // The node's messages, then those of each schema it references, at the same depth.
    const seen: string[] = [];
    let resolved = adjust ? adjust(node, value) : node;
    for (;;) {
      if (!isPlainObject(resolved)) return undefined;
      if (isPlainObject(resolved.messages))
        scopes.push({ messages: resolved.messages as SchemaMessages, base: mpath.length });
      const key = resolved.schema;
      if (typeof key !== "string") break;
      if (seen.indexOf(key) !== -1) return undefined;
      seen.push(key);
      const target = resolve(key)?.node;
      resolved = adjust ? adjust(target, value) : target;
    }
    if (Array.isArray(resolved.oneOf)) return undefined;
    const inView = walk && index >= walk.from;

    if (step.kind === "key") {
      const properties = resolved.properties;
      required = false;
      if (isPlainObject(properties) && hasOwn(properties, step.key)) {
        node = properties[step.key];
        mpath.push(step.key);
        required = Array.isArray(resolved.required) && resolved.required.indexOf(step.key) !== -1;
      } else if (isPlainObject(resolved.additionalProperties)) {
        node = resolved.additionalProperties;
        mpath.push("*");
      } else return undefined;
      if (inView)
        value = isPlainObject(value) && hasOwn(value, step.key) ? value[step.key] : undefined;
      continue;
    }

    required = false;
    if (step.kind === "values") {
      if (!isPlainObject(resolved.additionalProperties)) return undefined;
      node = resolved.additionalProperties;
      mpath.push("*");
      // `*` names no one value.
      if (inView) value = undefined;
      continue;
    }

    // An index or `[]`: every item of an array is described alike.
    if (resolved.type !== "array") return undefined;
    node = resolved.items === undefined ? { type: "string" } : resolved.items;
    mpath.push("[]");
    if (inView)
      value = step.kind === "index" && Array.isArray(value) ? value[step.index] : undefined;
  }

  return { node, mpath, scopes, value, required };
}
