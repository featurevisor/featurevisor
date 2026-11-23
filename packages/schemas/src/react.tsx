// React server components cannot create a context or use hooks, so this runs on the client.
"use client";

import * as React from "react";
import type { Featurevisor } from "@featurevisor/sdk";
import type { Context } from "@featurevisor/types";
import { useScopeContext, useSdk } from "@featurevisor/react";

import {
  isPromise,
  parseResult,
  readValues,
  type CheckWrapper,
  type SchemaHandleImpl,
} from "./handle.js";
import { setOwn } from "./paths.js";
import { createSchemas, getInternals } from "./instance.js";
import type {
  CodeMessages,
  HandleOptions,
  IsAsync,
  SchemaHandle,
  SchemaResult,
  Schemas,
  SchemasOptions,
  ValidateOptions,
} from "./types.js";

/** `T` as written, never inferred from where it is used, so options never type the schema. */
type Uninferred<T> = [T][T extends unknown ? 0 : never];

const SchemasContext = React.createContext<Schemas<any> | undefined>(undefined);

/** One instance per SDK instance, for hooks under a FeaturevisorProvider without a SchemasProvider. */
const fallbacks = new WeakMap<Featurevisor, Schemas<any>>();

function fallbackFor(f: Featurevisor): Schemas<any> {
  let schemas = fallbacks.get(f);
  if (!schemas) {
    schemas = createSchemas(f);
    fallbacks.set(f, schemas);
  }
  return schemas;
}

export interface SchemasProviderProps {
  /** Messages per issue code, for the instance this provider creates. The latest are used. */
  messages?: CodeMessages;
  /** The translating function, for the instance this provider creates. The latest is used. */
  message?: SchemasOptions["message"];
  /** An instance created elsewhere, which needs no FeaturevisorProvider above. */
  schemas?: Schemas<any>;
  children: React.ReactNode;
}

/**
 * Configures the schemas instance for the hooks below. An application with a
 * FeaturevisorProvider and nothing to configure needs none.
 */
export function SchemasProvider(props: SchemasProviderProps): React.ReactElement {
  const sdk = useSdk();
  const latest = React.useRef(props);
  latest.current = props;

  const schemas = React.useMemo(() => {
    if (props.schemas) return props.schemas;
    if (!sdk) return undefined;
    // Read on every validation, so a language switch takes effect at the next one.
    return createSchemas(sdk, {
      get messages() {
        return latest.current.messages;
      },
      get message() {
        return latest.current.message;
      },
    });
  }, [props.schemas, sdk]);

  return <SchemasContext.Provider value={schemas}>{props.children}</SchemasContext.Provider>;
}

/**
 * The schemas instance for the nearest SchemasProvider, or else for the nearest
 * FeaturevisorProvider's SDK instance. Reads through it do not render the
 * component again.
 */
export function useSchemas<TSchemas extends object = Record<string, unknown>>(): Schemas<TSchemas> {
  const provided = React.useContext(SchemasContext);
  const sdk = useSdk();
  if (provided) return provided as Schemas<TSchemas>;
  if (sdk) return fallbackFor(sdk) as Schemas<TSchemas>;
  throw new Error(
    "@featurevisor/schemas/react needs a SchemasProvider or a FeaturevisorProvider above it.",
  );
}

const { useSyncExternalStore } = React as Partial<typeof React>;

/** What the datafile holds for a key, read again when a datafile is set. */
function useSchemaVersion(schemas: Schemas<any>, key: string): unknown {
  const internals = getInternals(schemas);
  const read = () => internals.version(key);
  const subscribe = React.useCallback(
    (changed: () => void) => internals.subscribe(changed),
    [internals],
  );

  if (useSyncExternalStore) return useSyncExternalStore(subscribe, read, read);

  // React 16.8 and 17 read while rendering and listen in an effect.
  const [, refresh] = React.useReducer((count: number) => count + 1, 0);
  const version = read();
  React.useEffect(() => {
    const stop = subscribe(refresh);
    if (read() !== version) refresh();
    return stop;
  }, [subscribe]);
  return version;
}

function valueKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
}

/**
 * A hook's context: the one given merged over the enclosing scopes', as the
 * flag hooks merge theirs. Keys are defined, so `__proto__` stays a key.
 */
function withScope(scope: Context | undefined, context: Context | undefined): Context | undefined {
  if (!scope) return context;
  const merged: Context = {};
  for (const source of [scope, context || {}]) {
    for (const key of Object.keys(source)) setOwn(merged, key, source[key]);
  }
  return merged;
}

interface Call {
  answer?: boolean;
  promise?: Promise<boolean>;
  controller?: AbortController;
  waiting: number;
}

