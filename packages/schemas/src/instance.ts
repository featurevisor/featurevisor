import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";

import { SchemaHandleImpl, type CheckWrapper, type HandleContext } from "./handle.js";
import { getStore } from "./store.js";
import type { HandleOptions, SchemaHandle, Schemas, SchemasOptions } from "./types.js";

/** An instance's internals, for its framework entries. */
export interface SchemasInternals {
  /** A handle that reads its options each time it validates, for a component's inline options. */
  createHandle(
    key: string,
    getOptions: () => HandleOptions<any, any> | undefined,
    wrapCheck?: CheckWrapper,
  ): SchemaHandleImpl;
  /** Calls back on every datafile the SDK instance accepts, until the returned function is called. */
  subscribe(callback: () => void): () => void;
  /** What a datafile holds for a key, which changes when the schema does. */
  version(key: string): unknown;
  readonly f: Featurevisor;
}

export const INTERNALS = Symbol.for("@featurevisor/schemas/internals");

/**
 * Validates data against the schemas the SDK instance's datafile carries. The
 * instance holds no copy of them: every handle reads the current datafile when
 * it is used, so a new datafile takes effect at the next validation.
 *
 * ```ts
 * const s = createSchemas(f)
 * const result = s.validate("signUp", input)
 * ```
 */
export function createSchemas<TSchemas extends object = Record<string, unknown>>(
  f: Featurevisor,
  options: SchemasOptions = {},
): Schemas<TSchemas> {
  const store = getStore(f);
  const unsubscribes = new Set<() => void>();
  const listen = (callback: () => void) => {
    const stop = f.on("datafile_set", () => callback());
    unsubscribes.add(stop);
    return () => {
      unsubscribes.delete(stop);
      stop();
    };
  };
  const context: HandleContext = { store, instanceOptions: () => options, listen };
  const plain = new Map<string, SchemaHandleImpl>();
  const withOptions = new WeakMap<object, Map<string, SchemaHandleImpl>>();

  const get = (key: string, handleOptions?: HandleOptions<any, any>) => {
    const handles = handleOptions
      ? withOptions.get(handleOptions) ||
        (withOptions.set(handleOptions, new Map()), withOptions.get(handleOptions)!)
      : plain;
    let handle = handles.get(key);
    if (!handle) {
      handle = new SchemaHandleImpl(context, key, () => handleOptions);
      handles.set(key, handle);
    }
    return handle;
  };

  const internals: SchemasInternals = {
    f,
    createHandle: (key, getOptions, wrapCheck) =>
      new SchemaHandleImpl(context, key, getOptions, [], wrapCheck),
    subscribe: listen,
    version: (key) => store.version(key),
  };

  const schemas = {
    get,
    validate: (key: string, value: unknown, validationContext?: Context) =>
      get(key).validate(value, { context: validationContext }),
    isValid: (key: string, value: unknown, validationContext?: Context) =>
      get(key).isValid(value, { context: validationContext }),
    parse: (key: string, value: unknown, validationContext?: Context) =>
      get(key).parse(value, { context: validationContext }),
    keys: () => store.api.getEntryKeys("schemas"),
    has: (key: string) => Boolean(store.entry(key)),
    close() {
      for (const stop of unsubscribes) stop();
      unsubscribes.clear();
    },
    [INTERNALS]: internals,
  };

  return schemas as unknown as Schemas<TSchemas>;
}

/** The internals of an instance made by `createSchemas`. */
export function getInternals(schemas: Schemas<any>): SchemasInternals {
  const internals = (schemas as unknown as Record<symbol, SchemasInternals>)[INTERNALS];
  if (!internals)
    throw new Error("Expected an instance made by createSchemas from @featurevisor/schemas.");
  return internals;
}

export type { SchemaHandle };
