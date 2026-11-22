import type { Featurevisor, FeaturevisorModuleApi } from "@featurevisor/sdk";
import type { DatafileSchema } from "@featurevisor/types";

import {
  compileNode,
  isPlainObject,
  ownScopes,
  resolveNode,
  type Resolve,
  type Validate,
} from "./engine.js";
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
  /** Results derived from an entry, such as constraints, kept until the entry changes. */
  derive<T>(key: string, kind: string, make: (entry: DatafileSchema) => T): T | undefined;
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

  if (!api || typeof api.getEntry !== "function") {
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
  const derived = new Map<string, { entry: DatafileSchema; revision: string; value: unknown }>();
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

  const store: Store = {
    f,
    api,
    resolve,
    entry,
    derive<T>(key: string, kind: string, make: (node: DatafileSchema) => T): T | undefined {
      const node = entry(key);
      if (!node) return undefined;
      const id = `${kind}\u0000${key}`;
      // Kept by the revision too, since a field's constraints can come from a referenced schema.
      const revision = api.getRevision();
      const cached = derived.get(id);
      if (cached && cached.entry === node && cached.revision === revision) {
        return cached.value as T;
      }
      const value = make(node);
      derived.set(id, { entry: node, revision, value });
      return value;
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
}

/**
 * Follows a path from a node, through references, `properties`, array items and
 * the values an open object allows. It stops at `oneOf`, and gives undefined for
 * a path the schema does not describe.
 */
export function locate(
  resolve: Resolve,
  root: unknown,
  steps: ReadonlyArray<PathStep>,
  start: { mpath: string[]; scopes: MessageScope[] } = { mpath: [], scopes: [] },
): FieldLocation | undefined {
  let node = root;
  const mpath = [...start.mpath];
  const scopes = [...start.scopes];

  for (const step of steps) {
    ownScopes(node, mpath.length, resolve, scopes);
    const resolved = resolveNode(node, resolve);
    if (!resolved || Array.isArray(resolved.oneOf)) return undefined;

    if (step.kind === "key") {
      const properties = resolved.properties;
      if (isPlainObject(properties) && hasOwn(properties, step.key)) {
        node = properties[step.key];
        mpath.push(step.key);
        continue;
      }
      if (isPlainObject(resolved.additionalProperties)) {
        node = resolved.additionalProperties;
        mpath.push("*");
        continue;
      }
      return undefined;
    }

    if (step.kind === "values") {
      if (!isPlainObject(resolved.additionalProperties)) return undefined;
      node = resolved.additionalProperties;
      mpath.push("*");
      continue;
    }

    // An index or `[]`: every item of an array is described alike.
    if (resolved.type !== "array") return undefined;
    node = resolved.items === undefined ? { type: "string" } : resolved.items;
    mpath.push("[]");
  }

  return { node, mpath, scopes };
}