/**
 * Keeps each check's answer for the component's life, per value, per the
 * values its `reads` name and per context, and shares one call between
 * validations waiting on the same answer. A call nobody waits for any more is
 * aborted, and a call that failed is asked again next time.
 */
function createAnswerKeeper(): CheckWrapper {
  const calls = new Map<string, Call>();
  return (refinement, check) => (value, info) => {
    const read = readValues(refinement, info.input);
    const id = [refinement.key, value, read, info.context].map(valueKey).join("\u0000");
    const kept = calls.get(id);
    if (kept && kept.answer !== undefined) return kept.answer;

    let call = kept;
    if (!call) {
      const controller = new AbortController();
      const outcome = check(value, { ...info, signal: controller.signal });
      if (!isPromise(outcome)) {
        if (typeof outcome === "boolean") calls.set(id, { answer: outcome, waiting: 0 });
        return outcome;
      }
      call = { controller, waiting: 0 };
      const current = call;
      call.promise = outcome.then(
        (answer) => {
          current.answer = answer === true;
          current.promise = undefined;
          return answer;
        },
        (error) => {
          calls.delete(id);
          throw error;
        },
      );
      calls.set(id, call);
    }

    const shared = call;
    shared.waiting++;
    info.signal.addEventListener(
      "abort",
      () => {
        shared.waiting--;
        if (shared.waiting === 0 && shared.promise) {
          calls.delete(id);
          shared.controller?.abort(info.signal.reason);
        }
      },
      { once: true },
    );
    return shared.promise as Promise<boolean>;
  };
}

const SUPERSEDED = Symbol("superseded by a newer validation");

/**
 * A component's handle: the instance's, with the latest validation winning. A
 * newer validation aborts the older one's checks, and the older one settles
 * with the newer one's result, so a slow answer never lands after a newer one.
 */
class HookHandle {
  private current?: {
    controller: AbortController;
    settleWith: (result: SchemaResult<unknown> | Promise<SchemaResult<unknown>>) => void;
  };
  private readonly fields = new Map<string, HookHandle>();
  readonly "~standard": SchemaHandleImpl["~standard"];

  constructor(
    readonly inner: SchemaHandleImpl,
    /** The enclosing scopes' context where the hook was called, read when validating. */
    private readonly scope: () => Context | undefined,
  ) {
    this["~standard"] = {
      ...inner["~standard"],
      validate: (value, options) => {
        const libraryOptions = (options && options.libraryOptions) || {};
        return this.validate(value, {
          signal: libraryOptions.signal as AbortSignal | undefined,
          context: libraryOptions.context as ValidateOptions["context"],
        }) as ReturnType<SchemaHandleImpl["~standard"]["validate"]>;
      },
    };
  }

  get key() {
    return this.inner.key;
  }
  get path() {
    return this.inner.path;
  }
  get constraints() {
    return this.inner.constraints;
  }
  get options() {
    return this.inner.options;
  }
  get kind() {
    return this.inner.kind;
  }
  option(value: unknown) {
    return this.inner.option(value);
  }
  subscribe(listener: () => void) {
    return this.inner.subscribe(listener);
  }
  fromFormData(data: FormData | URLSearchParams) {
    return this.inner.fromFormData(data);
  }
  validateRules(value: unknown, options: ValidateOptions = {}) {
    return this.inner.validateRules(value, {
      ...options,
      context: withScope(this.scope(), options.context),
    });
  }
  hasChecks() {
    return this.inner.hasChecks();
  }

  at(path: string): HookHandle {
    let field = this.fields.get(path);
    if (!field) {
      field = new HookHandle(this.inner.at(path), this.scope);
      this.fields.set(path, field);
    }
    return field;
  }

  validate(value: unknown, options: ValidateOptions = {}) {
    const controller = new AbortController();
    const outer = options.signal;
    const forward = () => controller.abort(outer!.reason);
    if (outer) {
      if (outer.aborted) forward();
      else outer.addEventListener("abort", forward, { once: true });
    }
    const release = () => outer && outer.removeEventListener("abort", forward);

    const previous = this.current;
    this.current = undefined;
    let result: SchemaResult<unknown> | Promise<SchemaResult<unknown>>;
    try {
      result = this.inner.validate(value, {
        context: withScope(this.scope(), options.context),
        signal: controller.signal,
      });
    } catch (error) {
      // The older validation waits on this one, so it fails with it.
      if (previous) {
        previous.controller.abort(SUPERSEDED);
        previous.settleWith(Promise.reject(error));
      }
      release();
      throw error;
    }
    if (previous) {
      previous.controller.abort(SUPERSEDED);
      previous.settleWith(result);
    }
    if (!isPromise(result)) {
      release();
      return result;
    }

    let settleWith!: (next: SchemaResult<unknown> | Promise<SchemaResult<unknown>>) => void;
    const settled = new Promise<SchemaResult<unknown>>((resolve, reject) => {
      settleWith = (next) => {
        release();
        Promise.resolve(next).then(resolve, reject);
      };
      result.then(
        (answer) => {
          release();
          if (this.current && this.current.controller === controller) this.current = undefined;
          resolve(answer);
        },
        (error) => {
          // A newer validation settles this one through settleWith.
          if (error === SUPERSEDED) return;
          release();
          reject(error);
        },
      );
    });
    this.current = { controller, settleWith };
    return settled;
  }

  isValid(value: unknown, options?: ValidateOptions) {
    const result = this.validate(value, options);
    return isPromise(result) ? result.then((settled) => !settled.issues) : !result.issues;
  }

  parse(value: unknown, options?: ValidateOptions) {
    return parseResult(this.key, this.validate(value, options));
  }
}

/**
 * The handle for a schema, which renders the component again when the
 * datafile changes the schema. Options can be written inline: the hook keeps
 * one handle per key for the component and reads the latest options when it
 * validates. It validates with the context of any FeaturevisorScope around
 * it, under a context given to `validate`. Checks in code keep their answers,
 * share calls and let the latest validation win.
 */
export function useSchema<T = unknown, TResult extends boolean | Promise<boolean> = boolean>(
  key: string,
  options?: HandleOptions<Uninferred<T>, TResult>,
): SchemaHandle<T, IsAsync<TResult>> {
  const schemas = useSchemas();
  const latest = React.useRef(options);
  latest.current = options;
  const scope = useScopeContext();
  const latestScope = React.useRef(scope);
  latestScope.current = scope;

  const handle = React.useMemo(() => {
    const internals = getInternals(schemas);
    const inner = internals.createHandle(key, () => latest.current, createAnswerKeeper());
    return new HookHandle(inner, () => latestScope.current);
  }, [schemas, key]);

  useSchemaVersion(schemas, key);
  return handle as unknown as SchemaHandle<T, IsAsync<TResult>>;
}

export interface ValidationOptions {
  /** Milliseconds to wait after the value changes before running checks in code. Rules never wait. */
  debounce?: number;
}

/** A result, and whether a check in code is still running, which it is only once the rules pass. */
export type ValidationResult<T> = SchemaResult<T> & { readonly validating: boolean };

interface RulesHandle {
  readonly key: string;
  validateRules(value: unknown, options?: ValidateOptions): SchemaResult<unknown>;
  hasChecks(): boolean;
  validate(
    value: unknown,
    options?: ValidateOptions,
  ): SchemaResult<unknown> | Promise<SchemaResult<unknown>>;
}

/**
 * Validates a value while rendering, for a field checked as the user types. The
 * first argument is a schema's key or a handle, such as `signUp.at("username")`.
 * It validates with the context of any FeaturevisorScope around it. Checks in
 * code wait for `debounce`, and the result says when they run.
 */
export function useValidation<T = unknown>(
  keyOrHandle: string | SchemaHandle<T, boolean>,
  value: unknown,
  options: ValidationOptions = {},
): ValidationResult<T> {
  const schemas = useSchemas();
  const handle = React.useMemo(
    () => (typeof keyOrHandle === "string" ? schemas.get(keyOrHandle) : keyOrHandle),
    [schemas, keyOrHandle],
  ) as unknown as RulesHandle;
  const version = useSchemaVersion(schemas, handle.key);
  const scope = useScopeContext();
  const key = valueKey(value);

  // Rules are worked out on every render, so the result holds the value as it is now.
  const rules = handle.validateRules(value, { context: scope });
  const needsChecks = !rules.issues && handle.hasChecks();

  const [checked, setChecked] = React.useState<
    { for: string; result: SchemaResult<unknown> } | undefined
  >();
  const latestValue = React.useRef(value);
  latestValue.current = value;
  // Checks run again when the value, the datafile or the scope's context changes.
  const forKey = `${key}\u0000${String(version)}\u0000${valueKey(scope)}`;

  React.useEffect(() => {
    if (!needsChecks) return;
    let active = true;
    const timer = setTimeout(() => {
      // The scope is current here, since a new scope's context changes forKey.
      const outcome = handle.validate(latestValue.current, { context: scope });
      Promise.resolve(outcome).then(
        (result) => {
          if (active) setChecked({ for: forKey, result });
        },
        () => {
          // A newer validation, or an aborted one, settles elsewhere.
        },
      );
    }, options.debounce || 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handle, forKey, needsChecks, options.debounce]);

  if (!needsChecks) return { ...rules, validating: false } as ValidationResult<T>;
  if (checked && checked.for === forKey)
    return { ...checked.result, validating: false } as ValidationResult<T>;
  return { value, validating: true } as ValidationResult<T>;
}
